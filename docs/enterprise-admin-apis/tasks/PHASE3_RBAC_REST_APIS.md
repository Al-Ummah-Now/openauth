# Phase 3: RBAC REST APIs Implementation

## Overview

Extend existing RBAC implementation with missing CRUD endpoints for roles and permissions.

## Current State Analysis

**Already Implemented** in `/packages/openauth/src/rbac/admin-endpoints.ts`:
- `POST /roles` - Create role
- `GET /roles` - List roles
- `POST /permissions` - Create permission
- `GET /permissions?appId=` - List permissions
- `POST /users/:userId/roles` - Assign role
- `GET /users/:userId/roles` - Get user roles
- `DELETE /users/:userId/roles/:roleId` - Remove role
- `POST /roles/:roleId/permissions` - Assign permission
- `DELETE /roles/:roleId/permissions/:permId` - Remove permission
- `GET /roles/:roleId/permissions` - List role permissions

**Missing Endpoints** to implement:
- `GET /roles/:id` - Get single role with permissions
- `PATCH /roles/:id` - Update role
- `DELETE /roles/:id` - Delete role (with cascade)
- `DELETE /permissions/:id` - Delete permission (with cascade)

## Files to Modify

### 1. Extend D1 Adapter: `/packages/openauth/src/rbac/d1-adapter.ts`

Add these methods to the existing adapter:

```typescript
/**
 * Update a role
 */
async updateRole(
  roleId: string,
  tenantId: string,
  updates: { name?: string; description?: string }
): Promise<Role> {
  const now = Date.now()
  const setClauses: string[] = ["updated_at = ?"]
  const values: (string | number | null)[] = [now]

  if (updates.name !== undefined) {
    if (!/^[a-zA-Z0-9_-]+$/.test(updates.name)) {
      throw new RBACError(
        "invalid_input",
        "Role name must contain only alphanumeric characters, hyphens, and underscores"
      )
    }
    setClauses.push("name = ?")
    values.push(updates.name)
  }

  if (updates.description !== undefined) {
    setClauses.push("description = ?")
    values.push(updates.description ?? null)
  }

  values.push(roleId, tenantId)

  await this.db
    .prepare(
      `UPDATE rbac_roles SET ${setClauses.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
    .bind(...values)
    .run()

  const updated = await this.getRole(roleId, tenantId)
  if (!updated) {
    throw new RBACError("role_not_found", "Role not found")
  }

  return updated
}

/**
 * Delete a role and all associated assignments
 */
async deleteRole(roleId: string, tenantId: string): Promise<void> {
  const role = await this.getRole(roleId, tenantId)
  if (!role) {
    throw new RBACError("role_not_found", "Role not found")
  }

  if (role.is_system_role) {
    throw new RBACError("cannot_delete_system_role", "Cannot delete system role")
  }

  // Delete in order: user_roles -> role_permissions -> role
  await this.db
    .prepare("DELETE FROM rbac_user_roles WHERE role_id = ? AND tenant_id = ?")
    .bind(roleId, tenantId)
    .run()

  await this.db
    .prepare("DELETE FROM rbac_role_permissions WHERE role_id = ?")
    .bind(roleId)
    .run()

  await this.db
    .prepare("DELETE FROM rbac_roles WHERE id = ? AND tenant_id = ?")
    .bind(roleId, tenantId)
    .run()
}

/**
 * Delete a permission and remove from all roles
 */
async deletePermission(permissionId: string, appId?: string): Promise<void> {
  const permission = await this.getPermission(permissionId)
  if (!permission) {
    throw new RBACError("permission_not_found", "Permission not found")
  }

  if (appId && permission.app_id !== appId) {
    throw new RBACError("permission_not_found", "Permission not found in specified app")
  }

  // Remove from all roles first
  await this.db
    .prepare("DELETE FROM rbac_role_permissions WHERE permission_id = ?")
    .bind(permissionId)
    .run()

  // Delete the permission
  await this.db
    .prepare("DELETE FROM rbac_permissions WHERE id = ?")
    .bind(permissionId)
    .run()
}
```

### 2. Extend Service: `/packages/openauth/src/rbac/service.ts`

Add these methods:

```typescript
/**
 * Get a role by ID
 */
async getRole(roleId: string, tenantId: string): Promise<Role | null> {
  return this.adapter.getRole(roleId, tenantId)
}

/**
 * Get a permission by ID
 */
async getPermission(permissionId: string): Promise<Permission | null> {
  return this.adapter.getPermission(permissionId)
}

/**
 * Update a role
 */
