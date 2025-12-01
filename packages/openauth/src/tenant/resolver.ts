/**
 * Tenant Resolution Middleware
 *
 * Resolves the current tenant from incoming requests using multiple strategies:
 * 1. Custom Domain: Extract from Host header (e.g., auth.clientcorp.com)
 * 2. Subdomain: Extract from Host header (e.g., clientcorp.auth.example.com -> clientcorp)
 * 3. Path Prefix: Extract from URL path (e.g., /tenants/tenant123/... -> tenant123)
 * 4. Header: X-Tenant-ID header
 * 5. Query: ?tenant=tenant123 query parameter
 *
 * @packageDocumentation
 */

import type { Context, MiddlewareHandler, Next } from "hono"
import type { StorageAdapter } from "../storage/storage.js"
import type {
  TenantService,
  Tenant,
  TenantStorage,
} from "../contracts/types.js"
import { TenantError } from "../contracts/types.js"
import { TenantStorageImpl } from "./storage.js"
import {
  DEFAULT_RESOLVER_CONFIG,
  type TenantResolverConfig,
  type TenantResolutionResult,
  type TenantResolutionStrategy,
} from "./types.js"

/**
 * Options for the tenant resolver middleware
 */
export interface TenantResolverOptions {
  /**
   * The tenant service for looking up tenants
   */
  service: TenantService

  /**
   * The base storage adapter for creating tenant-scoped storage
   */
  storage: StorageAdapter

  /**
   * Resolver configuration
   */
  config?: TenantResolverConfig

  /**
   * Whether to allow requests without a tenant (optional multi-tenancy)
   * @default false
   */
  optional?: boolean

  /**
   * Custom error handler
   */
  onError?: (ctx: Context, error: TenantError) => Response | Promise<Response>
}

/**
 * Create a tenant resolver middleware
 *
 * This middleware resolves the tenant from the request and attaches it to the context.
 * The tenant can be resolved from multiple sources with the following priority:
 *
 * 1. Custom Domain (Host header matches a tenant's domain)
 * 2. Subdomain (first part of Host header before base domain)
 * 3. Path Prefix (e.g., /tenants/tenant123/...)
 * 4. X-Tenant-ID header
 * 5. ?tenant=... query parameter
 *
 * After resolution, the following are available on the context:
 * - `c.get("tenant")` - The resolved Tenant object
 * - `c.get("tenantStorage")` - A TenantStorage instance scoped to this tenant
 * - `c.get("tenantResolution")` - Resolution metadata (strategy used, etc.)
 *
 * Testing checklist:
 * - Can resolve tenant by custom domain
 * - Can resolve tenant by subdomain
 * - Can resolve tenant by path prefix
 * - Can resolve tenant by X-Tenant-ID header
 * - Can resolve tenant by ?tenant query param
 * - Resolution priority is correct (custom domain > subdomain > path > header > query)
 * - Throws TenantError for tenant_not_found
 * - Throws TenantError for tenant_suspended
 * - Throws TenantError for tenant_deleted
 * - Sets tenant and tenantStorage on context
 * - Optional mode allows requests without tenant
 *
 * @param options - Resolver options
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * const app = new Hono()
 *
 * // Apply tenant resolution to all routes
 * app.use("*", createTenantResolver({
 *   service: tenantService,
 *   storage: kvStorage,
 *   config: {
 *     baseDomain: "auth.example.com",
 *     pathPrefix: "/tenants"
 *   }
 * }))
 *
 * app.get("/profile", (c) => {
 *   const tenant = c.get("tenant")
 *   const storage = c.get("tenantStorage")
 *   // Use tenant-scoped storage
 * })
 * ```
 */
