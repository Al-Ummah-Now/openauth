/**
 * Dynamic Provider Loader
 *
 * Loads and caches identity provider configurations from the database.
 * Handles decryption of client secrets and instantiation of provider objects.
 *
 * Features:
 * - TTL-based caching (default 60 seconds)
 * - Automatic secret decryption
 * - Tenant-level cache invalidation
 * - Thread-safe cache operations
 *
 * @packageDocumentation
 */

import type { Provider } from "../provider/provider.js"
import type {
  IdentityProvider,
  IdentityProviderRecord,
  ProviderConfig,
  LoadedProvider,
  ProviderType,
} from "./types.js"
import { ProviderNotFoundError, EncryptionError } from "./types.js"
import {
  TTLCache,
  providerCacheKey,
  tenantCacheKeyPrefix,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_CACHE_MAX_SIZE,
} from "./cache.js"
import { EncryptionService } from "./encryption.js"
import { createProviderFromConfig } from "./factory.js"

/**
 * Options for creating a DynamicProviderLoader
 */
export interface ProviderLoaderOptions {
  /** Cache TTL in milliseconds (default: 60000 = 1 minute) */
  cacheTTL?: number
  /** Maximum number of cached providers (default: 500) */
  cacheMaxSize?: number
  /** 32-byte encryption key for decrypting client secrets */
  encryptionKey: Uint8Array
  /** D1 database instance */
  database: D1Database
}

/**
 * Interface for D1 database (Cloudflare Workers)
 */
interface D1Database {
  prepare(query: string): D1PreparedStatement
}

interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<{ results: T[] }>
  run(): Promise<{ success: boolean }>
}

/**
 * Dynamic provider loader with caching and decryption
 *
 * Loads identity provider configurations from the database, decrypts
 * client secrets, and creates provider instances for use in authentication.
 */
export class DynamicProviderLoader {
  private readonly cache: TTLCache<LoadedProvider>
  private readonly encryption: EncryptionService
  private readonly db: D1Database
  private readonly cacheTTL: number

  constructor(options: ProviderLoaderOptions) {
    this.cache = new TTLCache({
      maxSize: options.cacheMaxSize || DEFAULT_CACHE_MAX_SIZE,
    })
    this.encryption = new EncryptionService({ key: options.encryptionKey })
    this.db = options.database
    this.cacheTTL = options.cacheTTL || DEFAULT_CACHE_TTL_MS
  }

  /**
   * Get a single provider by tenant and name
   *
   * @param tenantId - Tenant identifier
   * @param providerName - Provider name within the tenant
   * @returns Loaded provider or null if not found/disabled
   */
  async getProvider(
    tenantId: string,
    providerName: string,
  ): Promise<LoadedProvider | null> {
    const cacheKey = providerCacheKey(tenantId, providerName)

    // Check cache first
    const cached = this.cache.get(cacheKey)
    if (cached) {
      return cached
    }

    // Load from database
    const record = await this.loadProviderRecord(tenantId, providerName)
    if (!record || !record.enabled) {
      return null
    }

    // Parse and create provider instance
    const provider = await this.parseRecord(record)
    const instance = createProviderFromConfig(provider)
    const loaded: LoadedProvider = { config: provider, instance }

    // Cache the loaded provider
    this.cache.set(cacheKey, loaded, this.cacheTTL)
    return loaded
  }

  /**
   * Get a provider, throwing if not found
   *
   * @param tenantId - Tenant identifier
   * @param providerName - Provider name within the tenant
   * @returns Loaded provider
   * @throws ProviderNotFoundError if provider doesn't exist or is disabled
   */
  async getProviderOrThrow(
    tenantId: string,
    providerName: string,
  ): Promise<LoadedProvider> {
    const provider = await this.getProvider(tenantId, providerName)
    if (!provider) {
      throw new ProviderNotFoundError(tenantId, providerName)
    }
    return provider
  }

  /**
   * Get all enabled providers for a tenant
   *
   * @param tenantId - Tenant identifier
   * @returns Array of loaded providers sorted by display order
   */
  async getProviders(tenantId: string): Promise<LoadedProvider[]> {
    const records = await this.loadProviderRecords(tenantId)
    const providers: LoadedProvider[] = []

    for (const record of records) {
      if (!record.enabled) continue

      const cacheKey = providerCacheKey(tenantId, record.name)
      let loaded = this.cache.get(cacheKey)

      if (!loaded) {
        try {
          const provider = await this.parseRecord(record)
          const instance = createProviderFromConfig(provider)
          loaded = { config: provider, instance }
          this.cache.set(cacheKey, loaded, this.cacheTTL)
        } catch (error) {
          // Skip providers that fail to load
          console.error(
            `Failed to load provider ${record.name} for tenant ${tenantId}:`,
            error,
          )
          continue
        }
      }

      providers.push(loaded)
    }

    // Sort by display order, then by name
    return providers.sort((a, b) => {
      const orderDiff = a.config.displayOrder - b.config.displayOrder
      if (orderDiff !== 0) return orderDiff
      return a.config.name.localeCompare(b.config.name)
    })
  }

