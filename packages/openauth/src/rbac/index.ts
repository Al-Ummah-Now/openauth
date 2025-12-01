/**
 * Role-Based Access Control (RBAC) for OpenAuth enterprise SSO.
 *
 * This module provides fine-grained authorization by organizing permissions into
 * roles that are assigned to users. Permissions are scoped to applications, and
 * roles are scoped to tenants, enabling flexible multi-tenant access control.
 *
 * ## Features
 *
 * - **Permission Checking**: Fast permission verification with 60s cache TTL
 * - **Batch Permission Checking**: Check multiple permissions in a single call
 * - **Token Claim Enrichment**: Automatically add roles and permissions to JWTs
 * - **Admin APIs**: Complete CRUD for apps, roles, permissions, and assignments
 * - **Tenant Isolation**: All operations are scoped to the tenant context
 *
 * ## Quick Start
 *
 * ```ts title="rbac-setup.ts"
 * import {
 *   RBACServiceImpl,
 *   RBACAdapter,
 *   rbacEndpoints,
 *   rbacAdminEndpoints,
 *   enrichTokenWithRBAC,
 * } from "@openauthjs/openauth/rbac"
 *
 * // Initialize RBAC with D1 database
 * const adapter = new RBACAdapter(d1Database)
 * const service = new RBACServiceImpl(adapter, storage, {
 *   maxPermissionsInToken: 50,
 *   permissionCacheTTL: 60,
 * })
 *
 * // Mount endpoints
 * const app = new Hono()
 * app.route("/rbac", rbacEndpoints(service))
 * app.route("/rbac/admin", rbacAdminEndpoints(service))
 *
 * // Check permissions in your application
 * const hasAccess = await service.checkPermission({
 *   userId: "user-123",
 *   appId: "my-app",
 *   tenantId: "tenant-1",
 *   permission: "posts:read",
 * })
 *
 * // Enrich tokens with RBAC claims
 * const claims = await enrichTokenWithRBAC(service, {
 *   userId: "user-123",
 *   appId: "my-app",
 *   tenantId: "tenant-1",
 * })
 * // { roles: ["editor"], permissions: ["posts:read", "posts:write"] }
 * ```
 *
 * ## Data Model
 *
 * ```
 * Tenant
 *   |
 *   +-- App (defines permissions)
 *   |     |
 *   |     +-- Permission (resource:action)
 *   |
 *   +-- Role (collection of permissions)
 *         |
 *         +-- RolePermission (role -> permission mapping)
 *         |
 *         +-- UserRole (user -> role assignment)
 * ```
 *
 * ## API Endpoints
 *
 * Permission checking endpoints:
 *
 * | Endpoint | Method | Description |
 * |----------|--------|-------------|
 * | `/rbac/check` | POST | Check single permission |
 * | `/rbac/check/batch` | POST | Check multiple permissions |
 * | `/rbac/permissions` | GET | Get user permissions for app |
 * | `/rbac/roles` | GET | Get user roles |
 *
 * Admin management endpoints:
 *
 * | Endpoint | Method | Description |
 * |----------|--------|-------------|
 * | `/rbac/admin/apps` | POST/GET | Manage apps |
 * | `/rbac/admin/roles` | POST/GET | Manage roles |
 * | `/rbac/admin/permissions` | POST/GET | Manage permissions |
 * | `/rbac/admin/users/:userId/roles` | POST/GET/DELETE | Manage user roles |
 * | `/rbac/admin/roles/:roleId/permissions` | POST/GET/DELETE | Manage role permissions |
 *
 * ## Token Claims
 *
 * When enriched, tokens include:
 * ```json
 * {
 *   "sub": "user-123",
 *   "aud": "my-app",
 *   "roles": ["editor", "viewer"],
 *   "permissions": ["posts:read", "posts:write", "users:read"]
 * }
 * ```
 *
 * @see {@link RBACServiceImpl} - Main RBAC service implementation
 * @see {@link RBACAdapter} - D1 database adapter
 * @see {@link enrichTokenWithRBAC} - Token enrichment helper
 * @see {@link rbacEndpoints} - Permission checking API routes
 * @see {@link rbacAdminEndpoints} - Admin management API routes
 *
 * @packageDocumentation
 */

// Re-export types
export type {
  Role,
  Permission,
  App,
  RolePermission,
  UserRole,
  RBACClaims,
  RBACConfig,
  RBACService,
  RBACError,
  RBACErrorCode,
} from "../contracts/types.js"

export { DEFAULT_RBAC_CONFIG } from "../contracts/types.js"

// Internal types
export type {
  CreateAppParams,
  CreateRoleParams,
  CreatePermissionParams,
  AssignRoleParams,
  AssignPermissionParams,
  RBACCacheKey,
  CachedPermissions,
} from "./types.js"

// D1 Adapter
export { RBACAdapter } from "./d1-adapter.js"

// Service implementation
export { RBACServiceImpl } from "./service.js"

// Token enricher utilities
export {
  enrichTokenWithRBAC,
  createTokenEnricher,
  validateRBACClaims,
  extractRBACClaims,
  hasPermissionInToken,
  hasRoleInToken,
  hasAllPermissionsInToken,
  hasAnyPermissionInToken,
  type TokenEnrichmentParams,
  type TokenEnrichmentOptions,
} from "./token-enricher.js"

// API Endpoints
export {
  rbacEndpoints,
  createRBACContextMiddleware,
  type RBACContext,
} from "./endpoints.js"

export {
  rbacAdminEndpoints,
  createAdminMiddleware,
  type AdminContext,
} from "./admin-endpoints.js"
