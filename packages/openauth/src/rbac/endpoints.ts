/**
 * Permission Check API Endpoints
 *
 * Provides HTTP endpoints for checking user permissions.
 * All endpoints require a valid access token.
 *
 * @packageDocumentation
 */

import { Hono } from "hono"
import type { RBACService } from "../contracts/types.js"

/**
 * Context type for RBAC endpoints
 * Expects userId, tenantId, and optionally clientId from middleware
 */
export interface RBACContext {
  Variables: {
    userId: string
    tenantId: string
    clientId?: string
  }
}

/**
 * Request body for single permission check
 */
interface CheckPermissionBody {
  permission: string
}

/**
 * Request body for batch permission check
 */
interface BatchCheckBody {
  permissions: string[]
}

/**
 * Create RBAC permission check endpoints
 *
 * TESTING CHECKLIST:
 * - POST /check - Check single permission
 * - POST /check/batch - Check multiple permissions
 * - GET /permissions - Get user permissions for app
 * - GET /roles - Get user roles
 *
 * @param service - The RBAC service instance
 * @returns Hono router with permission check endpoints
 *
 * @example
 * ```typescript
 * const rbac = new RBACServiceImpl(adapter, storage);
 * const app = new Hono();
 *
 * // Mount with authentication middleware
 * app.use('/rbac/*', authMiddleware);
 * app.route('/rbac', rbacEndpoints(rbac));
 * ```
 */
export function rbacEndpoints(service: RBACService): Hono<RBACContext> {
  const router = new Hono<RBACContext>()

  /**
   * POST /check - Check if user has a specific permission
   *
   * Request body:
   *   { "permission": "posts:read" }
   *
   * Response:
   *   { "allowed": true }
   */
  router.post("/check", async (c) => {
    const userId = c.get("userId")
    const tenantId = c.get("tenantId")
    const defaultAppId = c.get("clientId")

    if (!userId || !tenantId) {
      return c.json(
        { error: "Unauthorized", message: "Missing user context" },
        401,
      )
    }

    let body: CheckPermissionBody
    try {
      body = await c.req.json<CheckPermissionBody>()
    } catch {
      return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400)
    }

    if (!body.permission || typeof body.permission !== "string") {
      return c.json(
        {
          error: "Bad Request",
          message: "permission is required and must be a string",
        },
        400,
      )
    }

    // Get clientId from query or context
    const clientId = c.req.query("clientId") || defaultAppId
    if (!clientId) {
      return c.json(
        {
          error: "Bad Request",
          message:
            "clientId is required (via query parameter or token audience)",
        },
        400,
      )
    }

    const allowed = await service.checkPermission({
      userId,
      clientId,
      tenantId,
      permission: body.permission,
    })

    return c.json({ allowed })
  })

  /**
   * POST /check/batch - Check multiple permissions at once
   *
   * Request body:
   *   { "permissions": ["posts:read", "posts:write", "posts:delete"] }
   *
   * Response:
   *   {
   *     "results": {
   *       "posts:read": true,
   *       "posts:write": true,
   *       "posts:delete": false
   *     }
   *   }
   */
  router.post("/check/batch", async (c) => {
    const userId = c.get("userId")
    const tenantId = c.get("tenantId")
    const defaultAppId = c.get("clientId")

    if (!userId || !tenantId) {
      return c.json(
        { error: "Unauthorized", message: "Missing user context" },
        401,
      )
    }

    let body: BatchCheckBody
    try {
      body = await c.req.json<BatchCheckBody>()
    } catch {
      return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400)
    }

    if (!Array.isArray(body.permissions)) {
      return c.json(
        {
          error: "Bad Request",
          message: "permissions is required and must be an array",
        },
        400,
      )
    }

    if (body.permissions.length === 0) {
      return c.json({ results: {} })
    }

    if (body.permissions.length > 100) {
      return c.json(
        {
          error: "Bad Request",
          message: "Maximum 100 permissions per batch request",
        },
        400,
      )
    }

    if (!body.permissions.every((p) => typeof p === "string")) {
      return c.json(
        {
          error: "Bad Request",
          message: "All permissions must be strings",
        },
        400,
      )
    }

    // Get clientId from query or context
    const clientId = c.req.query("clientId") || defaultAppId
    if (!clientId) {
      return c.json(
        {
          error: "Bad Request",
          message:
            "clientId is required (via query parameter or token audience)",
        },
        400,
      )
    }

    const results = await service.checkPermissions({
      userId,
      clientId,
      tenantId,
      permissions: body.permissions,
    })

    return c.json({ results })
  })

  /**
   * GET /permissions - Get all permissions for user in an app
   *
   * Query parameters:
   *   clientId - Optional, defaults to token audience
   *
   * Response:
   *   { "permissions": ["posts:read", "posts:write", "users:read"] }
   */
  router.get("/permissions", async (c) => {
    const userId = c.get("userId")
    const tenantId = c.get("tenantId")
    const defaultAppId = c.get("clientId")

    if (!userId || !tenantId) {
      return c.json(
        { error: "Unauthorized", message: "Missing user context" },
        401,
      )
    }

    // Get clientId from query or context
    const clientId = c.req.query("clientId") || defaultAppId
    if (!clientId) {
      return c.json(
        {
          error: "Bad Request",
          message:
            "clientId is required (via query parameter or token audience)",
        },
        400,
      )
    }

    const permissions = await service.getUserPermissions({
      userId,
      clientId,
      tenantId,
    })

    return c.json({ permissions })
  })

  /**
   * GET /roles - Get all roles for user
   *
   * Response:
   *   {
   *     "roles": [
   *       {
   *         "id": "role-123",
   *         "name": "admin",
   *         "tenant_id": "tenant-1",
   *         "description": "Administrator role",
   *         "is_system_role": false,
   *         "created_at": 1699999999999,
   *         "updated_at": 1699999999999
   *       }
   *     ]
   *   }
   */
  router.get("/roles", async (c) => {
    const userId = c.get("userId")
    const tenantId = c.get("tenantId")

    if (!userId || !tenantId) {
      return c.json(
        { error: "Unauthorized", message: "Missing user context" },
        401,
      )
    }

    const roles = await service.getUserRoles(userId, tenantId)

    return c.json({ roles })
  })

  return router
}

