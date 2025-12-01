/**
 * RBAC (Role-Based Access Control) Module
 *
 * Provides role-based access control for OpenAuth enterprise SSO.
 *
 * Features:
 * - Permission checking with caching (60s TTL)
 * - Batch permission checking
 * - Token claim enrichment (roles + permissions)
 * - Admin APIs for managing apps, roles, permissions
 * - Tenant isolation for all operations
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * import {
 *   RBACServiceImpl,
 *   RBACAdapter,
 *   rbacEndpoints,
 *   rbacAdminEndpoints,
 *   enrichTokenWithRBAC,
 * } from './rbac';
 *
 * // Initialize
 * const adapter = new RBACAdapter(d1Database);
 * const service = new RBACServiceImpl(adapter, storageAdapter);
 *
 * // Mount endpoints
 * const app = new Hono();
 * app.route('/rbac', rbacEndpoints(service));
 * app.route('/admin/rbac', rbacAdminEndpoints(service));
 *
 * // Check permissions
 * const hasAccess = await service.checkPermission({
 *   userId: 'user-123',
 *   appId: 'my-app',
 *   tenantId: 'tenant-1',
 *   permission: 'posts:read'
 * });
 *
 * // Enrich tokens
 * const claims = await enrichTokenWithRBAC(service, {
 *   userId: 'user-123',
 *   appId: 'my-app',
 *   tenantId: 'tenant-1'
 * });
 * ```
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