export function createTenantResolver(
  options: TenantResolverOptions,
): MiddlewareHandler {
  const {
    service,
    storage,
    config = DEFAULT_RESOLVER_CONFIG,
    optional = false,
    onError,
  } = options

  return async function tenantResolverMiddleware(
    ctx: Context,
    next: Next,
  ): Promise<Response | void> {
    try {
      // Try to resolve tenant from request
      const resolution = await resolveTenantFromRequest(ctx, service, config)

      if (!resolution) {
        if (optional) {
          // No tenant found but that's OK in optional mode
          return next()
        }
        throw new TenantError(
          "tenant_not_found",
          "Unable to resolve tenant from request",
        )
      }

      // Get the full tenant object
      const tenant = await getTenantAndValidate(service, resolution)

      // Create tenant-scoped storage
      const tenantStorage = new TenantStorageImpl(storage, tenant.id)

      // Attach to context
      ctx.set("tenant", tenant)
      ctx.set("tenantStorage", tenantStorage)
      ctx.set("tenantResolution", resolution)

      return next()
    } catch (error) {
      if (error instanceof TenantError) {
        if (onError) {
          return onError(ctx, error)
        }

        // Default error response
        const status =
          error.code === "tenant_not_found"
            ? 404
            : error.code === "tenant_suspended" ||
                error.code === "tenant_deleted"
              ? 403
              : 400

        return ctx.json(
          {
            error: error.code,
            error_description: error.message,
          },
          status as any,
        )
      }

      // Unexpected error
      console.error("TenantResolver: Unexpected error:", error)
      return ctx.json(
        {
          error: "server_error",
          error_description: "Internal server error",
        },
        500,
      )
    }
  }
}

/**
 * Resolve tenant from request using configured strategies
 *
 * @param ctx - Hono context
 * @param service - Tenant service
 * @param config - Resolver configuration
 * @returns Resolution result or null if not found
 */
async function resolveTenantFromRequest(
  ctx: Context,
  service: TenantService,
  config: TenantResolverConfig,
): Promise<TenantResolutionResult | null> {
  const host = ctx.req.header("Host") || ""
  const url = new URL(ctx.req.url)

  // Strategy 1: Custom Domain
  // Try to look up the Host as a custom domain
  const customDomainResult = await tryCustomDomain(host, service, config)
  if (customDomainResult) {
    return customDomainResult
  }

  // Strategy 2: Subdomain
  // Extract subdomain from Host (e.g., clientcorp.auth.example.com -> clientcorp)
  const subdomainResult = trySubdomain(host, config)
  if (subdomainResult) {
    return subdomainResult
  }

  // Strategy 3: Path Prefix
  // Extract from URL path (e.g., /tenants/tenant123/... -> tenant123)
  const pathResult = tryPathPrefix(url.pathname, config)
  if (pathResult) {
    return pathResult
  }

  // Strategy 4: Header
  // Extract from X-Tenant-ID header
  const headerResult = tryHeader(ctx, config)
  if (headerResult) {
    return headerResult
  }

  // Strategy 5: Query Parameter
  // Extract from ?tenant=... query parameter
  const queryResult = tryQueryParam(url, config)
  if (queryResult) {
    return queryResult
  }

  return null
}

/**
 * Try to resolve tenant via custom domain lookup
 */
async function tryCustomDomain(
  host: string,
  service: TenantService,
  config: TenantResolverConfig,
): Promise<TenantResolutionResult | null> {
  if (!host) return null

  // Remove port if present
  const domain = host.split(":")[0].toLowerCase()

  // Skip if this is the base domain (not a custom domain)
  if (config.baseDomain && domain === config.baseDomain.toLowerCase()) {
    return null
  }

  // Skip if this looks like a subdomain of the base domain
  if (
    config.baseDomain &&
    domain.endsWith(`.${config.baseDomain.toLowerCase()}`)
  ) {
    return null
  }

  // Check known custom domains map if provided
  if (config.customDomains) {
    const tenantId = config.customDomains.get(domain)
    if (tenantId) {
      return { tenantId, strategy: "custom_domain" }
    }
  }

  // Try to look up domain in tenant service
  const tenant = await service.getTenantByDomain(domain)
  if (tenant) {
    return { tenantId: tenant.id, strategy: "custom_domain" }
  }

  return null
}

/**
 * Try to resolve tenant via subdomain extraction
 */
function trySubdomain(
  host: string,
  config: TenantResolverConfig,
): TenantResolutionResult | null {
  if (!host || !config.baseDomain) return null

  // Remove port if present
  const domain = host.split(":")[0].toLowerCase()
  const baseDomain = config.baseDomain.toLowerCase()

  // Check if host ends with base domain
  if (!domain.endsWith(`.${baseDomain}`)) {
    return null
  }

  // Extract subdomain (part before base domain)
  const subdomain = domain.slice(0, domain.length - baseDomain.length - 1)

  // Subdomain should be a single label (no dots)
  if (!subdomain || subdomain.includes(".")) {
    return null
  }

  // Use subdomain as tenant ID
  return { tenantId: subdomain, strategy: "subdomain" }
}