async updateRole(params: {
  roleId: string
  tenantId: string
  name?: string
  description?: string
}): Promise<Role> {
  return this.adapter.updateRole(params.roleId, params.tenantId, {
    name: params.name,
    description: params.description,
  })
}

/**
 * Delete a role with cascading cleanup
 */
async deleteRole(roleId: string, tenantId: string): Promise<void> {
  // Invalidate cache for affected users before deletion
  await this.invalidateRoleCache(roleId, tenantId)
  await this.adapter.deleteRole(roleId, tenantId)
}

/**
 * Delete a permission with cascading cleanup
 */
async deletePermission(permissionId: string): Promise<void> {
  await this.adapter.deletePermission(permissionId)
}

/**
 * Invalidate cache for users with a specific role
 */
private async invalidateRoleCache(roleId: string, tenantId: string): Promise<void> {
  // Get all users with this role and invalidate their permission cache
  const usersWithRole = await this.adapter.getUsersWithRole(roleId, tenantId)
  for (const userId of usersWithRole) {
    await this.invalidateUserCache(tenantId, userId)
  }
}
```

### 3. Update RBACService Interface: `/packages/openauth/src/contracts/types.ts`

Add to the interface:

```typescript
export interface RBACService {
  // ... existing methods ...

  // Get operations
  getRole(roleId: string, tenantId: string): Promise<Role | null>
  getPermission(permissionId: string): Promise<Permission | null>

  // Update operations
  updateRole(params: {
    roleId: string
    tenantId: string
    name?: string
    description?: string
  }): Promise<Role>

  // Delete operations
  deleteRole(roleId: string, tenantId: string): Promise<void>
  deletePermission(permissionId: string): Promise<void>
}
```

### 4. Add API Endpoints: `/packages/openauth/src/rbac/admin-endpoints.ts`

Add these routes to the existing `rbacAdminEndpoints` function:

```typescript
/**
 * GET /roles/:roleId - Get a single role with its permissions
 */
router.get("/roles/:roleId", async (c) => {
  const tenantId = c.get("tenantId")
  const roleId = c.req.param("roleId")

  if (!roleId) {
    return c.json({ error: "Bad Request", message: "roleId is required" }, 400)
  }

  const role = await service.getRole(roleId, tenantId)
  if (!role) {
    return c.json({ error: "Not Found", message: "Role not found" }, 404)
  }

  const permissions = await service.listRolePermissions(roleId)

  return c.json({ role, permissions })
})

/**
 * PATCH /roles/:roleId - Update a role
 */
router.patch("/roles/:roleId", async (c) => {
  const tenantId = c.get("tenantId")
  const roleId = c.req.param("roleId")

  if (!roleId) {
    return c.json({ error: "Bad Request", message: "roleId is required" }, 400)
  }

  let body: { name?: string; description?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400)
  }

  if (body.name === undefined && body.description === undefined) {
    return c.json({
      error: "Bad Request",
      message: "At least one of name or description must be provided",
    }, 400)
  }

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.length === 0) {
      return c.json({ error: "Bad Request", message: "name must be a non-empty string" }, 400)
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(body.name)) {
      return c.json({
        error: "Bad Request",
        message: "name must contain only alphanumeric characters, hyphens, and underscores",
      }, 400)
    }
  }

  try {
    const role = await service.updateRole({
      roleId,
      tenantId,
      name: body.name,
      description: body.description,
    })
    return c.json(role)
  } catch (error) {
    if (error instanceof RBACError) {
      if (error.code === "role_not_found") {
        return c.json({ error: "Not Found", message: error.message }, 404)
      }
      if (error.code === "invalid_input") {
        return c.json({ error: "Bad Request", message: error.message }, 400)
      }
    }
    throw error
  }
})

/**
 * DELETE /roles/:roleId - Delete a role
 */
router.delete("/roles/:roleId", async (c) => {
  const tenantId = c.get("tenantId")
  const roleId = c.req.param("roleId")

  if (!roleId) {
    return c.json({ error: "Bad Request", message: "roleId is required" }, 400)
  }

  try {
    await service.deleteRole(roleId, tenantId)
    return c.body(null, 204)
  } catch (error) {
    if (error instanceof RBACError) {
      if (error.code === "role_not_found") {
        return c.json({ error: "Not Found", message: error.message }, 404)
      }
      if (error.code === "cannot_delete_system_role") {
        return c.json({ error: "Forbidden", message: error.message }, 403)
      }
    }
    throw error
  }
})

/**
 * DELETE /permissions/:permissionId - Delete a permission
 */
