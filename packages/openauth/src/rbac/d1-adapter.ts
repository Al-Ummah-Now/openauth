/**
 * D1 Database Adapter for RBAC
 *
 * Provides database operations for Role-Based Access Control using Cloudflare D1.
 * All queries use parameterized statements to prevent SQL injection.
 * All queries enforce tenant isolation via tenant_id filtering.
 *
 * @packageDocumentation
 */

import type { D1Database } from "@cloudflare/workers-types"
import type {
  Role,
  Permission,
  RolePermission,
  UserRole,
} from "../contracts/types.js"
import type {
  CreateRoleParams,
  CreatePermissionParams,
  AssignRoleParams,
  AssignPermissionParams,
} from "./types.js"
import { RBACError } from "../contracts/types.js"

/**
 * RBACAdapter - D1 database operations for RBAC
 *
 * SECURITY NOTES:
 * - All queries use parameterized statements (D1 bind) to prevent SQL injection
 * - All queries filter by tenant_id for tenant isolation
 * - Role expiration is checked in getUserRoles query
 *
 * TESTING CHECKLIST:
 * - Can create role, permission
 * - Can assign role to user
 * - Can assign permission to role
 * - Tenant isolation enforced in all queries
 * - Role expiration is respected
 */
export class RBACAdapter {
  private db: D1Database

  constructor(database: D1Database) {
    this.db = database
  }

