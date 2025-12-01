/**
 * Tenant API Routes
 *
 * Provides RESTful CRUD endpoints for tenant management.
 *
 * Endpoints:
 * - POST /          - Create tenant
 * - GET /           - List tenants
 * - GET /:id        - Get tenant by ID
 * - PUT /:id        - Update tenant
 * - DELETE /:id     - Delete tenant (soft delete)
 * - PUT /:id/branding - Update branding only
 * - PUT /:id/settings - Update settings only
 *
 * @packageDocumentation
 */

import { Hono } from "hono"
import type {
  TenantService,
  Tenant,
  TenantBranding,
  TenantSettings,
  TenantStatus,
} from "../contracts/types.js"
import { TenantError } from "../contracts/types.js"
import type { CreateTenantParams, UpdateTenantParams } from "./types.js"

/**
 * Validation helper for tenant name
 */
function validateTenantName(name: unknown): string {
  if (!name || typeof name !== "string" || name.trim() === "") {
    throw new ValidationError("name", "Tenant name is required")
  }
  const trimmed = name.trim()
  if (trimmed.length < 2) {
    throw new ValidationError(
      "name",
      "Tenant name must be at least 2 characters",
    )
  }
  if (trimmed.length > 100) {
    throw new ValidationError(
      "name",
      "Tenant name must be at most 100 characters",
    )
  }
  return trimmed
}

/**
 * Validation helper for tenant ID
 */
function validateTenantId(id: unknown): string {
  if (!id || typeof id !== "string" || id.trim() === "") {
    throw new ValidationError("id", "Tenant ID is required")
  }
  const trimmed = id.trim()
  // ID should be alphanumeric with hyphens/underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new ValidationError(
      "id",
      "Tenant ID must contain only alphanumeric characters, hyphens, and underscores",
    )
  }
  if (trimmed.length < 2) {
    throw new ValidationError("id", "Tenant ID must be at least 2 characters")
  }
  if (trimmed.length > 50) {
    throw new ValidationError("id", "Tenant ID must be at most 50 characters")
  }
  return trimmed
}

/**
 * Validation helper for domain format
 */
function validateDomain(domain: unknown): string | undefined {
  if (domain === undefined || domain === null || domain === "") {
    return undefined
  }
  if (typeof domain !== "string") {
    throw new ValidationError("domain", "Domain must be a string")
  }
  const trimmed = domain.trim().toLowerCase()
  if (trimmed === "") {
    return undefined
  }
  // Basic domain validation
  const domainRegex =
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/
  if (!domainRegex.test(trimmed)) {
    throw new ValidationError(
      "domain",
      "Invalid domain format. Must be a valid hostname.",
    )
  }
  return trimmed
}

/**
 * Validation helper for status
 */
function validateStatus(status: unknown): TenantStatus | undefined {
  if (status === undefined || status === null) {
    return undefined
  }
  if (typeof status !== "string") {
    throw new ValidationError("status", "Status must be a string")
  }
  const validStatuses: TenantStatus[] = [
    "active",
    "suspended",
    "pending",
    "deleted",
  ]
  if (!validStatuses.includes(status as TenantStatus)) {
    throw new ValidationError(
      "status",
      `Status must be one of: ${validStatuses.join(", ")}`,
    )
  }
  return status as TenantStatus
}

/**
 * Validation error class
 */
class ValidationError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message)
    this.name = "ValidationError"
  }
}

/**
 * Create Hono routes for tenant CRUD API
 *
 * Testing checklist:
 * - POST / creates tenant successfully
 * - POST / returns 400 for missing name
 * - POST / returns 400 for invalid domain
 * - POST / returns 409 for duplicate domain
 * - GET / lists all tenants
 * - GET / filters by status
 * - GET / supports pagination (limit, offset)
 * - GET /:id returns tenant by ID
 * - GET /:id returns 404 for unknown ID
 * - PUT /:id updates tenant
 * - PUT /:id returns 404 for unknown ID
 * - DELETE /:id soft deletes tenant
 * - DELETE /:id returns 404 for unknown ID
 * - PUT /:id/branding updates branding only
 * - PUT /:id/settings updates settings only
 *
 * @param service - The tenant service implementation
 * @returns Hono app with tenant routes
 *
 * @example
 * ```typescript
 * import { Hono } from "hono"
 * import { tenantApiRoutes } from "./tenant/api.js"
 * import { createTenantService } from "./tenant/service.js"
 *
 * const tenantService = createTenantService(storage)
 * const app = new Hono()
 *
 * // Mount tenant API at /api/tenants
 * app.route("/api/tenants", tenantApiRoutes(tenantService))
 * ```
 */