router.delete("/permissions/:permissionId", async (c) => {
  const permissionId = c.req.param("permissionId")

  if (!permissionId) {
    return c.json({ error: "Bad Request", message: "permissionId is required" }, 400)
  }

  try {
    await service.deletePermission(permissionId)
    return c.body(null, 204)
  } catch (error) {
    if (error instanceof RBACError) {
      if (error.code === "permission_not_found") {
        return c.json({ error: "Not Found", message: error.message }, 404)
      }
    }
    throw error
  }
})
```

## API Request/Response Types

Add to `/packages/openauth/src/rbac/api-types.ts`:

```typescript
/** Request body for updating a role */
export interface UpdateRoleRequest {
  name?: string
  description?: string
}

/** Response for getting a single role with permissions */
export interface GetRoleResponse {
  role: Role
  permissions: Permission[]
}

/** Standard error response */
export interface ErrorResponse {
  error: string
  message: string
}
```

## Cascading Delete Behavior

### Role Deletion
```
DELETE Role
  │
  ├── 1. Invalidate cache for all users with this role
  │
  ├── 2. DELETE FROM rbac_user_roles WHERE role_id = ?
  │
  ├── 3. DELETE FROM rbac_role_permissions WHERE role_id = ?
  │
  └── 4. DELETE FROM rbac_roles WHERE id = ?
```

### Permission Deletion
```
DELETE Permission
  │
  ├── 1. DELETE FROM rbac_role_permissions WHERE permission_id = ?
  │
  └── 2. DELETE FROM rbac_permissions WHERE id = ?
```

## Required Scopes

| Endpoint | Method | Required Scope |
|----------|--------|----------------|
| /roles/:id | GET | roles:read |
| /roles/:id | PATCH | roles:write |
| /roles/:id | DELETE | roles:delete |
| /permissions/:id | DELETE | permissions:delete |

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| role_not_found | 404 | Role does not exist |
| permission_not_found | 404 | Permission does not exist |
| cannot_delete_system_role | 403 | System roles cannot be deleted |
| invalid_input | 400 | Invalid input (e.g., bad role name format) |

## Validation Rules

| Field | Pattern | Description |
|-------|---------|-------------|
| Role name | `^[a-zA-Z0-9_-]+$` | Alphanumeric, hyphens, underscores |
| Role name length | 1-100 chars | Max 100 characters |
| Permission name | `^[a-zA-Z0-9_:.-]+$` | Alphanumeric, underscores, colons, dots, hyphens |

## Tests

### Unit Tests

```typescript
describe("RBAC Admin API - Extended", () => {
  describe("GET /roles/:roleId", () => {
    it("should return role with permissions", async () => {
      // Create role and assign permissions
      // GET role
      // Verify response includes both role and permissions
    })

    it("should return 404 for non-existent role", async () => {
      const res = await app.request("/admin/rbac/roles/non-existent")
      expect(res.status).toBe(404)
    })
  })

  describe("PATCH /roles/:roleId", () => {
    it("should update role name", async () => {
      // Create role
      // PATCH with new name
      // Verify name updated
    })

    it("should reject invalid role name format", async () => {
      const res = await app.request("/admin/rbac/roles/role-id", {
        method: "PATCH",
        body: JSON.stringify({ name: "invalid name!" }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe("DELETE /roles/:roleId", () => {
    it("should cascade delete role assignments", async () => {
      // Create role, assign to user, assign permissions
      // DELETE role
      // Verify user_roles and role_permissions cleaned up
    })

    it("should prevent deletion of system roles", async () => {
      // Create system role
      // Attempt delete
      // Expect 403
    })
  })

  describe("DELETE /permissions/:permissionId", () => {
    it("should cascade delete from roles", async () => {
      // Create permission, assign to role
      // DELETE permission
      // Verify removed from role
    })
  })
})
```

## Checklist

- [ ] Add `updateRole()` to D1 adapter
- [ ] Add `deleteRole()` to D1 adapter with cascade
- [ ] Add `deletePermission()` to D1 adapter with cascade
- [ ] Add `getUsersWithRole()` helper to D1 adapter
- [ ] Add new methods to RBACServiceImpl
- [ ] Update RBACService interface in contracts
- [ ] Add `GET /roles/:roleId` endpoint
- [ ] Add `PATCH /roles/:roleId` endpoint
- [ ] Add `DELETE /roles/:roleId` endpoint
- [ ] Add `DELETE /permissions/:permissionId` endpoint
- [ ] Add request/response types
- [ ] Write unit tests
- [ ] Write integration tests
