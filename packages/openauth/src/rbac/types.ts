/**
 * RBAC Types - Re-exports contracts and internal types
 *
 * @packageDocumentation
 */

// Re-export all RBAC-related types from contracts
export {
  Role,
  Permission,
  App,
  RolePermission,
  UserRole,
  RBACClaims,
  RBACConfig,
  DEFAULT_RBAC_CONFIG,
  RBACService,
  RBACError,
  RBACErrorCode,
} from "../contracts/types.js"

/**
 * Internal types for RBAC adapter operations
 */

/**
 * Parameters for creating an app
 */
export interface CreateAppParams {
  id: string
  name: string
  tenant_id: string
  description?: string
}

/**
 * Parameters for creating a role
 */
export interface CreateRoleParams {
  name: string
  tenant_id: string
  description?: string
  is_system_role?: boolean
}

/**
 * Parameters for creating a permission
 */
export interface CreatePermissionParams {
  name: string
  app_id: string
  resource: string
  action: string
  description?: string
}

/**
 * Parameters for assigning a role to a user
 */
export interface AssignRoleParams {
  user_id: string
  role_id: string
  tenant_id: string
  assigned_by: string
  expires_at?: number
}

/**
 * Parameters for assigning a permission to a role
 */
export interface AssignPermissionParams {
  role_id: string
  permission_id: string
  granted_by: string
}

/**
 * Cache key types for RBAC caching
 */
export type RBACCacheKey = ["rbac", "permissions", string, string, string]

/**
 * Cached permissions structure
 */
export interface CachedPermissions {
  permissions: string[]
  cachedAt: number
}

// ==========================================
// API Request/Response Types
// ==========================================

/**
 * Request body for updating a role
 */
export interface UpdateRoleRequest {
  name?: string
  description?: string
}

/**
 * Response for getting a single role with permissions
 */
export interface GetRoleResponse {
  role: import("../contracts/types.js").Role
  permissions: import("../contracts/types.js").Permission[]
}

/**
 * Standard error response
 */
export interface ErrorResponse {
  error: string
  message: string
}
