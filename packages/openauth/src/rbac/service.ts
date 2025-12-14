/**
 * RBAC Service Implementation
 *
 * Implements the RBACService interface with caching support.
 * Handles permission checking, role management, and token enrichment.
 *
 * @packageDocumentation
 */

import type { StorageAdapter } from "../storage/storage.js"
import { Storage } from "../storage/storage.js"
import type {
  Role,
  Permission,
  RolePermission,
  UserRole,
  RBACClaims,
  RBACConfig,
  RBACService,
} from "../contracts/types.js"
import { DEFAULT_RBAC_CONFIG, RBACError } from "../contracts/types.js"
import type { RBACAdapter } from "./d1-adapter.js"
import type { CachedPermissions } from "./types.js"

/**
 * RBAC Service Implementation
 *
 * Provides role-based access control with the following features:
 * - Permission checking with caching (60s TTL by default)
 * - Batch permission checking
 * - Token claim enrichment
 * - Admin operations for role/permission management
 *
 * TESTING CHECKLIST:
 * - checkPermission returns correct result
 * - Permissions are cached (60s TTL)
 * - Token enrichment adds roles/permissions
 * - Permission limit (50) enforced in token
 * - Cache invalidation works on role/permission changes
 */
export class RBACServiceImpl implements RBACService {
  private adapter: RBACAdapter
  private storage: StorageAdapter
  private config: RBACConfig

  /**
   * Create a new RBAC service
   *
   * @param adapter - The D1 database adapter
   * @param storage - The storage adapter for caching
   * @param config - Optional RBAC configuration
   */
  constructor(
    adapter: RBACAdapter,
    storage: StorageAdapter,
    config?: Partial<RBACConfig>,
  ) {
    this.adapter = adapter
    this.storage = storage
    this.config = {
      ...DEFAULT_RBAC_CONFIG,
      ...config,
    }
  }

  /**
   * Build cache key for permissions
   */
  private getCacheKey(
    tenantId: string,
    userId: string,
    clientId: string,
  ): string[] {
    return ["rbac", "permissions", tenantId, userId, clientId]
  }

  /**
   * Get cached permissions or fetch from database
   */
  private async getPermissionsWithCache(
    userId: string,
    clientId: string,
    tenantId: string,
  ): Promise<string[]> {
    const cacheKey = this.getCacheKey(tenantId, userId, clientId)

    // Try to get from cache
    const cached = await Storage.get<CachedPermissions>(this.storage, cacheKey)
    if (cached) {
      const age = (Date.now() - cached.cachedAt) / 1000
      if (age < this.config.permissionCacheTTL) {
        return cached.permissions
      }
    }

    // Fetch from database
    const permissions = await this.adapter.getUserPermissionsForClient(
      userId,
      clientId,
      tenantId,
    )
    const permissionNames = permissions.map((p) => p.name)

    // Cache the result
    const cacheValue: CachedPermissions = {
      permissions: permissionNames,
      cachedAt: Date.now(),
    }
    await Storage.set(
      this.storage,
      cacheKey,
      cacheValue,
      this.config.permissionCacheTTL,
    )

    return permissionNames
  }

  /**
   * Invalidate cache for a user's permissions in all apps
   * Called when roles or permissions change
   */
  private async invalidateUserCache(
    userId: string,
    tenantId: string,
  ): Promise<void> {
    // Scan for all cached permissions for this user
    const prefix = ["rbac", "permissions", tenantId, userId]
    for await (const [key] of Storage.scan<CachedPermissions>(
      this.storage,
      prefix,
    )) {
      await Storage.remove(this.storage, key)
    }
  }

  /**
   * Invalidate cache for all users with a specific role
   * Called when role permissions change
   */
  private async invalidateRoleCache(
    roleId: string,
    tenantId: string,
  ): Promise<void> {
    // Get all users with this role and invalidate their caches
    const userRoles = await this.adapter.listUserRoles(roleId, tenantId)
    for (const ur of userRoles) {
      await this.invalidateUserCache(ur.user_id, tenantId)
    }
  }

  // ==========================================
  // Permission Checking
  // ==========================================

  /**
   * Check if a user has a specific permission
   *
   * Uses cached permissions with 60s TTL for performance.
   *
   * @param params - Permission check parameters
   * @returns true if user has the permission
   */
  async checkPermission(params: {
    userId: string
    clientId: string
    tenantId: string
    permission: string
  }): Promise<boolean> {
    const permissions = await this.getPermissionsWithCache(
      params.userId,
      params.clientId,
      params.tenantId,
    )
    return permissions.includes(params.permission)
  }

  /**
   * Check multiple permissions at once
   *
   * Uses cached permissions for efficiency.
   *
   * @param params - Batch permission check parameters
   * @returns Record mapping permission names to boolean results
   */
  async checkPermissions(params: {
    userId: string
    clientId: string
    tenantId: string
    permissions: string[]
  }): Promise<Record<string, boolean>> {
    const userPermissions = await this.getPermissionsWithCache(
      params.userId,
      params.clientId,
      params.tenantId,
    )

    const permissionSet = new Set(userPermissions)
    const results: Record<string, boolean> = {}

    for (const permission of params.permissions) {
      results[permission] = permissionSet.has(permission)
    }

    return results
  }

