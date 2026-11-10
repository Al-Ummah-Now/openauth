/**
 * Default Tenant Cache Module
 *
 * Provides caching for the default tenant's theme configuration.
 * This enables database-driven default branding without code changes.
 *
 * ## Usage
 *
 * ```typescript
 * import { getDefaultTenantTheme, invalidateDefaultTenantCache } from "./default-tenant-cache"
 *
 * // Fetch default tenant theme (cached)
 * const theme = await getDefaultTenantTheme(tenantService)
 *
 * // Invalidate cache when default tenant is updated
 * invalidateDefaultTenantCache()
 * ```
 *
 * ## Cache Behavior
 *
 * - Lazy loading: Only fetches when first requested
 * - TTL: 60 s. The cache is per isolate (OA-9): other isolates keep their
 *   copy until it expires, so the TTL is kept short.
 * - Cross-isolate invalidation: pass a storage adapter to
 *   `getDefaultTenantTheme` and `invalidateDefaultTenantCache`. A change
 *   writes a new version to the atomic store; readers compare it (at most
 *   every 5 s) and reload when it differs.
 * - Graceful fallback: Returns null if default tenant doesn't exist or is inactive
 * - Error resilient: DB errors don't break the application
 *
 * ## Default Tenant Identification
 *
 * The default tenant is identified by:
 * 1. ID = "default" (primary lookup)
 * 2. Fallback: Could be extended to check slug = "default"
 *
 * @packageDocumentation
 */

import type { TenantService, Tenant } from "../contracts/types.js"
import type { Theme } from "../ui/theme.js"
import { Storage, type StorageAdapter } from "../storage/storage.js"

// ============================================
// CONSTANTS
// ============================================

/**
 * Default tenant ID used for system-wide defaults
 */
export const DEFAULT_TENANT_ID = "default"

/**
 * Default TTL for the cache (60 seconds)
 */
export const DEFAULT_CACHE_TTL_MS = 60_000

/** How often a cached tenant is checked against the shared version. */
export const DEFAULT_TENANT_VERSION_CHECK_MS = 5_000

/** Version of the default tenant (atomic store); changes on every update. */
export const DEFAULT_TENANT_VERSION_KEY = ["tenant", "default", "version"]

async function readVersion(storage: StorageAdapter): Promise<string> {
  const v = await Storage.atomic(storage)
    .get(DEFAULT_TENANT_VERSION_KEY)
    .catch(() => undefined)
  return typeof v === "string" ? v : ""
}

// ============================================
// CACHE IMPLEMENTATION
// ============================================

/**
 * Internal cache structure
 */
interface DefaultTenantCache {
  /** Cached tenant object (null if not found or inactive) */
  tenant: Tenant | null
  /** Timestamp when the cache was loaded */
  loadedAt: number
  /** Whether a fetch has been attempted (distinguishes "not loaded" from "loaded but null") */
  loaded: boolean
  /** Shared version the tenant was loaded at (with a storage adapter) */
  version?: string
  /** When the version was last compared */
  checkedAt?: number
}

/**
 * Module-level cache instance.
 * Using module scope ensures single cache across imports.
 */
let cache: DefaultTenantCache = {
  tenant: null,
  loadedAt: 0,
  loaded: false,
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Fetches and caches the default tenant's theme configuration.
 *
 * This function implements lazy loading with TTL-based cache invalidation.
 * It is designed to be non-blocking and gracefully handles missing or
 * inactive default tenants.
 *
 * @param tenantService - The tenant service instance for database access
 * @returns The default tenant's theme (partial), or null if not available
 *
 * @example
 * ```typescript
 * const theme = await getDefaultTenantTheme(tenantService)
 * if (theme) {
 *   // Apply theme to middleware
 * }
 * ```
 */
export async function getDefaultTenantTheme(
  tenantService: TenantService,
  storage?: StorageAdapter,
): Promise<Partial<Theme> | null> {
  const tenant = await getDefaultTenant(tenantService, storage)
  return tenant?.branding?.theme ?? null
}

/**
 * Invalidates the default tenant cache.
 *
 * Call this function when the default tenant is updated to ensure
 * subsequent requests fetch fresh data from the database.
 *
 * @example
 * ```typescript
 * // After updating default tenant
 * await tenantService.updateTenant("default", { branding: newBranding })
 * invalidateDefaultTenantCache()
 * ```
 */
export async function invalidateDefaultTenantCache(
  storage?: StorageAdapter,
): Promise<void> {
  cache = {
    tenant: null,
    loadedAt: 0,
    loaded: false,
  }
  // Every other isolate reloads on its next version check
  if (storage)
    await Storage.atomic(storage).set(
      DEFAULT_TENANT_VERSION_KEY,
      crypto.randomUUID(),
    )
}

// ============================================
// INTERNAL FUNCTIONS
// ============================================

/**
 * Fetches and caches the default tenant.
 *
 * @internal
 * @param tenantService - The tenant service instance
 * @returns The default tenant, or null if not available
 */
async function getDefaultTenant(
  tenantService: TenantService,
  storage?: StorageAdapter,
): Promise<Tenant | null> {
  const now = Date.now()

  // Check if cache is valid (loaded and not expired)
  if (cache.loaded && now - cache.loadedAt < DEFAULT_CACHE_TTL_MS) {
    if (
      !storage ||
      now - (cache.checkedAt ?? cache.loadedAt) <
        DEFAULT_TENANT_VERSION_CHECK_MS
    )
      return cache.tenant
    const version = await readVersion(storage)
    if (version === cache.version) {
      cache.checkedAt = now
      return cache.tenant
    }
  }
  const version = storage ? await readVersion(storage) : undefined

  // Load from database
  try {
    // Primary lookup: ID = "default"
    let tenant = await tenantService.getTenant(DEFAULT_TENANT_ID)

    // Validate tenant is active
    if (tenant && tenant.status !== "active") {
      console.warn(
        `[default-tenant-cache] Default tenant status: ${tenant.status}, ignoring`,
      )
      tenant = null
    }

    // Update cache
    cache = {
      tenant,
      loadedAt: now,
      loaded: true,
      version,
      checkedAt: now,
    }

    return tenant
  } catch (error) {
    // Log error but don't block application
    console.error(
      "[default-tenant-cache] Failed to load default tenant:",
      error,
    )

    // Mark as loaded to prevent repeated failures
    // Cache the failure for a shorter period (30 seconds) to allow recovery
    cache = {
      tenant: null,
      loadedAt: now - DEFAULT_CACHE_TTL_MS + 30000, // Retry after 30 seconds
      loaded: true,
    }

    return null
  }
}

/**
 * Gets the current cache state (for testing/debugging purposes).
 *
 * @internal
 * @returns The current cache state
 */
export function getCacheState(): Readonly<DefaultTenantCache> {
  return { ...cache }
}

/**
 * Checks if the cache is currently valid.
 *
 * @internal
 * @returns true if cache is valid and not expired
 */
export function isCacheValid(): boolean {
  return cache.loaded && Date.now() - cache.loadedAt < DEFAULT_CACHE_TTL_MS
}