/**
 * Create a middleware that extracts RBAC context from request
 *
 * This is a reference implementation - you should adapt to your auth system.
 *
 * @param extractContext - Function to extract userId, tenantId, clientId from request
 * @returns Middleware that sets RBAC context
 *
 * @example
 * ```typescript
 * const extractFromJWT = async (req: Request) => {
 *   const token = req.headers.get('Authorization')?.replace('Bearer ', '');
 *   const decoded = jwt.verify(token, secret);
 *   return {
 *     userId: decoded.sub,
 *     tenantId: decoded.tid,
 *     clientId: decoded.aud
 *   };
 * };
 *
 * app.use('/rbac/*', createRBACContextMiddleware(extractFromJWT));
 * ```
 */
export function createRBACContextMiddleware(
  extractContext: (
    req: Request,
  ) => Promise<{ userId: string; tenantId: string; clientId?: string } | null>,
) {
  return async (
    c: {
      req: { raw: Request }
      set: (key: string, value: string) => void
      json: (data: unknown, status?: number) => Response
    },
    next: () => Promise<void>,
  ) => {
    const context = await extractContext(c.req.raw)

    if (!context) {
      return c.json(
        { error: "Unauthorized", message: "Invalid or missing token" },
        401,
      )
    }

    c.set("userId", context.userId)
    c.set("tenantId", context.tenantId)
    if (context.clientId) {
      c.set("clientId", context.clientId)
    }

    await next()
  }
}
