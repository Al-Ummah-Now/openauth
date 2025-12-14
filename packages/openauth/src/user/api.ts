import { Hono } from "hono"
import type { Context } from "hono"
import type { UserService } from "./service.js"
import type { UserStatus } from "./types.js"
import { UserError, UserValidationError } from "./errors.js"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_REGEX = /^[a-zA-Z0-9_-]+$/

function validateEmail(email: unknown): string {
  if (typeof email !== "string" || !email.trim()) {
    throw new UserValidationError("email", "Email is required")
  }
  const normalized = email.toLowerCase().trim()
  if (!EMAIL_REGEX.test(normalized)) {
    throw new UserValidationError("email", "Invalid email format")
  }
  if (normalized.length > 255) {
    throw new UserValidationError(
      "email",
      "Email must be 255 characters or less",
    )
  }
  return normalized
}

function validateUserId(id: string): string {
  if (!id || !UUID_REGEX.test(id)) {
    throw new UserValidationError("id", "Invalid user ID format")
  }
  return id
}

function getTenantId(ctx: Context): string {
  // Try to get tenant from context (set by tenant resolver middleware)
  const tenant = ctx.get("tenant") as { id: string } | undefined
  if (tenant?.id) {
    return tenant.id
  }
  // Fallback: try tenantId directly (for cases where it's set explicitly)
  const tenantId = (ctx as any).get("tenantId") as string | undefined
  if (tenantId) {
    return tenantId
  }
  throw new UserValidationError("tenant", "Tenant context is required")
}

type StatusCode = 400 | 403 | 404 | 409 | 500

function handleError(ctx: Context, error: unknown) {
  if (error instanceof UserValidationError) {
    return ctx.json(
      {
        error: "validation_error",
        error_description: error.message,
        field: error.field,
      },
      400,
    )
  }
  if (error instanceof UserError) {
    const statusMap: Record<string, StatusCode> = {
      user_not_found: 404,
      identity_not_found: 404,
      email_already_exists: 409,
      identity_already_linked: 409,
      user_suspended: 403,
      user_deleted: 403,
    }
    const status: StatusCode = statusMap[error.code] || 400
    return ctx.json(
      { error: error.code, error_description: error.message },
      status,
    )
  }
  console.error("User API error:", error)
  return ctx.json(
    { error: "server_error", error_description: "Internal server error" },
    500,
  )
}

export function userApiRoutes(service: UserService): Hono {
  const app = new Hono()

  // GET / - List users (paginated)
  app.get("/", async (ctx) => {
    try {
      const tenantId = getTenantId(ctx)

      const url = new URL(ctx.req.url)
      const result = await service.listUsers(tenantId, {
        status: url.searchParams.get("status") as UserStatus | undefined,
        email: url.searchParams.get("email") || undefined,
        cursor: url.searchParams.get("cursor") || undefined,
        limit: Math.min(parseInt(url.searchParams.get("limit") || "50"), 100),
        sort_by: (url.searchParams.get("sort_by") || "created_at") as any,
        sort_order: (url.searchParams.get("sort_order") || "desc") as any,
      })
      return ctx.json(result)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  // POST / - Create user
  app.post("/", async (ctx) => {
    try {
      const tenantId = getTenantId(ctx)

      const body = await ctx.req.json()
      const user = await service.createUser(tenantId, {
        email: validateEmail(body.email),
        name: typeof body.name === "string" ? body.name.trim() : undefined,
        metadata: typeof body.metadata === "object" ? body.metadata : undefined,
      })
      return ctx.json(user, 201)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  // GET /:id - Get user with identities
  app.get("/:id", async (ctx) => {
    try {
      const tenantId = getTenantId(ctx)

      const id = validateUserId(ctx.req.param("id"))
      const user = await service.getUserWithIdentities(tenantId, id)
      if (!user) throw new UserError("user_not_found", `User '${id}' not found`)
      return ctx.json(user)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  // PATCH /:id - Update user
  app.patch("/:id", async (ctx) => {
    try {
      const tenantId = getTenantId(ctx)

      const id = validateUserId(ctx.req.param("id"))
      const body = await ctx.req.json()
      const updates: any = {}
      if (body.email !== undefined) updates.email = validateEmail(body.email)
      if (body.name !== undefined)
        updates.name = body.name === null ? null : String(body.name).trim()
      if (body.metadata !== undefined) updates.metadata = body.metadata

      const user = await service.updateUser(tenantId, id, updates)
      return ctx.json(user)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  // DELETE /:id - Soft delete user
  app.delete("/:id", async (ctx) => {
    try {
      const tenantId = getTenantId(ctx)

      const id = validateUserId(ctx.req.param("id"))
      await service.deleteUser(tenantId, id)
      return ctx.body(null, 204)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  // POST /:id/suspend - Suspend user
  app.post("/:id/suspend", async (ctx) => {
    try {
      const tenantId = getTenantId(ctx)

      const id = validateUserId(ctx.req.param("id"))
      const result = await service.suspendUser(tenantId, id)
      return ctx.json(result)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  // POST /:id/unsuspend - Unsuspend user
  app.post("/:id/unsuspend", async (ctx) => {
    try {
      const tenantId = getTenantId(ctx)

      const id = validateUserId(ctx.req.param("id"))
      const user = await service.unsuspendUser(tenantId, id)
      return ctx.json(user)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  // DELETE /:id/sessions - Revoke all sessions
  app.delete("/:id/sessions", async (ctx) => {
    try {
      const tenantId = getTenantId(ctx)

      const id = validateUserId(ctx.req.param("id"))
      const result = await service.revokeUserSessions(tenantId, id)
      return ctx.json(result)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  // POST /:id/force-password-reset - Force user to reset password on next login
  app.post("/:id/force-password-reset", async (ctx) => {
    try {
      const tenantId = getTenantId(ctx)

      const id = validateUserId(ctx.req.param("id"))
      const user = await service.forcePasswordReset(tenantId, id)
      return ctx.json(user)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  // POST /:id/clear-password-reset - Clear the password reset required flag
  app.post("/:id/clear-password-reset", async (ctx) => {
    try {
      const tenantId = getTenantId(ctx)

      const id = validateUserId(ctx.req.param("id"))
      const user = await service.clearPasswordResetRequired(tenantId, id)
      return ctx.json(user)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  return app
}

export const createUserApi = userApiRoutes