/**
 * Try to resolve tenant via path prefix
 */
function tryPathPrefix(
  pathname: string,
  config: TenantResolverConfig,
): TenantResolutionResult | null {
  const prefix = config.pathPrefix || "/tenants"

  // Check if path starts with prefix
  if (!pathname.startsWith(`${prefix}/`)) {
    return null
  }

  // Extract tenant ID from path
  // Path format: /tenants/tenant123/... or /tenants/tenant123
  const remaining = pathname.slice(prefix.length + 1)
  const tenantId = remaining.split("/")[0]

  if (!tenantId) {
    return null
  }

  return { tenantId, strategy: "path_prefix" }
}

/**
 * Try to resolve tenant via header
 */
function tryHeader(
  ctx: Context,
  config: TenantResolverConfig,
): TenantResolutionResult | null {
  const headerName = config.headerName || "X-Tenant-ID"
  const tenantId = ctx.req.header(headerName)

  if (!tenantId) {
    return null
  }

  return { tenantId, strategy: "header" }
}

/**
 * Try to resolve tenant via query parameter
 */
function tryQueryParam(
  url: URL,
  config: TenantResolverConfig,
): TenantResolutionResult | null {
  const paramName = config.queryParam || "tenant"
  const tenantId = url.searchParams.get(paramName)

  if (!tenantId) {
    return null
  }

  return { tenantId, strategy: "query" }
}

/**
 * Get and validate tenant, throwing appropriate errors
 */
async function getTenantAndValidate(
  service: TenantService,
  resolution: TenantResolutionResult,
): Promise<Tenant> {
  let tenant: Tenant | null = null

  // If resolution came from custom_domain, we already have the tenant
  // For other strategies, we need to look up by ID
  if (resolution.strategy === "custom_domain") {
    // The tenant was already looked up via domain
    tenant = await service.getTenant(resolution.tenantId)
  } else {
    tenant = await service.getTenant(resolution.tenantId)
  }

  if (!tenant) {
    throw new TenantError(
      "tenant_not_found",
      `Tenant '${resolution.tenantId}' not found`,
    )
  }

  // Validate tenant status
  switch (tenant.status) {
    case "suspended":
      throw new TenantError(
        "tenant_suspended",
        `Tenant '${tenant.id}' is suspended`,
      )
    case "deleted":
      throw new TenantError(
        "tenant_deleted",
        `Tenant '${tenant.id}' has been deleted`,
      )
    case "pending":
      // Allow pending tenants - they may be in setup
      break
    case "active":
      // Good to go
      break
    default:
      // Unknown status, treat as not found
      throw new TenantError(
        "tenant_not_found",
        `Tenant '${tenant.id}' has invalid status`,
      )
  }

  return tenant
}

/**
 * Helper function to get tenant from context
 *
 * @param ctx - Hono context
 * @returns The tenant or undefined if not resolved
 */
export function getTenant(ctx: Context): Tenant | undefined {
  return ctx.get("tenant")
}

/**
 * Helper function to get tenant storage from context
 *
 * @param ctx - Hono context
 * @returns The tenant storage or undefined if not resolved
 */
export function getTenantStorage(ctx: Context): TenantStorage | undefined {
  return ctx.get("tenantStorage")
}

/**
 * Helper function to require tenant from context
 *
 * @param ctx - Hono context
 * @returns The tenant
 * @throws TenantError if tenant is not resolved
 */
export function requireTenant(ctx: Context): Tenant {
  const tenant = getTenant(ctx)
  if (!tenant) {
    throw new TenantError(
      "tenant_not_found",
      "Tenant not resolved. Ensure tenant resolver middleware is applied.",
    )
  }
  return tenant
}

/**
 * Helper function to require tenant storage from context
 *
 * @param ctx - Hono context
 * @returns The tenant storage
 * @throws TenantError if tenant is not resolved
 */
export function requireTenantStorage(ctx: Context): TenantStorage {
  const storage = getTenantStorage(ctx)
  if (!storage) {
    throw new TenantError(
      "tenant_not_found",
      "Tenant storage not available. Ensure tenant resolver middleware is applied.",
    )
  }
  return storage
}

// Type augmentation for Hono context
declare module "hono" {
  interface ContextVariableMap {
    tenant?: Tenant
    tenantStorage?: TenantStorage
    tenantResolution?: TenantResolutionResult
  }
}
