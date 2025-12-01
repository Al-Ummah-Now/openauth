/**
 * Token Enricher for RBAC
 *
 * Provides convenience functions for enriching JWT tokens with RBAC claims.
 *
 * @packageDocumentation
 */

import type { RBACService, RBACClaims, RBACConfig } from "../contracts/types.js"
import { DEFAULT_RBAC_CONFIG } from "../contracts/types.js"

/**
 * Parameters for token enrichment
 */
export interface TokenEnrichmentParams {
  userId: string
  appId: string
  tenantId: string
}

/**
 * Options for token enrichment
 */
export interface TokenEnrichmentOptions {
  /**
   * Maximum number of permissions to include in the token
   * Default: 50 (from DEFAULT_RBAC_CONFIG)
   */
  maxPermissionsInToken?: number
}

/**
 * Enrich a token with RBAC claims
 *
 * Convenience function that calls service.enrichTokenClaims and enforces
 * the maxPermissionsInToken limit with logging.
 *
 * @param service - The RBAC service instance
 * @param params - User, app, and tenant identification
 * @param options - Optional configuration
 * @returns RBAC claims to include in the token
 *
 * @example
 * ```typescript
 * const claims = await enrichTokenWithRBAC(rbacService, {
 *   userId: 'user-123',
 *   appId: 'my-app',
 *   tenantId: 'tenant-1'
 * });
 *
 * // Include in JWT
 * const token = jwt.sign({
 *   sub: userId,
 *   ...claims
 * }, secret);
 * ```
 */
export async function enrichTokenWithRBAC(
  service: RBACService,
  params: TokenEnrichmentParams,
  options?: TokenEnrichmentOptions,
): Promise<RBACClaims> {
  const maxPermissions =
    options?.maxPermissionsInToken ?? DEFAULT_RBAC_CONFIG.maxPermissionsInToken

  // Get claims from service
  const claims = await service.enrichTokenClaims({
    userId: params.userId,
    appId: params.appId,
    tenantId: params.tenantId,
  })

  // Enforce permission limit (service may have different limit configured)
  if (claims.permissions.length > maxPermissions) {
    console.warn(
      `TokenEnricher: User ${params.userId} has ${claims.permissions.length} permissions, ` +
        `truncating to ${maxPermissions} for token. Consider using permission checking APIs ` +
        `for applications with many permissions.`,
    )
    return {
      roles: claims.roles,
      permissions: claims.permissions.slice(0, maxPermissions),
    }
  }

  return claims
}

/**
 * Create a token enricher function bound to a service
 *
 * Useful when you want to pass around a pre-configured enricher.
 *
 * @param service - The RBAC service instance
 * @param options - Optional configuration
 * @returns A function that enriches tokens
 *
 * @example
 * ```typescript
 * const enrichToken = createTokenEnricher(rbacService, {
 *   maxPermissionsInToken: 25
 * });
 *
 * // Later...
 * const claims = await enrichToken({
 *   userId: 'user-123',
 *   appId: 'my-app',
 *   tenantId: 'tenant-1'
 * });
 * ```
 */
export function createTokenEnricher(
  service: RBACService,
  options?: TokenEnrichmentOptions,
): (params: TokenEnrichmentParams) => Promise<RBACClaims> {
  return (params: TokenEnrichmentParams) =>
    enrichTokenWithRBAC(service, params, options)
}

/**
 * Validate that RBAC claims are within acceptable limits
 *
 * Useful for validating incoming tokens.
 *
 * @param claims - The RBAC claims to validate
 * @param config - Optional RBAC configuration for limits
 * @returns true if claims are valid
 */
export function validateRBACClaims(
  claims: unknown,
  config?: Partial<RBACConfig>,
): claims is RBACClaims {
  if (!claims || typeof claims !== "object") {
    return false
  }

  const c = claims as Record<string, unknown>

  // Check roles
  if (!Array.isArray(c.roles)) {
    return false
  }
  if (!c.roles.every((r: unknown) => typeof r === "string")) {
    return false
  }

  // Check permissions
  if (!Array.isArray(c.permissions)) {
    return false
  }
  if (!c.permissions.every((p: unknown) => typeof p === "string")) {
    return false
  }

  // Check limits
  const maxPermissions =
    config?.maxPermissionsInToken ?? DEFAULT_RBAC_CONFIG.maxPermissionsInToken
  if (c.permissions.length > maxPermissions) {
    console.warn(
      `RBAC Claims Validation: Too many permissions (${c.permissions.length} > ${maxPermissions})`,
    )
    return false
  }

  return true
}

/**
 * Extract RBAC claims from a decoded JWT payload
 *
 * Safely extracts and validates RBAC claims from a token payload.
 *
 * @param payload - The decoded JWT payload
 * @returns The RBAC claims or null if not present/invalid
 *
 * @example
 * ```typescript
 * const decoded = jwt.verify(token, secret);
 * const rbacClaims = extractRBACClaims(decoded);
 *
 * if (rbacClaims) {
 *   if (rbacClaims.permissions.includes('posts:read')) {
 *     // Allow access
 *   }
 * }
 * ```
 */
export function extractRBACClaims(
  payload: Record<string, unknown>,
): RBACClaims | null {
  const roles = payload.roles
  const permissions = payload.permissions

  const claims = { roles, permissions }

  if (validateRBACClaims(claims)) {
    return claims
  }

  return null
}

/**
 * Check if a token payload has a specific permission
 *
 * Convenience function for quick permission checks on token payloads.
 *
 * @param payload - The decoded JWT payload
 * @param permission - The permission to check
 * @returns true if the permission is present
 *
 * @example
 * ```typescript
 * const decoded = jwt.verify(token, secret);
 *
 * if (hasPermissionInToken(decoded, 'posts:delete')) {
 *   // Allow delete
 * }
 * ```
 */
export function hasPermissionInToken(
  payload: Record<string, unknown>,
  permission: string,
): boolean {
  const claims = extractRBACClaims(payload)
  if (!claims) {
    return false
  }
  return claims.permissions.includes(permission)
}

/**
 * Check if a token payload has a specific role
 *
 * Convenience function for quick role checks on token payloads.
 *
 * @param payload - The decoded JWT payload
 * @param role - The role to check
 * @returns true if the role is present
 *
 * @example
 * ```typescript
 * const decoded = jwt.verify(token, secret);
 *
 * if (hasRoleInToken(decoded, 'admin')) {
 *   // Allow admin action
 * }
 * ```
 */
export function hasRoleInToken(
  payload: Record<string, unknown>,
  role: string,
): boolean {
  const claims = extractRBACClaims(payload)
  if (!claims) {
    return false
  }
  return claims.roles.includes(role)
}

/**
 * Check if a token payload has all specified permissions
 *
 * @param payload - The decoded JWT payload
 * @param permissions - The permissions to check (all must be present)
 * @returns true if all permissions are present
 */
export function hasAllPermissionsInToken(
  payload: Record<string, unknown>,
  permissions: string[],
): boolean {
  const claims = extractRBACClaims(payload)
  if (!claims) {
    return false
  }
  return permissions.every((p) => claims.permissions.includes(p))
}

/**
 * Check if a token payload has any of the specified permissions
 *
 * @param payload - The decoded JWT payload
 * @param permissions - The permissions to check (at least one must be present)
 * @returns true if any permission is present
 */
export function hasAnyPermissionInToken(
  payload: Record<string, unknown>,
  permissions: string[],
): boolean {
  const claims = extractRBACClaims(payload)
  if (!claims) {
    return false
  }
  return permissions.some((p) => claims.permissions.includes(p))
}
