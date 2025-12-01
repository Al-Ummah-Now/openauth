/**
 * Admin Management API Endpoints for RBAC
 *
 * Provides HTTP endpoints for managing apps, roles, permissions, and assignments.
 * All endpoints require admin access.
 *
 * @packageDocumentation
 */

import { Hono } from "hono"
import type { RBACService } from "../contracts/types.js"
import { RBACError } from "../contracts/types.js"

/**
 * Context type for admin endpoints
 * Expects adminId (the user performing the action) and tenantId
 */
export interface AdminContext {
  Variables: {
    adminId: string
    tenantId: string
    isAdmin: boolean
  }
}

/**
 * Request body for creating an app
 */
interface CreateAppBody {
  id: string
  name: string
  description?: string
}

/**
 * Request body for creating a role
 */
interface CreateRoleBody {
  name: string
  description?: string
  isSystemRole?: boolean
}

/**
 * Request body for creating a permission
 */
interface CreatePermissionBody {
  name: string
  appId: string
  resource: string
  action: string
  description?: string
}

/**
 * Request body for assigning a role to a user
 */
interface AssignRoleBody {
  roleId: string
  expiresAt?: number
}

/**
 * Request body for assigning a permission to a role
 */
interface AssignPermissionBody {
  permissionId: string
}

/**
 * Create RBAC admin management endpoints
 *
 * TESTING CHECKLIST:
 * - POST /apps - Create app
 * - GET /apps - List apps
 * - POST /roles - Create role
 * - GET /roles - List roles
 * - POST /permissions - Create permission
 * - GET /permissions - List permissions (query: appId)
 * - POST /users/:userId/roles - Assign role to user
 * - DELETE /users/:userId/roles/:roleId - Remove role from user
 * - POST /roles/:roleId/permissions - Assign permission to role
 * - DELETE /roles/:roleId/permissions/:permissionId - Remove permission from role
 *
 * @param service - The RBAC service instance
 * @returns Hono router with admin endpoints
 *
 * @example
 * ```typescript
 * const rbac = new RBACServiceImpl(adapter, storage);
 * const app = new Hono();
 *
 * // Mount with admin authentication middleware
 * app.use('/admin/rbac/*', adminAuthMiddleware);
 * app.route('/admin/rbac', rbacAdminEndpoints(rbac));
 * ```
 */
