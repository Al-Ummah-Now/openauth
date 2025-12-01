/**
 * Tenant Service Implementation
 *
 * Manages tenant lifecycle operations including creation, retrieval, updates,
 * and deletion. Supports both KV storage for data and optional D1 for admin queries.
 *
 * Storage keys:
 * - Tenant data: ["tenant", tenantId]
 * - Domain lookup: ["tenant", "domain", domain] -> { tenantId: string }
 *
 * @packageDocumentation
 */

import type { StorageAdapter } from "../storage/storage.js"
import type {
  Tenant,
  TenantBranding,
  TenantService,
  TenantSettings,
  TenantStatus,
} from "../contracts/types.js"
import { TenantError } from "../contracts/types.js"
import {
  TENANT_STORAGE_KEYS,
  type CreateTenantParams,
  type UpdateTenantParams,
  type ListTenantsParams,
  type DomainLookup,
} from "./types.js"

/**
 * D1Database interface for optional admin queries
 * This is a simplified interface matching Cloudflare D1
 */
export interface D1Database {
  prepare(query: string): D1PreparedStatement
}

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement
  all<T = any>(): Promise<D1Result<T>>
  first<T = any>(colName?: string): Promise<T | null>
  run(): Promise<D1Result<unknown>>
}

export interface D1Result<T> {
  results: T[]
  success: boolean
  meta?: Record<string, any>
}

/**
 * TenantServiceImpl implements the TenantService interface
 * providing CRUD operations for tenant management.
 *
 * Testing checklist:
 * - Can create tenant with unique domain
 * - Domain uniqueness enforced via storage lookup
 * - Can get tenant by ID
 * - Can get tenant by domain
 * - Can update tenant (name, domain, branding, settings, status)
 * - Domain changes update both old and new domain lookups
 * - Soft delete sets status="deleted" but preserves data
 * - Delete removes domain lookup
 * - List tenants works with KV scan
 * - List tenants works with D1 if available
 * - List tenants supports status filter
 * - List tenants supports pagination
 */
export class TenantServiceImpl implements TenantService {
  private readonly storage: StorageAdapter
  private readonly db: D1Database | undefined

  /**
   * Create a new TenantServiceImpl
   *
   * @param storage - StorageAdapter for KV operations
   * @param db - Optional D1Database for admin queries (more efficient listing)
   */
  constructor(storage: StorageAdapter, db?: D1Database) {
    this.storage = storage
    this.db = db
  }

  /**
   * Create a new tenant
   *
   * @param params - Tenant creation parameters
   * @returns The created tenant
   * @throws TenantError if domain already exists
   *
   * @example
   * ```typescript
   * const tenant = await service.createTenant({
   *   id: "tenant123",
   *   name: "Acme Corp",
   *   domain: "auth.acme.com",
   *   branding: { theme: { primary: "#007bff" } },
   *   settings: { allowPublicRegistration: true }
   * })
   * ```
   */
  async createTenant(params: CreateTenantParams): Promise<Tenant> {
    const { id, name, domain, branding, settings } = params

    // Validate tenant ID
    if (!id || id.trim() === "") {
      throw new TenantError("invalid_tenant_id", "Tenant ID is required")
    }

    // Validate name
    if (!name || name.trim() === "") {
      throw new TenantError("invalid_tenant_id", "Tenant name is required")
    }

    // Check if tenant already exists
    const existingTenant = await this.getTenant(id)
    if (existingTenant) {
      throw new TenantError(
        "invalid_tenant_id",
        `Tenant with ID '${id}' already exists`,
      )
    }

    // Validate and check domain uniqueness if provided
    if (domain) {
      const normalizedDomain = this.normalizeDomain(domain)
      const existingDomainTenant =
        await this.getTenantByDomain(normalizedDomain)
      if (existingDomainTenant) {
        throw new TenantError(
          "domain_already_exists",
          `Domain '${normalizedDomain}' is already in use by another tenant`,
        )
      }
    }

    const now = Date.now()
    const normalizedDomain = domain ? this.normalizeDomain(domain) : undefined

    const tenant: Tenant = {
      id,
      name: name.trim(),
      domain: normalizedDomain,
      status: "active",
      branding: branding || {},
      settings: settings || {},
      created_at: now,
      updated_at: now,
    }

    // Store tenant data
    await this.storage.set(TENANT_STORAGE_KEYS.tenant(id), tenant)

    // Store domain lookup if domain is provided
    if (normalizedDomain) {
      const domainLookup: DomainLookup = { tenantId: id }
      await this.storage.set(
        TENANT_STORAGE_KEYS.domain(normalizedDomain),
        domainLookup,
      )
    }

    return tenant
  }