  /**
   * Get all permissions for a user in an app
   *
   * Uses cached permissions with TTL.
   *
   * @param params - User and app identification
   * @returns Array of permission names
   */
  async getUserPermissions(params: {
    userId: string
    clientId: string
    tenantId: string
  }): Promise<string[]> {
    return this.getPermissionsWithCache(
      params.userId,
      params.clientId,
      params.tenantId,
    )
  }

  /**
   * Get all roles for a user
   *
   * Direct database query (no caching needed as less frequent).
   *
   * @param userId - The user ID
   * @param tenantId - The tenant ID
   * @returns Array of roles
   */
  async getUserRoles(userId: string, tenantId: string): Promise<Role[]> {
    return this.adapter.getUserRoles(userId, tenantId)
  }

  // ==========================================
  // Token Enrichment
  // ==========================================

  /**
   * Enrich token claims with RBAC data
   *
   * Builds roles and permissions arrays for JWT claims.
   * Enforces maxPermissionsInToken limit (default 50).
   *
   * @param params - User and app identification
   * @returns RBAC claims for token
   */
  async enrichTokenClaims(params: {
    userId: string
    clientId: string
    tenantId: string
  }): Promise<RBACClaims> {
    const [roles, permissions] = await Promise.all([
      this.adapter.getUserRoles(params.userId, params.tenantId),
      this.getPermissionsWithCache(
        params.userId,
        params.clientId,
        params.tenantId,
      ),
    ])

    const roleNames = roles.map((r) => r.name)

    // Enforce permission limit
    let limitedPermissions = permissions
    if (permissions.length > this.config.maxPermissionsInToken) {
      console.warn(
        `RBAC: User ${params.userId} has ${permissions.length} permissions, limiting to ${this.config.maxPermissionsInToken} in token`,
      )
      limitedPermissions = permissions.slice(
        0,
        this.config.maxPermissionsInToken,
      )
    }

    return {
      roles: roleNames,
      permissions: limitedPermissions,
    }
  }

  // ==========================================
  // Admin Operations - Roles
  // ==========================================

  /**
   * Create a new role
   *
   * @param params - Role creation parameters
   * @returns The created role
   */
  async createRole(params: {
    name: string
    tenantId: string
    description?: string
    isSystemRole?: boolean
  }): Promise<Role> {
    return this.adapter.createRole({
      name: params.name,
      tenant_id: params.tenantId,
      description: params.description,
      is_system_role: params.isSystemRole,
    })
  }

  /**
   * List all roles for a tenant
   *
   * @param tenantId - The tenant ID
   * @returns Array of roles
   */
  async listRoles(tenantId: string): Promise<Role[]> {
    return this.adapter.listRoles(tenantId)
  }

  // ==========================================
  // Admin Operations - Permissions
  // ==========================================

  /**
   * Create a new permission
   *
   * @param params - Permission creation parameters
   * @returns The created permission
   */
  async createPermission(params: {
    name: string
    clientId: string
    resource: string
    action: string
    description?: string
  }): Promise<Permission> {
    return this.adapter.createPermission({
      name: params.name,
      client_id: params.clientId,
      resource: params.resource,
      action: params.action,
      description: params.description,
    })
  }

  /**
   * List all permissions for an app
   *
   * @param clientId - The app ID
   * @returns Array of permissions
   */
  async listPermissions(clientId: string): Promise<Permission[]> {
    return this.adapter.listPermissions(clientId)
  }

  /**
   * List all permissions for a role
   *
   * @param roleId - The role ID
   * @returns Array of permissions
   */
  async listRolePermissions(roleId: string): Promise<Permission[]> {
    return this.adapter.listRolePermissions(roleId)
  }

  // ==========================================
  // Admin Operations - Assignments
  // ==========================================

  /**
   * Assign a role to a user
   *
   * Invalidates the user's permission cache.
   *
   * Security checks:
   * - Prevents self-assignment (assigning roles to yourself)
   * - Prevents privilege escalation (assigning system roles you don't have)
   *
   * @param params - Role assignment parameters
   * @returns The created user role assignment
   */
  async assignRoleToUser(params: {
    userId: string
    roleId: string
    tenantId: string
    assignedBy: string
    expiresAt?: number
  }): Promise<UserRole> {
    // Security check: Prevent self-assignment
    if (params.userId === params.assignedBy) {
      throw new RBACError(
        "self_assignment_denied",
        "Cannot assign roles to yourself",
      )
    }

    // Security check: Privilege escalation prevention for system roles
    const roleToAssign = await this.adapter.getRole(
      params.roleId,
      params.tenantId,
    )
    if (!roleToAssign) {
      throw new RBACError("role_not_found", "Role not found")
    }

    if (roleToAssign.is_system_role) {
      // For system roles, verify the assigner has the role they're trying to assign
      const assignerRoles = await this.adapter.getUserRoles(
        params.assignedBy,
        params.tenantId,
      )
      const assignerHasRole = assignerRoles.some((r) => r.id === params.roleId)

      if (!assignerHasRole) {
        throw new RBACError(
          "privilege_escalation_denied",
          "Cannot assign a system role you do not have",
        )
      }
    }

    const result = await this.adapter.assignRoleToUser({
      user_id: params.userId,
      role_id: params.roleId,
      tenant_id: params.tenantId,
      assigned_by: params.assignedBy,
      expires_at: params.expiresAt,
    })

    // Invalidate cache for this user
    await this.invalidateUserCache(params.userId, params.tenantId)

    return result
  }