export function rbacAdminEndpoints(service: RBACService): Hono<AdminContext> {
  const router = new Hono<AdminContext>()

  /**
   * Middleware to check admin access
   */
  router.use("*", async (c, next) => {
    const isAdmin = c.get("isAdmin")
    const adminId = c.get("adminId")
    const tenantId = c.get("tenantId")

    if (!adminId || !tenantId) {
      return c.json(
        { error: "Unauthorized", message: "Missing admin context" },
        401,
      )
    }

    if (!isAdmin) {
      return c.json(
        { error: "Forbidden", message: "Admin access required" },
        403,
      )
    }

    await next()
  })

  // ==========================================
  // App Management
  // ==========================================

  /**
   * POST /apps - Create a new app
   *
   * Request body:
   *   {
   *     "id": "my-app",
   *     "name": "My Application",
   *     "description": "Description of my app"
   *   }
   *
   * Response:
   *   {
   *     "id": "my-app",
   *     "name": "My Application",
   *     "tenant_id": "tenant-1",
   *     "description": "Description of my app",
   *     "created_at": 1699999999999
   *   }
   */
  router.post("/apps", async (c) => {
    const tenantId = c.get("tenantId")

    let body: CreateAppBody
    try {
      body = await c.req.json<CreateAppBody>()
    } catch {
      return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400)
    }

    if (!body.id || typeof body.id !== "string") {
      return c.json(
        {
          error: "Bad Request",
          message: "id is required and must be a string",
        },
        400,
      )
    }

    if (!body.name || typeof body.name !== "string") {
      return c.json(
        {
          error: "Bad Request",
          message: "name is required and must be a string",
        },
        400,
      )
    }

    // Validate app ID format (alphanumeric, hyphens, underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(body.id)) {
      return c.json(
        {
          error: "Bad Request",
          message:
            "id must contain only alphanumeric characters, hyphens, and underscores",
        },
        400,
      )
    }

    try {
      const app = await service.createApp({
        id: body.id,
        name: body.name,
        tenantId,
        description: body.description,
      })

      return c.json(app, 201)
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("UNIQUE constraint")
      ) {
        return c.json(
          { error: "Conflict", message: "App with this ID already exists" },
          409,
        )
      }
      throw error
    }
  })

  /**
   * GET /apps - List all apps for the tenant
   *
   * Response:
   *   {
   *     "apps": [
   *       {
   *         "id": "my-app",
   *         "name": "My Application",
   *         "tenant_id": "tenant-1",
   *         "description": "Description",
   *         "created_at": 1699999999999
   *       }
   *     ]
   *   }
   */
  router.get("/apps", async (c) => {
    const tenantId = c.get("tenantId")

    const apps = await service.listApps(tenantId)

    return c.json({ apps })
  })

  // ==========================================
  // Role Management
  // ==========================================

  /**
   * POST /roles - Create a new role
   *
   * Request body:
   *   {
   *     "name": "admin",
   *     "description": "Administrator role",
   *     "isSystemRole": false
   *   }
   *
   * Response:
   *   {
   *     "id": "role-uuid",
   *     "name": "admin",
   *     "tenant_id": "tenant-1",
   *     "description": "Administrator role",
   *     "is_system_role": false,
   *     "created_at": 1699999999999,
   *     "updated_at": 1699999999999
   *   }
   */
  router.post("/roles", async (c) => {
    const tenantId = c.get("tenantId")

    let body: CreateRoleBody
    try {
      body = await c.req.json<CreateRoleBody>()
    } catch {
      return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400)
    }

    if (!body.name || typeof body.name !== "string") {
      return c.json(
        {
          error: "Bad Request",
          message: "name is required and must be a string",
        },
        400,
      )
    }

    // Validate role name format
    if (!/^[a-zA-Z0-9_-]+$/.test(body.name)) {
      return c.json(
        {
          error: "Bad Request",
          message:
            "name must contain only alphanumeric characters, hyphens, and underscores",
        },
        400,
      )
    }

    const role = await service.createRole({
      name: body.name,
      tenantId,
      description: body.description,
      isSystemRole: body.isSystemRole,
    })

    return c.json(role, 201)
  })

  /**
   * GET /roles - List all roles for the tenant
   *
   * Response:
   *   {
   *     "roles": [
   *       {
   *         "id": "role-uuid",
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
    const tenantId = c.get("tenantId")

    const roles = await service.listRoles(tenantId)

    return c.json({ roles })
  })

  // ==========================================
  // Permission Management
  // ==========================================

  /**
   * POST /permissions - Create a new permission
   *
   * Request body:
   *   {
   *     "name": "posts:read",
   *     "appId": "my-app",
   *     "resource": "posts",
   *     "action": "read",
   *     "description": "Read blog posts"
   *   }
   *
   * Response:
   *   {
   *     "id": "perm-uuid",
   *     "name": "posts:read",
   *     "app_id": "my-app",
   *     "resource": "posts",
   *     "action": "read",
   *     "description": "Read blog posts",
   *     "created_at": 1699999999999
   *   }
   */
  router.post("/permissions", async (c) => {
    let body: CreatePermissionBody
    try {
      body = await c.req.json<CreatePermissionBody>()
    } catch {
      return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400)
    }

    if (!body.name || typeof body.name !== "string") {
      return c.json(
        {
          error: "Bad Request",
          message: "name is required and must be a string",
        },
        400,
      )
    }

    if (!body.appId || typeof body.appId !== "string") {
      return c.json(
        {
          error: "Bad Request",
          message: "appId is required and must be a string",
        },
        400,
      )
    }

    if (!body.resource || typeof body.resource !== "string") {
      return c.json(
        {
          error: "Bad Request",
          message: "resource is required and must be a string",
        },
        400,
      )
    }

    if (!body.action || typeof body.action !== "string") {
      return c.json(
        {
          error: "Bad Request",
          message: "action is required and must be a string",
        },
        400,
      )
    }

    // Validate permission name format (typically resource:action)
    if (!/^[a-zA-Z0-9_:.-]+$/.test(body.name)) {
      return c.json(
        {
          error: "Bad Request",
          message:
            "name must contain only alphanumeric characters, underscores, colons, dots, and hyphens",
        },
        400,
      )
    }

    const permission = await service.createPermission({
      name: body.name,
      appId: body.appId,
      resource: body.resource,
      action: body.action,
      description: body.description,
    })

    return c.json(permission, 201)
  })

  /**
   * GET /permissions - List permissions for an app
   *
   * Query parameters:
   *   appId - Required, the app ID to list permissions for
   *
   * Response:
   *   {
   *     "permissions": [
   *       {
   *         "id": "perm-uuid",
   *         "name": "posts:read",
   *         "app_id": "my-app",
   *         "resource": "posts",
   *         "action": "read",
   *         "description": "Read blog posts",
   *         "created_at": 1699999999999
   *       }
   *     ]
   *   }
   */
  router.get("/permissions", async (c) => {
    const appId = c.req.query("appId")

    if (!appId) {
      return c.json(
        { error: "Bad Request", message: "appId query parameter is required" },
        400,
      )
    }

    const permissions = await service.listPermissions(appId)

    return c.json({ permissions })
  })

  // ==========================================
  // User Role Assignment
  // ==========================================

  /**
   * POST /users/:userId/roles - Assign a role to a user
   *
   * Request body:
   *   {
   *     "roleId": "role-uuid",
   *     "expiresAt": 1700000000000  // optional
   *   }
   *
   * Response:
   *   {
   *     "user_id": "user-123",
   *     "role_id": "role-uuid",
   *     "tenant_id": "tenant-1",
   *     "assigned_at": 1699999999999,
   *     "expires_at": 1700000000000,
   *     "assigned_by": "admin-user"
   *   }
   */
  router.post("/users/:userId/roles", async (c) => {
    const tenantId = c.get("tenantId")
    const adminId = c.get("adminId")
    const userId = c.req.param("userId")

    if (!userId) {
      return c.json(
        { error: "Bad Request", message: "userId is required" },
        400,
      )
    }

    let body: AssignRoleBody
    try {
      body = await c.req.json<AssignRoleBody>()
    } catch {
      return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400)
    }

    if (!body.roleId || typeof body.roleId !== "string") {
      return c.json(
        {
          error: "Bad Request",
          message: "roleId is required and must be a string",
        },
        400,
      )
    }

    // Validate expiresAt if provided
    if (body.expiresAt !== undefined) {
      if (typeof body.expiresAt !== "number" || body.expiresAt <= Date.now()) {
        return c.json(
          {
            error: "Bad Request",
            message: "expiresAt must be a future timestamp",
          },
          400,
        )
      }
    }

    try {
      const userRole = await service.assignRoleToUser({
        userId,
        roleId: body.roleId,
        tenantId,
        assignedBy: adminId,
        expiresAt: body.expiresAt,
      })

      return c.json(userRole, 201)
    } catch (error) {
      if (error instanceof RBACError) {
        if (error.code === "role_already_assigned") {
          return c.json({ error: "Conflict", message: error.message }, 409)
        }
        if (error.code === "role_not_found") {
          return c.json({ error: "Not Found", message: error.message }, 404)
        }
      }
      throw error
    }
  })

  /**
   * DELETE /users/:userId/roles/:roleId - Remove a role from a user
   *
   * Response: 204 No Content
   */
  router.delete("/users/:userId/roles/:roleId", async (c) => {
    const tenantId = c.get("tenantId")
    const userId = c.req.param("userId")
    const roleId = c.req.param("roleId")

    if (!userId || !roleId) {
      return c.json(
        { error: "Bad Request", message: "userId and roleId are required" },
        400,
      )
    }

    await service.removeRoleFromUser({
      userId,
      roleId,
      tenantId,
    })

    return c.body(null, 204)
  })

  /**
   * GET /users/:userId/roles - List roles assigned to a user
   *
   * Response:
   *   {
   *     "userRoles": [
   *       {
   *         "user_id": "user-123",
   *         "role_id": "role-uuid",
   *         "tenant_id": "tenant-1",
   *         "assigned_at": 1699999999999,
   *         "expires_at": null,
   *         "assigned_by": "admin-user"
   *       }
   *     ]
   *   }
   */
  router.get("/users/:userId/roles", async (c) => {
    const tenantId = c.get("tenantId")
    const userId = c.req.param("userId")

    if (!userId) {
      return c.json(
        { error: "Bad Request", message: "userId is required" },
        400,
      )
    }

    const userRoles = await service.listUserRoles(userId, tenantId)

    return c.json({ userRoles })
  })

  // ==========================================
  // Role Permission Assignment
  // ==========================================

  /**
   * POST /roles/:roleId/permissions - Assign a permission to a role
   *
   * Request body:
   *   {
   *     "permissionId": "perm-uuid"
   *   }
   *
   * Response:
   *   {
   *     "role_id": "role-uuid",
   *     "permission_id": "perm-uuid",
   *     "granted_at": 1699999999999,
   *     "granted_by": "admin-user"
   *   }
   */
  router.post("/roles/:roleId/permissions", async (c) => {
    const adminId = c.get("adminId")
    const roleId = c.req.param("roleId")

    if (!roleId) {
      return c.json(
        { error: "Bad Request", message: "roleId is required" },
        400,
      )
    }

    let body: AssignPermissionBody
    try {
      body = await c.req.json<AssignPermissionBody>()
    } catch {
      return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400)
    }

    if (!body.permissionId || typeof body.permissionId !== "string") {
      return c.json(
        {
          error: "Bad Request",
          message: "permissionId is required and must be a string",
        },
        400,
      )
    }

    try {
      const rolePermission = await service.assignPermissionToRole({
        roleId,
        permissionId: body.permissionId,
        grantedBy: adminId,
      })

      return c.json(rolePermission, 201)
    } catch (error) {
      if (error instanceof RBACError) {
        if (error.code === "role_already_assigned") {
          return c.json({ error: "Conflict", message: error.message }, 409)
        }
        if (
          error.code === "role_not_found" ||
          error.code === "permission_not_found"
        ) {
          return c.json({ error: "Not Found", message: error.message }, 404)
        }
      }
      throw error
    }
  })

  /**
   * DELETE /roles/:roleId/permissions/:permissionId - Remove a permission from a role
   *
   * Response: 204 No Content
   */
  router.delete("/roles/:roleId/permissions/:permissionId", async (c) => {
    const roleId = c.req.param("roleId")
    const permissionId = c.req.param("permissionId")

    if (!roleId || !permissionId) {
      return c.json(
        {
          error: "Bad Request",
          message: "roleId and permissionId are required",
        },
        400,
      )
    }

    await service.removePermissionFromRole({
      roleId,
      permissionId,
    })

    return c.body(null, 204)
  })

  /**
   * GET /roles/:roleId/permissions - List permissions for a role
   *
   * Response:
   *   {
   *     "permissions": [
   *       {
   *         "id": "perm-uuid",
   *         "name": "posts:read",
   *         "app_id": "my-app",
   *         "resource": "posts",
   *         "action": "read",
   *         "description": "Read blog posts",
   *         "created_at": 1699999999999
   *       }
   *     ]
   *   }
   */
  router.get("/roles/:roleId/permissions", async (c) => {
    const roleId = c.req.param("roleId")

    if (!roleId) {
      return c.json(
        { error: "Bad Request", message: "roleId is required" },
        400,
      )
    }

    const permissions = await service.listRolePermissions(roleId)

    return c.json({ permissions })
  })

  return router
}