  /**
   * Get a tenant by ID
   *
   * @param tenantId - The tenant ID to retrieve
   * @returns The tenant or null if not found
   *
   * @example
   * ```typescript
   * const tenant = await service.getTenant("tenant123")
   * if (tenant) {
   *   console.log(`Found tenant: ${tenant.name}`)
   * }
   * ```
   */
  async getTenant(tenantId: string): Promise<Tenant | null> {
    if (!tenantId || tenantId.trim() === "") {
      return null
    }

    const tenant = await this.storage.get(TENANT_STORAGE_KEYS.tenant(tenantId))
    return (tenant as Tenant) || null
  }

  /**
   * Get a tenant by domain
   *
   * @param domain - The domain to look up
   * @returns The tenant or null if not found
   *
   * @example
   * ```typescript
   * const tenant = await service.getTenantByDomain("auth.acme.com")
   * if (tenant) {
   *   console.log(`Domain belongs to: ${tenant.name}`)
   * }
   * ```
   */
  async getTenantByDomain(domain: string): Promise<Tenant | null> {
    if (!domain || domain.trim() === "") {
      return null
    }

    const normalizedDomain = this.normalizeDomain(domain)
    const lookup = await this.storage.get(
      TENANT_STORAGE_KEYS.domain(normalizedDomain),
    )

    if (!lookup) {
      return null
    }

    const domainLookup = lookup as DomainLookup
    return this.getTenant(domainLookup.tenantId)
  }

  /**
   * Update a tenant
   *
   * @param tenantId - The tenant ID to update
   * @param updates - The updates to apply
   * @returns The updated tenant
   * @throws TenantError if tenant not found or domain conflict
   *
   * @example
   * ```typescript
   * const updated = await service.updateTenant("tenant123", {
   *   name: "Acme Corporation",
   *   branding: { theme: { primary: "#0066cc" } }
   * })
   * ```
   */
  async updateTenant(
    tenantId: string,
    updates: Partial<Tenant>,
  ): Promise<Tenant> {
    const existingTenant = await this.getTenant(tenantId)
    if (!existingTenant) {
      throw new TenantError(
        "tenant_not_found",
        `Tenant '${tenantId}' not found`,
      )
    }

    const oldDomain = existingTenant.domain
    let newDomain = updates.domain !== undefined ? updates.domain : oldDomain

    // Normalize new domain if provided
    if (newDomain) {
      newDomain = this.normalizeDomain(newDomain)
    }

    // Check domain uniqueness if domain is changing
    if (newDomain && newDomain !== oldDomain) {
      const existingDomainTenant = await this.getTenantByDomain(newDomain)
      if (existingDomainTenant && existingDomainTenant.id !== tenantId) {
        throw new TenantError(
          "domain_already_exists",
          `Domain '${newDomain}' is already in use by another tenant`,
        )
      }
    }

    // Merge updates
    const updatedTenant: Tenant = {
      ...existingTenant,
      name: updates.name?.trim() || existingTenant.name,
      domain: newDomain || undefined,
      status: updates.status || existingTenant.status,
      branding:
        updates.branding !== undefined
          ? { ...existingTenant.branding, ...updates.branding }
          : existingTenant.branding,
      settings:
        updates.settings !== undefined
          ? { ...existingTenant.settings, ...updates.settings }
          : existingTenant.settings,
      updated_at: Date.now(),
    }

    // Handle domain changes
    if (oldDomain !== newDomain) {
      // Remove old domain lookup if it existed
      if (oldDomain) {
        await this.storage.remove(TENANT_STORAGE_KEYS.domain(oldDomain))
      }

      // Add new domain lookup if new domain exists
      if (newDomain) {
        const domainLookup: DomainLookup = { tenantId }
        await this.storage.set(
          TENANT_STORAGE_KEYS.domain(newDomain),
          domainLookup,
        )
      }
    }

    // Store updated tenant
    await this.storage.set(TENANT_STORAGE_KEYS.tenant(tenantId), updatedTenant)

    return updatedTenant
  }

