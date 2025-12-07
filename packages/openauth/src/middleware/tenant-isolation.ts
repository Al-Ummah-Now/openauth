/**
 * Tenant Isolation Middleware
 */

import { createMiddleware } from "hono/factory"
import { TenantMismatchError } from "./errors.js"

/**
 * Middleware that ensures tenant ID matches between token and request
 *
 * @param headerName - Header containing tenant ID (default: X-Tenant-ID)
 * @param paramName - Route parameter containing tenant ID (optional)
 */
export function requireTenantMatch(options?: {
  headerName?: string
  paramName?: string
  allowSuperAdmin?: boolean
}) {
  const headerName = options?.headerName || "X-Tenant-ID"
  const paramName = options?.paramName

  return createMiddleware(async (c, next) => {
    const tokenTenantId = c.get("tenantId")
    const scopes = c.get("scopes") || []

    // Super admin can access any tenant
    if (options?.allowSuperAdmin && scopes.includes("admin:super")) {
      await next()
      return
    }

    // Check header tenant
    const headerTenantId = c.req.header(headerName)
    if (headerTenantId && headerTenantId !== tokenTenantId) {
      throw new TenantMismatchError()
    }

    // Check route param tenant
    if (paramName) {
      const paramTenantId = c.req.param(paramName)
      if (paramTenantId && paramTenantId !== tokenTenantId) {
        throw new TenantMismatchError()
      }
    }

    // Set tenant ID from token for downstream use
    c.set("tenantId", tokenTenantId)

    await next()
  })
}

/**
 * Middleware that extracts tenant from subdomain
 */
export function tenantFromSubdomain(baseDomain: string) {
  return createMiddleware(async (c, next) => {
    const host = c.req.header("Host") || ""

    if (host.endsWith(baseDomain)) {
      const subdomain = host.slice(0, -baseDomain.length - 1) // Remove ".baseDomain"
      if (subdomain && subdomain !== "www") {
        c.set("tenantId", subdomain)
      }
    }

    await next()
  })
}

/**
 * Middleware that ensures request body tenant matches token tenant
 */
export function requireBodyTenantMatch(fieldName = "tenant_id") {
  return createMiddleware(async (c, next) => {
    const tokenTenantId = c.get("tenantId")
    const scopes = c.get("scopes") || []

    // Super admin can set any tenant
    if (scopes.includes("admin:super")) {
      await next()
      return
    }

    // Only check for POST/PUT/PATCH with JSON body
    const method = c.req.method
    if (!["POST", "PUT", "PATCH"].includes(method)) {
      await next()
      return
    }

    const contentType = c.req.header("Content-Type") || ""
    if (!contentType.includes("application/json")) {
      await next()
      return
    }

    try {
      const body = await c.req.json()
      if (body[fieldName] && body[fieldName] !== tokenTenantId) {
        throw new TenantMismatchError()
      }
    } catch (e) {
      if (e instanceof TenantMismatchError) throw e
      // Ignore JSON parse errors - let downstream handle
    }

    await next()
  })
}