/**
 * Create admin authentication middleware
 *
 * This is a reference implementation - you should adapt to your auth system.
 *
 * @param extractAdmin - Function to extract admin context from request
 * @returns Middleware that sets admin context
 *
 * @example
 * ```typescript
 * const extractAdmin = async (req: Request) => {
 *   const token = req.headers.get('Authorization')?.replace('Bearer ', '');
 *   const decoded = jwt.verify(token, secret);
 *   return {
 *     adminId: decoded.sub,
 *     tenantId: decoded.tid,
 *     isAdmin: decoded.roles?.includes('admin') || false
 *   };
 * };
 *
 * app.use('/admin/rbac/*', createAdminMiddleware(extractAdmin));
 * ```
 */
export function createAdminMiddleware(
  extractAdmin: (
    req: Request,
  ) => Promise<{ adminId: string; tenantId: string; isAdmin: boolean } | null>,
) {
  return async (
    c: {
      req: { raw: Request }
      set: (key: string, value: string | boolean) => void
      json: (data: unknown, status?: number) => Response
    },
    next: () => Promise<void>,
  ) => {
    const context = await extractAdmin(c.req.raw)

    if (!context) {
      return c.json(
        { error: "Unauthorized", message: "Invalid or missing token" },
        401,
      )
    }

    c.set("adminId", context.adminId)
    c.set("tenantId", context.tenantId)
    c.set("isAdmin", context.isAdmin)

    await next()
  }
}