  /**
   * Delete a tenant (soft delete)
   *
   * Sets the tenant status to "deleted" but preserves the data.
   * Also removes the domain lookup so the domain can be reused.
   *
   * @param tenantId - The tenant ID to delete
   * @throws TenantError if tenant not found
   *
   * @example
   * ```typescript
   * await service.deleteTenant("tenant123")
   * // Tenant is now soft-deleted with status="deleted"
   * ```
   */
  async deleteTenant(tenantId: string): Promise<void> {
    const existingTenant = await this.getTenant(tenantId)
    if (!existingTenant) {
      throw new TenantError(
        "tenant_not_found",
        `Tenant '${tenantId}' not found`,
      )
    }

    // Remove domain lookup if exists
    if (existingTenant.domain) {
      await this.storage.remove(
        TENANT_STORAGE_KEYS.domain(existingTenant.domain),
      )
    }

    // Soft delete - update status to deleted
    const deletedTenant: Tenant = {
      ...existingTenant,
      status: "deleted",
      updated_at: Date.now(),
    }

    await this.storage.set(TENANT_STORAGE_KEYS.tenant(tenantId), deletedTenant)
  }

  /**
   * List tenants with optional filtering and pagination
   *
   * Uses D1 if available for more efficient querying,
   * otherwise falls back to KV scan.
   *
   * @param params - Optional filtering and pagination parameters
   * @returns Array of tenants
   *
   * @example
   * ```typescript
   * // List all active tenants
   * const activeTenants = await service.listTenants({ status: "active" })
   *
   * // Paginated list
   * const page2 = await service.listTenants({ limit: 10, offset: 10 })
   * ```
   */
  async listTenants(params?: ListTenantsParams): Promise<Tenant[]> {
    const { status, limit = 100, offset = 0 } = params || {}

    // Use D1 if available for more efficient querying
    if (this.db) {
      return this.listTenantsFromD1(status, limit, offset)
    }

    // Fall back to KV scan
    return this.listTenantsFromKV(status, limit, offset)
  }

  /**
   * List tenants from D1 database
   */
  private async listTenantsFromD1(
    status: TenantStatus | undefined,
    limit: number,
    offset: number,
  ): Promise<Tenant[]> {
    if (!this.db) {
      return []
    }

    let query = "SELECT * FROM tenants"
    const bindings: any[] = []

    if (status) {
      query += " WHERE status = ?"
      bindings.push(status)
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    bindings.push(limit, offset)

    const stmt = this.db.prepare(query)
    const result = await stmt.bind(...bindings).all<Tenant>()

    return result.results || []
  }

  /**
   * List tenants from KV storage using scan
   */
  private async listTenantsFromKV(
    status: TenantStatus | undefined,
    limit: number,
    offset: number,
  ): Promise<Tenant[]> {
    const tenants: Tenant[] = []
    let count = 0
    let skipped = 0

    // Scan all tenant keys
    for await (const [key, value] of this.storage.scan(
      TENANT_STORAGE_KEYS.tenantPrefix,
    )) {
      // Skip domain lookup keys (they have 3 elements: ["tenant", "domain", "xxx"])
      if (key.length === 3 && key[1] === "domain") {
        continue
      }

      // Only process tenant data keys (they have 2 elements: ["tenant", "tenantId"])
      if (key.length !== 2) {
        continue
      }

      const tenant = value as Tenant

      // Filter by status if specified
      if (status && tenant.status !== status) {
        continue
      }

      // Handle offset
      if (skipped < offset) {
        skipped++
        continue
      }

      // Handle limit
      if (count >= limit) {
        break
      }

      tenants.push(tenant)
      count++
    }

    return tenants
  }

  /**
   * Normalize a domain to lowercase and trim whitespace
   *
   * @param domain - The domain to normalize
   * @returns Normalized domain
   */
  private normalizeDomain(domain: string): string {
    return domain.toLowerCase().trim()
  }

  /**
   * Validate domain format
   *
   * @param domain - The domain to validate
   * @returns true if valid, false otherwise
   */
  private isValidDomain(domain: string): boolean {
    // Basic domain validation - lowercase alphanumeric, dots, and hyphens
    // Must start and end with alphanumeric, no consecutive dots
    const domainRegex =
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/
    return domainRegex.test(domain)
  }
}

/**
 * Factory function to create a TenantServiceImpl
 *
 * @param storage - StorageAdapter for KV operations
 * @param db - Optional D1Database for admin queries
 * @returns A new TenantServiceImpl instance
 */
export function createTenantService(
  storage: StorageAdapter,
  db?: D1Database,
): TenantService {
  return new TenantServiceImpl(storage, db)
}