  /**
   * Get all roles assigned to a user
   *
   * Filters out expired role assignments automatically.
   *
   * @param userId - The user ID
   * @param tenantId - The tenant ID for isolation
   * @returns Array of roles assigned to the user
   */
  async getUserRoles(userId: string, tenantId: string): Promise<Role[]> {
    const now = Date.now()
    const result = await this.db
      .prepare(
        `
        SELECT r.id, r.name, r.tenant_id, r.description, r.is_system_role, r.created_at, r.updated_at
        FROM rbac_roles r
        JOIN rbac_user_roles ur ON r.id = ur.role_id
        WHERE ur.user_id = ? AND ur.tenant_id = ?
        AND (ur.expires_at IS NULL OR ur.expires_at > ?)
        `,
      )
      .bind(userId, tenantId, now)
      .all<{
        id: string
        name: string
        tenant_id: string
        description: string | null
        is_system_role: number
        created_at: number
        updated_at: number
      }>()

    if (!result.results) return []

    return result.results.map((row) => ({
      id: row.id,
      name: row.name,
      tenant_id: row.tenant_id,
      description: row.description ?? undefined,
      is_system_role: row.is_system_role === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
  }

  /**
   * Get permissions for a set of roles
   *
   * @param roleIds - Array of role IDs
   * @returns Array of permissions assigned to those roles
   */
  async getRolePermissions(roleIds: string[]): Promise<Permission[]> {
    if (roleIds.length === 0) return []

    // Build parameterized placeholders for IN clause
    const placeholders = roleIds.map(() => "?").join(", ")
    const result = await this.db
      .prepare(
        `
        SELECT DISTINCT p.id, p.name, p.client_id, p.description, p.resource, p.action, p.created_at
        FROM rbac_permissions p
        JOIN rbac_role_permissions rp ON p.id = rp.permission_id
        WHERE rp.role_id IN (${placeholders})
        `,
      )
      .bind(...roleIds)
      .all<{
        id: string
        name: string
        client_id: string
        description: string | null
        resource: string
        action: string
        created_at: number
      }>()

    if (!result.results) return []

    return result.results.map((row) => ({
      id: row.id,
      name: row.name,
      client_id: row.client_id,
      description: row.description ?? undefined,
      resource: row.resource,
      action: row.action,
      created_at: row.created_at,
    }))
  }

  /**
   * Get all permissions for a user within a specific app
   *
   * Combined query that joins user roles with role permissions,
   * filtering by tenant and app.
   *
   * @param userId - The user ID
   * @param clientId - The app ID to filter permissions
   * @param tenantId - The tenant ID for isolation
   * @returns Array of permissions for the user in the specified app
   */
  async getUserPermissionsForClient(
    userId: string,
    clientId: string,
    tenantId: string,
  ): Promise<Permission[]> {
    const now = Date.now()
    const result = await this.db
      .prepare(
        `
        SELECT DISTINCT p.id, p.name, p.client_id, p.description, p.resource, p.action, p.created_at
        FROM rbac_permissions p
        JOIN rbac_role_permissions rp ON p.id = rp.permission_id
        JOIN rbac_user_roles ur ON rp.role_id = ur.role_id
        WHERE ur.user_id = ? AND ur.tenant_id = ? AND p.client_id = ?
        AND (ur.expires_at IS NULL OR ur.expires_at > ?)
        `,
      )
      .bind(userId, tenantId, clientId, now)
      .all<{
        id: string
        name: string
        client_id: string
        description: string | null
        resource: string
        action: string
        created_at: number
      }>()

    if (!result.results) return []

    return result.results.map((row) => ({
      id: row.id,
      name: row.name,
      client_id: row.client_id,
      description: row.description ?? undefined,
      resource: row.resource,
      action: row.action,
      created_at: row.created_at,
    }))
  }

  /**
   * Create a new role
   *
   * @param params - Role creation parameters
   * @returns The created role
   */
  async createRole(params: CreateRoleParams): Promise<Role> {
    const now = Date.now()
    const id = crypto.randomUUID()

    await this.db
      .prepare(
        `
        INSERT INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        id,
        params.name,
        params.tenant_id,
        params.description ?? null,
        params.is_system_role ? 1 : 0,
        now,
        now,
      )
      .run()

    return {
      id,
      name: params.name,
      tenant_id: params.tenant_id,
      description: params.description,
      is_system_role: params.is_system_role ?? false,
      created_at: now,
      updated_at: now,
    }
  }

  /**
   * Create a new permission
   *
   * @param params - Permission creation parameters
   * @returns The created permission
   */
  async createPermission(params: CreatePermissionParams): Promise<Permission> {
    const now = Date.now()
    const id = crypto.randomUUID()

    await this.db
      .prepare(
        `
        INSERT INTO rbac_permissions (id, name, client_id, description, resource, action, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        id,
        params.name,
        params.client_id,
        params.description ?? null,
        params.resource,
        params.action,
        now,
      )
      .run()

    return {
      id,
      name: params.name,
      client_id: params.client_id,
      description: params.description,
      resource: params.resource,
      action: params.action,
      created_at: now,
    }
  }

  /**
   * Assign a role to a user
   *
   * @param params - Role assignment parameters
   * @returns The created user role assignment
   */
  async assignRoleToUser(params: AssignRoleParams): Promise<UserRole> {
    const now = Date.now()

    // Check if assignment already exists
    const existing = await this.db
      .prepare(
        `
        SELECT user_id FROM rbac_user_roles
        WHERE user_id = ? AND role_id = ? AND tenant_id = ?
        `,
      )
      .bind(params.user_id, params.role_id, params.tenant_id)
      .first()

    if (existing) {
      throw new RBACError(
        "role_already_assigned",
        "Role is already assigned to user",
      )
    }

    await this.db
      .prepare(
        `
        INSERT INTO rbac_user_roles (user_id, role_id, tenant_id, assigned_at, expires_at, assigned_by)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        params.user_id,
        params.role_id,
        params.tenant_id,
        now,
        params.expires_at ?? null,
        params.assigned_by,
      )
      .run()

    return {
      user_id: params.user_id,
      role_id: params.role_id,
      tenant_id: params.tenant_id,
      assigned_at: now,
      expires_at: params.expires_at,
      assigned_by: params.assigned_by,
    }
  }

  /**
   * Remove a role from a user
   *
   * @param userId - The user ID
   * @param roleId - The role ID to remove
   * @param tenantId - The tenant ID for isolation
   */
  async removeRoleFromUser(
    userId: string,
    roleId: string,
    tenantId: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `
        DELETE FROM rbac_user_roles
        WHERE user_id = ? AND role_id = ? AND tenant_id = ?
        `,
      )
      .bind(userId, roleId, tenantId)
      .run()
  }

  /**
   * Assign a permission to a role
   *
   * @param params - Permission assignment parameters
   * @returns The created role permission assignment
   */
  async assignPermissionToRole(
    params: AssignPermissionParams,
  ): Promise<RolePermission> {
    const now = Date.now()

    // Check if assignment already exists
    const existing = await this.db
      .prepare(
        `
        SELECT role_id FROM rbac_role_permissions
        WHERE role_id = ? AND permission_id = ?
        `,
      )
      .bind(params.role_id, params.permission_id)
      .first()

    if (existing) {
      throw new RBACError(
        "role_already_assigned",
        "Permission is already assigned to role",
      )
    }

    await this.db
      .prepare(
        `
        INSERT INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
        VALUES (?, ?, ?, ?)
        `,
      )
      .bind(params.role_id, params.permission_id, now, params.granted_by)
      .run()

    return {
      role_id: params.role_id,
      permission_id: params.permission_id,
      granted_at: now,
      granted_by: params.granted_by,
    }
  }

  /**
   * Remove a permission from a role
   *
   * @param roleId - The role ID
   * @param permissionId - The permission ID to remove
   */
  async removePermissionFromRole(
    roleId: string,
    permissionId: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `
        DELETE FROM rbac_role_permissions
        WHERE role_id = ? AND permission_id = ?
        `,
      )
      .bind(roleId, permissionId)
      .run()
  }

  /**
   * List all roles for a tenant
   *
   * @param tenantId - The tenant ID
   * @returns Array of roles
   */
  async listRoles(tenantId: string): Promise<Role[]> {
    const result = await this.db
      .prepare(
        `
        SELECT id, name, tenant_id, description, is_system_role, created_at, updated_at
        FROM rbac_roles
        WHERE tenant_id = ?
        ORDER BY created_at DESC
        `,
      )
      .bind(tenantId)
      .all<{
        id: string
        name: string
        tenant_id: string
        description: string | null
        is_system_role: number
        created_at: number
        updated_at: number
      }>()

    if (!result.results) return []

    return result.results.map((row) => ({
      id: row.id,
      name: row.name,
      tenant_id: row.tenant_id,
      description: row.description ?? undefined,
      is_system_role: row.is_system_role === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
  }

  /**
   * List all permissions for an app
   *
   * @param clientId - The app ID
   * @returns Array of permissions
   */
  async listPermissions(clientId: string): Promise<Permission[]> {
    const result = await this.db
      .prepare(
        `
        SELECT id, name, client_id, description, resource, action, created_at
        FROM rbac_permissions
        WHERE client_id = ?
        ORDER BY created_at DESC
        `,
      )
      .bind(clientId)
      .all<{
        id: string
        name: string
        client_id: string
        description: string | null
        resource: string
        action: string
        created_at: number
      }>()

    if (!result.results) return []

    return result.results.map((row) => ({
      id: row.id,
      name: row.name,
      client_id: row.client_id,
      description: row.description ?? undefined,
      resource: row.resource,
      action: row.action,
      created_at: row.created_at,
    }))
  }

  /**
   * List all permissions for a role
   *
   * @param roleId - The role ID
   * @returns Array of permissions
   */
  async listRolePermissions(roleId: string): Promise<Permission[]> {
    const result = await this.db
      .prepare(
        `
        SELECT p.id, p.name, p.client_id, p.description, p.resource, p.action, p.created_at
        FROM rbac_permissions p
        JOIN rbac_role_permissions rp ON p.id = rp.permission_id
        WHERE rp.role_id = ?
        ORDER BY p.created_at DESC
        `,
      )
      .bind(roleId)
      .all<{
        id: string
        name: string
        client_id: string
        description: string | null
        resource: string
        action: string
        created_at: number
      }>()

    if (!result.results) return []

    return result.results.map((row) => ({
      id: row.id,
      name: row.name,
      client_id: row.client_id,
      description: row.description ?? undefined,
      resource: row.resource,
      action: row.action,
      created_at: row.created_at,
    }))
  }

  /**
   * List all role assignments for a user
   *
   * @param userId - The user ID
   * @param tenantId - The tenant ID for isolation
   * @returns Array of user role assignments
   */
  async listUserRoles(userId: string, tenantId: string): Promise<UserRole[]> {
    const result = await this.db
      .prepare(
        `
        SELECT user_id, role_id, tenant_id, assigned_at, expires_at, assigned_by
        FROM rbac_user_roles
        WHERE user_id = ? AND tenant_id = ?
        ORDER BY assigned_at DESC
        `,
      )
      .bind(userId, tenantId)
      .all<{
        user_id: string
        role_id: string
        tenant_id: string
        assigned_at: number
        expires_at: number | null
        assigned_by: string
      }>()

    if (!result.results) return []

    return result.results.map((row) => ({
      user_id: row.user_id,
      role_id: row.role_id,
      tenant_id: row.tenant_id,
      assigned_at: row.assigned_at,
      expires_at: row.expires_at ?? undefined,
      assigned_by: row.assigned_by,
    }))
  }

  /**
   * Get a role by ID
   *
   * @param roleId - The role ID
   * @param tenantId - The tenant ID for isolation
   * @returns The role or null if not found
   */
  async getRole(roleId: string, tenantId: string): Promise<Role | null> {
    const result = await this.db
      .prepare(
        `
        SELECT id, name, tenant_id, description, is_system_role, created_at, updated_at
        FROM rbac_roles
        WHERE id = ? AND tenant_id = ?
        `,
      )
      .bind(roleId, tenantId)
      .first<{
        id: string
        name: string
        tenant_id: string
        description: string | null
        is_system_role: number
        created_at: number
        updated_at: number
      }>()

    if (!result) return null

    return {
      id: result.id,
      name: result.name,
      tenant_id: result.tenant_id,
      description: result.description ?? undefined,
      is_system_role: result.is_system_role === 1,
      created_at: result.created_at,
      updated_at: result.updated_at,
    }
  }

  /**
   * Get a permission by ID
   *
   * @param permissionId - The permission ID
   * @returns The permission or null if not found
   */
  async getPermission(permissionId: string): Promise<Permission | null> {
    const result = await this.db
      .prepare(
        `
        SELECT id, name, client_id, description, resource, action, created_at
        FROM rbac_permissions
        WHERE id = ?
        `,
      )
      .bind(permissionId)
      .first<{
        id: string
        name: string
        client_id: string
        description: string | null
        resource: string
        action: string
        created_at: number
      }>()

    if (!result) return null

    return {
      id: result.id,
      name: result.name,
      client_id: result.client_id,
      description: result.description ?? undefined,
      resource: result.resource,
      action: result.action,
      created_at: result.created_at,
    }
  }

  /**
   * Update a role
   *
   * @param roleId - The role ID
   * @param tenantId - The tenant ID for isolation
   * @param updates - The fields to update
   * @returns The updated role
   * @throws RBACError if role not found or invalid input
   */
  async updateRole(
    roleId: string,
    tenantId: string,
    updates: { name?: string; description?: string },
  ): Promise<Role> {
    const now = Date.now()
    const setClauses: string[] = ["updated_at = ?"]
    const values: (string | number | null)[] = [now]

    if (updates.name !== undefined) {
      if (!/^[a-zA-Z0-9_-]+$/.test(updates.name)) {
        throw new RBACError(
          "invalid_input",
          "Role name must contain only alphanumeric characters, hyphens, and underscores",
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
        `UPDATE rbac_roles SET ${setClauses.join(", ")} WHERE id = ? AND tenant_id = ?`,
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
   *
   * @param roleId - The role ID
   * @param tenantId - The tenant ID for isolation
   * @throws RBACError if role not found or is a system role
   */
  async deleteRole(roleId: string, tenantId: string): Promise<void> {
    const role = await this.getRole(roleId, tenantId)
    if (!role) {
      throw new RBACError("role_not_found", "Role not found")
    }

    if (role.is_system_role) {
      throw new RBACError(
        "cannot_delete_system_role",
        "Cannot delete system role",
      )
    }

    // Delete in order: user_roles -> role_permissions -> role
    await this.db
      .prepare(
        "DELETE FROM rbac_user_roles WHERE role_id = ? AND tenant_id = ?",
      )
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
   *
   * @param permissionId - The permission ID
   * @param clientId - Optional app ID to verify ownership
   * @throws RBACError if permission not found
   */
  async deletePermission(
    permissionId: string,
    clientId?: string,
  ): Promise<void> {
    const permission = await this.getPermission(permissionId)
    if (!permission) {
      throw new RBACError("permission_not_found", "Permission not found")
    }

    if (clientId && permission.client_id !== clientId) {
      throw new RBACError(
        "permission_not_found",
        "Permission not found in specified client",
      )
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

  /**
   * Get all user IDs that have a specific role assigned
   *
   * @param roleId - The role ID
   * @param tenantId - The tenant ID for isolation
   * @returns Array of user IDs
   */
  async getUsersWithRole(roleId: string, tenantId: string): Promise<string[]> {
    const result = await this.db
      .prepare(
        `
        SELECT DISTINCT user_id
        FROM rbac_user_roles
        WHERE role_id = ? AND tenant_id = ?
        `,
      )
      .bind(roleId, tenantId)
      .all<{ user_id: string }>()

    if (!result.results) return []

    return result.results.map((row) => row.user_id)
  }
}