export function tenantApiRoutes(service: TenantService): Hono {
  const app = new Hono()

  /**
   * Error handler helper
   */
  function handleError(ctx: any, error: unknown) {
    if (error instanceof ValidationError) {
      return ctx.json(
        {
          error: "validation_error",
          error_description: error.message,
          field: error.field,
        },
        400,
      )
    }

    if (error instanceof TenantError) {
      let status: number
      switch (error.code) {
        case "tenant_not_found":
          status = 404
          break
        case "domain_already_exists":
          status = 409
          break
        case "invalid_tenant_id":
          status = 400
          break
        case "tenant_suspended":
        case "tenant_deleted":
          status = 403
          break
        default:
          status = 400
      }
      return ctx.json(
        {
          error: error.code,
          error_description: error.message,
        },
        status,
      )
    }

    console.error("Tenant API error:", error)
    return ctx.json(
      {
        error: "server_error",
        error_description: "Internal server error",
      },
      500,
    )
  }

  /**
   * POST / - Create a new tenant
   *
   * Request body:
   * {
   *   "id": "tenant123",
   *   "name": "Acme Corp",
   *   "domain": "auth.acme.com",
   *   "branding": { "theme": { "primary": "#007bff" } },
   *   "settings": { "allowPublicRegistration": true }
   * }
   *
   * Response: 201 Created
   * {
   *   "id": "tenant123",
   *   "name": "Acme Corp",
   *   ...
   * }
   */
  app.post("/", async (ctx) => {
    try {
      const body = await ctx.req.json()

      const params: CreateTenantParams = {
        id: validateTenantId(body.id),
        name: validateTenantName(body.name),
        domain: validateDomain(body.domain),
        branding: body.branding as TenantBranding | undefined,
        settings: body.settings as TenantSettings | undefined,
      }

      const tenant = await service.createTenant(params)

      return ctx.json(tenant, 201)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  /**
   * GET / - List all tenants
   *
   * Query parameters:
   * - status: Filter by status (active, suspended, pending, deleted)
   * - limit: Max number of results (default: 100)
   * - offset: Number of results to skip (default: 0)
   *
   * Response: 200 OK
   * {
   *   "tenants": [...],
   *   "count": 10
   * }
   */
  app.get("/", async (ctx) => {
    try {
      const url = new URL(ctx.req.url)
      const statusParam = url.searchParams.get("status")
      const limitParam = url.searchParams.get("limit")
      const offsetParam = url.searchParams.get("offset")

      const status = statusParam ? validateStatus(statusParam) : undefined
      const limit = limitParam ? parseInt(limitParam, 10) : 100
      const offset = offsetParam ? parseInt(offsetParam, 10) : 0

      if (isNaN(limit) || limit < 1 || limit > 1000) {
        throw new ValidationError("limit", "Limit must be between 1 and 1000")
      }
      if (isNaN(offset) || offset < 0) {
        throw new ValidationError(
          "offset",
          "Offset must be a non-negative number",
        )
      }

      const tenants = await service.listTenants({ status, limit, offset })

      return ctx.json({
        tenants,
        count: tenants.length,
      })
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  /**
   * GET /:id - Get a tenant by ID
   *
   * Response: 200 OK
   * { "id": "tenant123", "name": "Acme Corp", ... }
   *
   * Response: 404 Not Found
   * { "error": "tenant_not_found", "error_description": "..." }
   */
  app.get("/:id", async (ctx) => {
    try {
      const id = ctx.req.param("id")
      const tenant = await service.getTenant(id)

      if (!tenant) {
        throw new TenantError("tenant_not_found", `Tenant '${id}' not found`)
      }

      return ctx.json(tenant)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  /**
   * PUT /:id - Update a tenant
   *
   * Request body:
   * {
   *   "name": "New Name",
   *   "domain": "new.domain.com",
   *   "status": "active",
   *   "branding": { ... },
   *   "settings": { ... }
   * }
   *
   * Response: 200 OK
   * { "id": "tenant123", "name": "New Name", ... }
   */
  app.put("/:id", async (ctx) => {
    try {
      const id = ctx.req.param("id")
      const body = await ctx.req.json()

      const updates: UpdateTenantParams = {}

      if (body.name !== undefined) {
        updates.name = validateTenantName(body.name)
      }
      if (body.domain !== undefined) {
        updates.domain = validateDomain(body.domain)
      }
      if (body.status !== undefined) {
        updates.status = validateStatus(body.status)
      }
      if (body.branding !== undefined) {
        updates.branding = body.branding as TenantBranding
      }
      if (body.settings !== undefined) {
        updates.settings = body.settings as TenantSettings
      }

      const tenant = await service.updateTenant(id, updates)

      return ctx.json(tenant)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  /**
   * DELETE /:id - Delete a tenant (soft delete)
   *
   * Response: 204 No Content
   *
   * Response: 404 Not Found
   * { "error": "tenant_not_found", "error_description": "..." }
   */
  app.delete("/:id", async (ctx) => {
    try {
      const id = ctx.req.param("id")
      await service.deleteTenant(id)
      return ctx.body(null, 204)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  /**
   * PUT /:id/branding - Update tenant branding only
   *
   * Request body:
   * {
   *   "theme": { "primary": "#007bff" },
   *   "logoLight": "https://...",
   *   "customCss": ".login { ... }"
   * }
   *
   * Response: 200 OK
   * { "id": "tenant123", "branding": { ... }, ... }
   */
  app.put("/:id/branding", async (ctx) => {
    try {
      const id = ctx.req.param("id")
      const branding = (await ctx.req.json()) as TenantBranding

      const tenant = await service.updateTenant(id, { branding })

      return ctx.json(tenant)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  /**
   * PUT /:id/settings - Update tenant settings only
   *
   * Request body:
   * {
   *   "allowPublicRegistration": true,
   *   "mfaRequired": false
   * }
   *
   * Response: 200 OK
   * { "id": "tenant123", "settings": { ... }, ... }
   */
  app.put("/:id/settings", async (ctx) => {
    try {
      const id = ctx.req.param("id")
      const settings = (await ctx.req.json()) as TenantSettings

      const tenant = await service.updateTenant(id, { settings })

      return ctx.json(tenant)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  return app
}

/**
 * Create tenant API routes with a service
 *
 * This is an alias for tenantApiRoutes for consistency with other modules.
 *
 * @param service - The tenant service implementation
 * @returns Hono app with tenant routes
 */
export const createTenantApi = tenantApiRoutes