  /**
   * Get provider configurations (without instances) for a tenant
   *
   * Useful for listing providers in admin UI without instantiating them.
   *
   * @param tenantId - Tenant identifier
   * @param includeDisabled - Include disabled providers (default: false)
   * @returns Array of provider configurations
   */
  async getProviderConfigs(
    tenantId: string,
    includeDisabled = false,
  ): Promise<IdentityProvider[]> {
    const records = includeDisabled
      ? await this.loadAllProviderRecords(tenantId)
      : await this.loadProviderRecords(tenantId)

    const configs: IdentityProvider[] = []

    for (const record of records) {
      try {
        // Don't decrypt secrets for config listing - just parse metadata
        const config = await this.parseRecordWithoutSecret(record)
        configs.push(config)
      } catch (error) {
        console.error(
          `Failed to parse provider ${record.name} for tenant ${tenantId}:`,
          error,
        )
      }
    }

    return configs.sort((a, b) => {
      const orderDiff = a.displayOrder - b.displayOrder
      if (orderDiff !== 0) return orderDiff
      return a.name.localeCompare(b.name)
    })
  }

  /**
   * Invalidate all cached providers for a tenant
   *
   * Call this after updating tenant's provider configuration.
   *
   * @param tenantId - Tenant identifier
   */
  invalidateTenant(tenantId: string): void {
    this.cache.deleteByPrefix(tenantCacheKeyPrefix(tenantId))
  }

  /**
   * Invalidate a specific cached provider
   *
   * Call this after updating a single provider.
   *
   * @param tenantId - Tenant identifier
   * @param providerName - Provider name to invalidate
   */
  invalidateProvider(tenantId: string, providerName: string): void {
    this.cache.delete(providerCacheKey(tenantId, providerName))
  }

  /**
   * Clear all cached providers
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats() {
    return this.cache.getStats()
  }

  /**
   * Load a single provider record from the database
   */
  private async loadProviderRecord(
    tenantId: string,
    name: string,
  ): Promise<IdentityProviderRecord | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM identity_providers
      WHERE tenant_id = ? AND name = ?
    `)
    return stmt.bind(tenantId, name).first<IdentityProviderRecord>()
  }

  /**
   * Load all enabled provider records for a tenant
   */
  private async loadProviderRecords(
    tenantId: string,
  ): Promise<IdentityProviderRecord[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM identity_providers
      WHERE tenant_id = ? AND enabled = 1
      ORDER BY display_order ASC, name ASC
    `)
    const result = await stmt.bind(tenantId).all<IdentityProviderRecord>()
    return result.results || []
  }

  /**
   * Load all provider records (including disabled) for a tenant
   */
  private async loadAllProviderRecords(
    tenantId: string,
  ): Promise<IdentityProviderRecord[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM identity_providers
      WHERE tenant_id = ?
      ORDER BY display_order ASC, name ASC
    `)
    const result = await stmt.bind(tenantId).all<IdentityProviderRecord>()
    return result.results || []
  }

  /**
   * Parse a database record into an IdentityProvider with decrypted secret
   */
  private async parseRecord(
    record: IdentityProviderRecord,
  ): Promise<IdentityProvider> {
    let clientSecret: string | null = null

    // Decrypt client secret if present
    if (record.client_secret_encrypted && record.client_secret_iv) {
      try {
        clientSecret = await this.encryption.decryptFromDB(
          record.client_secret_encrypted,
          record.client_secret_iv,
        )
      } catch (error) {
        console.error(
          `Failed to decrypt secret for provider ${record.id}:`,
          error,
        )
        throw new EncryptionError(
          `Failed to decrypt client secret for provider: ${record.name}`,
        )
      }
    }

    // Parse JSON config
    let config: ProviderConfig
    try {
      config = JSON.parse(record.config || "{}")
    } catch {
      config = {} as ProviderConfig
    }

    return {
      id: record.id,
      tenantId: record.tenant_id,
      type: record.type as ProviderType,
      name: record.name,
      displayName: record.display_name,
      clientId: record.client_id,
      clientSecret,
      config,
      enabled: record.enabled === 1,
      displayOrder: record.display_order,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    }
  }

  /**
   * Parse a database record without decrypting the secret
   *
   * Used for listing providers where secrets aren't needed.
   */
  private async parseRecordWithoutSecret(
    record: IdentityProviderRecord,
  ): Promise<IdentityProvider> {
    let config: ProviderConfig
    try {
      config = JSON.parse(record.config || "{}")
    } catch {
      config = {} as ProviderConfig
    }

    return {
      id: record.id,
      tenantId: record.tenant_id,
      type: record.type as ProviderType,
      name: record.name,
      displayName: record.display_name,
      clientId: record.client_id,
      clientSecret: null, // Don't expose or decrypt
      config,
      enabled: record.enabled === 1,
      displayOrder: record.display_order,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    }
  }
}

/**
 * Create a new DynamicProviderLoader instance
 *
 * @param options - Loader configuration
 * @returns Configured provider loader
 */
export function createDynamicProviderLoader(
  options: ProviderLoaderOptions,
): DynamicProviderLoader {
  return new DynamicProviderLoader(options)
}