  /**
   * Remove a role from a user
   *
   * Invalidates the user's permission cache.
   *
   * @param params - Role removal parameters
   */
  async removeRoleFromUser(params: {
    userId: string
    roleId: string
    tenantId: string
  }): Promise<void> {
    await this.adapter.removeRoleFromUser(
      params.userId,
      params.roleId,
      params.tenantId,
    )

    // Invalidate cache for this user
    await this.invalidateUserCache(params.userId, params.tenantId)
  }

  /**
   * Assign a permission to a role
   *
   * Invalidates cache for all users with this role.
   *
   * @param params - Permission assignment parameters
   * @returns The created role permission assignment
   */
  async assignPermissionToRole(params: {
    roleId: string
    permissionId: string
    grantedBy: string
  }): Promise<RolePermission> {
    const result = await this.adapter.assignPermissionToRole({
      role_id: params.roleId,
      permission_id: params.permissionId,
      granted_by: params.grantedBy,
    })

    // Get the role to find tenant ID for cache invalidation
    // Note: We need to get all user roles to invalidate their caches
    // This is a more expensive operation but necessary for consistency
    // In practice, role permission changes are infrequent
    try {
      const roleUsers = await this.adapter.listUserRoles(params.roleId, "")
      for (const ur of roleUsers) {
        await this.invalidateUserCache(ur.user_id, ur.tenant_id)
      }
    } catch {
      // If we can't invalidate, the cache will expire naturally
      console.warn(
        `RBAC: Could not invalidate cache for role ${params.roleId} permission assignment`,
      )
    }

    return result
  }

  /**
   * Remove a permission from a role
   *
   * Invalidates cache for all users with this role.
   *
   * @param params - Permission removal parameters
   */
  async removePermissionFromRole(params: {
    roleId: string
    permissionId: string
  }): Promise<void> {
    await this.adapter.removePermissionFromRole(
      params.roleId,
      params.permissionId,
    )

    // Invalidate cache for users with this role
    try {
      const roleUsers = await this.adapter.listUserRoles(params.roleId, "")
      for (const ur of roleUsers) {
        await this.invalidateUserCache(ur.user_id, ur.tenant_id)
      }
    } catch {
      console.warn(
        `RBAC: Could not invalidate cache for role ${params.roleId} permission removal`,
      )
    }
  }

  /**
   * List all role assignments for a user
   *
   * @param userId - The user ID
   * @param tenantId - The tenant ID
   * @returns Array of user role assignments
   */
  async listUserRoles(userId: string, tenantId: string): Promise<UserRole[]> {
    return this.adapter.listUserRoles(userId, tenantId)
  }

  // ==========================================
  // Get Operations
  // ==========================================

  /**
   * Get a role by ID
   *
   * @param roleId - The role ID
   * @param tenantId - The tenant ID
   * @returns The role or null if not found
   */
  async getRole(roleId: string, tenantId: string): Promise<Role | null> {
    return this.adapter.getRole(roleId, tenantId)
  }

  /**
   * Get a permission by ID
   *
   * @param permissionId - The permission ID
   * @returns The permission or null if not found
   */
  async getPermission(permissionId: string): Promise<Permission | null> {
    return this.adapter.getPermission(permissionId)
  }

  // ==========================================
  // Update Operations
  // ==========================================

  /**
   * Update a role
   *
   * @param params - Role update parameters
   * @returns The updated role
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

  // ==========================================
  // Delete Operations
  // ==========================================

  /**
   * Delete a role with cascading cleanup
   *
   * Invalidates cache for affected users before deletion.
   *
   * @param roleId - The role ID
   * @param tenantId - The tenant ID
   */
  async deleteRole(roleId: string, tenantId: string): Promise<void> {
    // Invalidate cache for affected users before deletion
    const usersWithRole = await this.adapter.getUsersWithRole(roleId, tenantId)
    for (const userId of usersWithRole) {
      await this.invalidateUserCache(userId, tenantId)
    }

    await this.adapter.deleteRole(roleId, tenantId)
  }

  /**
   * Delete a permission with cascading cleanup
   *
   * @param permissionId - The permission ID
   */
  async deletePermission(permissionId: string): Promise<void> {
    await this.adapter.deletePermission(permissionId)
  }
}
