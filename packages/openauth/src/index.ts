export {
  /**
   * @deprecated
   * Use `import { createClient } from "@openauthjs/openauth/client"` instead - it will tree shake better
   */
  createClient,
} from "./client.js"

export {
  /**
   * @deprecated
   * Use `import { createSubjects } from "@openauthjs/openauth/subject"` instead - it will tree shake better
   */
  createSubjects,
} from "./subject.js"

import { issuer } from "./issuer.js"

export {
  /**
   * @deprecated
   * Use `import { issuer } from "@openauthjs/openauth"` instead, it was renamed
   */
  issuer as authorizer,
  issuer,
}

// Enterprise SSO exports
export {
  /**
   * Create a multi-tenant enterprise issuer with session, tenant, and RBAC support.
   * @see import { createMultiTenantIssuer } from "@openauthjs/openauth/enterprise"
   */
  createMultiTenantIssuer,
} from "./enterprise/index.js"

// M2M (Machine-to-Machine) exports
export {
  /**
   * Generate an M2M token for machine-to-machine authentication.
   * @see import { generateM2MToken } from "@openauthjs/openauth/m2m"
   */
  generateM2MToken,
  /**
   * Validate requested scopes against allowed scopes.
   * @see import { validateScopes as validateM2MScopes } from "@openauthjs/openauth/m2m"
   */
  validateScopes as validateM2MScopes,
  /**
   * Parse a space-separated scope string into an array.
   * @see import { parseScopes } from "@openauthjs/openauth/m2m"
   */
  parseScopes,
} from "./m2m/index.js"

export type {
  /**
   * M2M configuration options.
   * @see import type { M2MConfig } from "@openauthjs/openauth/m2m"
   */
  M2MConfig,
  /**
   * M2M token claims (JWT payload).
   * @see import type { M2MTokenClaims } from "@openauthjs/openauth/m2m"
   */
  M2MTokenClaims,
  /**
   * M2M token request parameters.
   * @see import type { M2MTokenRequest } from "@openauthjs/openauth/m2m"
   */
  M2MTokenRequest,
  /**
   * M2M token response.
   * @see import type { M2MTokenResponse } from "@openauthjs/openauth/m2m"
   */
  M2MTokenResponse,
  /**
   * Result of scope validation.
   * @see import type { ScopeValidationResult } from "@openauthjs/openauth/m2m"
   */
  ScopeValidationResult,
} from "./m2m/index.js"

// User Management exports
export {
  /**
   * Create a user service for managing users.
   * @see import { createUserService } from "@openauthjs/openauth/user"
   */
  createUserService,
  /**
   * User service implementation class.
   * @see import { UserServiceImpl } from "@openauthjs/openauth/user"
   */
  UserServiceImpl,
  /**
   * Create D1 adapter for user storage.
   * @see import { createD1UserAdapter } from "@openauthjs/openauth/user"
   */
  createD1UserAdapter,
  /**
   * D1 adapter class for user storage.
   * @see import { D1UserAdapter } from "@openauthjs/openauth/user"
   */
  D1UserAdapter,
  /**
   * User API routes for Hono.
   * @see import { userApiRoutes } from "@openauthjs/openauth/user"
   */
  userApiRoutes,
  /**
   * Create user API handler.
   * @see import { createUserApi } from "@openauthjs/openauth/user"
   */
  createUserApi,
  /**
   * User error class.
   * @see import { UserError } from "@openauthjs/openauth/user"
   */
  UserError,
  /**
   * User validation error class.
   * @see import { UserValidationError } from "@openauthjs/openauth/user"
   */
  UserValidationError,
  /**
   * Storage keys for user data.
   * @see import { USER_STORAGE_KEYS } from "@openauthjs/openauth/user"
   */
  USER_STORAGE_KEYS,
} from "./user/index.js"

export type {
  /**
   * User entity type.
   * @see import type { User } from "@openauthjs/openauth/user"
   */
  User,
  /**
   * User identity type.
   * @see import type { UserIdentity } from "@openauthjs/openauth/user"
   */
  UserIdentity,
  /**
   * User with identities type.
   * @see import type { UserWithIdentities } from "@openauthjs/openauth/user"
   */
  UserWithIdentities,
  /**
   * User status type.
   * @see import type { UserStatus } from "@openauthjs/openauth/user"
   */
  UserStatus,
  /**
   * Parameters for creating a user.
   * @see import type { CreateUserParams } from "@openauthjs/openauth/user"
   */
  CreateUserParams,
  /**
   * Parameters for updating a user.
   * @see import type { UpdateUserParams } from "@openauthjs/openauth/user"
   */
  UpdateUserParams,
  /**
   * Parameters for listing users.
   * @see import type { ListUsersParams } from "@openauthjs/openauth/user"
   */
  ListUsersParams,
  /**
   * Response from listing users.
   * @see import type { ListUsersResponse } from "@openauthjs/openauth/user"
   */
  ListUsersResponse,
  /**
   * User service interface.
   * @see import type { UserService } from "@openauthjs/openauth/user"
   */
  UserService,
  /**
   * User service configuration.
   * @see import type { UserServiceConfig } from "@openauthjs/openauth/user"
   */
  UserServiceConfig,
  /**
   * User error code type.
   * @see import type { UserErrorCode } from "@openauthjs/openauth/user"
   */
  UserErrorCode,
  /**
   * D1 user adapter configuration.
   * @see import type { D1UserAdapterConfig } from "@openauthjs/openauth/user"
   */
  D1UserAdapterConfig,
} from "./user/index.js"

// Dynamic Provider exports
export {
  /**
   * Create dynamic provider API routes.
   * @see import { createProviderApi } from "@openauthjs/openauth/dynamic-provider"
   */
  createProviderApi,
  /**
   * Create dynamic provider loader.
   * @see import { createDynamicProviderLoader } from "@openauthjs/openauth/dynamic-provider"
   */
  createDynamicProviderLoader,
  /**
   * Dynamic provider loader class.
   * @see import { DynamicProviderLoader } from "@openauthjs/openauth/dynamic-provider"
   */
  DynamicProviderLoader,
  /**
   * Encryption service for provider secrets.
   * @see import { EncryptionService } from "@openauthjs/openauth/dynamic-provider"
   */
  EncryptionService,
  /**
   * Generate encryption key for provider secrets.
   * @see import { generateEncryptionKey } from "@openauthjs/openauth/dynamic-provider"
   */
  generateEncryptionKey,
  /**
   * Convert hex string to bytes.
   * @see import { hexToBytes } from "@openauthjs/openauth/dynamic-provider"
   */
  hexToBytes,
  /**
   * Convert bytes to hex string.
   * @see import { bytesToHex } from "@openauthjs/openauth/dynamic-provider"
   */
  bytesToHex,
  /**
   * TTL cache for provider configurations.
   * @see import { TTLCache } from "@openauthjs/openauth/dynamic-provider"
   */
  TTLCache,
  /**
   * Create provider from configuration.
   * @see import { createProviderFromConfig } from "@openauthjs/openauth/dynamic-provider"
   */
  createProviderFromConfig,
  /**
   * Validate provider configuration.
   * @see import { validateProviderConfig } from "@openauthjs/openauth/dynamic-provider"
   */
  validateProviderConfig,
  /**
   * Provider not found error.
   * @see import { ProviderNotFoundError } from "@openauthjs/openauth/dynamic-provider"
   */
  ProviderNotFoundError,
  /**
   * Provider configuration error.
   * @see import { ProviderConfigError } from "@openauthjs/openauth/dynamic-provider"
   */
  ProviderConfigError,
  /**
   * Encryption error.
   * @see import { EncryptionError } from "@openauthjs/openauth/dynamic-provider"
   */
  EncryptionError,
} from "./dynamic-provider/index.js"

export type {
  /**
   * Provider type enumeration.
   * @see import type { ProviderType } from "@openauthjs/openauth/dynamic-provider"
   */
  ProviderType,
  /**
   * Identity provider record from database.
   * @see import type { IdentityProviderRecord } from "@openauthjs/openauth/dynamic-provider"
   */
  IdentityProviderRecord,
  /**
   * Identity provider configuration.
   * @see import type { IdentityProvider } from "@openauthjs/openauth/dynamic-provider"
   */
  IdentityProvider,
  /**
   * Provider configuration union type.
   * @see import type { ProviderConfig } from "@openauthjs/openauth/dynamic-provider"
   */
  ProviderConfig,
  /**
   * Create provider request type.
   * @see import type { CreateProviderRequest } from "@openauthjs/openauth/dynamic-provider"
   */
  CreateProviderRequest,
  /**
   * Update provider request type.
   * @see import type { UpdateProviderRequest } from "@openauthjs/openauth/dynamic-provider"
   */
  UpdateProviderRequest,
  /**
   * Provider API options.
   * @see import type { ProviderApiOptions } from "@openauthjs/openauth/dynamic-provider"
   */
  ProviderApiOptions,
  /**
   * Provider loader options.
   * @see import type { ProviderLoaderOptions } from "@openauthjs/openauth/dynamic-provider"
   */
  ProviderLoaderOptions,
} from "./dynamic-provider/index.js"

// Client Management exports
export {
  /**
   * Client service for OAuth client management.
   * @see import { ClientService } from "@openauthjs/openauth/client"
   */
  ClientService,
  /**
   * Client admin API routes.
   * @see import { clientAdminRoutes } from "@openauthjs/openauth/client"
   */
  clientAdminRoutes,
  /**
   * Generate a client ID.
   * @see import { generateClientId } from "@openauthjs/openauth/client"
   */
  generateClientId,
  /**
   * Generate a client secret.
   * @see import { generateClientSecret } from "@openauthjs/openauth/client"
   */
  generateClientSecret,
  /**
   * Hash a client secret.
   * @see import { hashClientSecret } from "@openauthjs/openauth/client"
   */
  hashClientSecret,
  /**
   * Verify a client secret.
   * @see import { verifyClientSecret } from "@openauthjs/openauth/client"
   */
  verifyClientSecret,
  /**
   * Validate client name.
   * @see import { validateClientName } from "@openauthjs/openauth/client"
   */
  validateClientName,
  /**
   * Validate grant types.
   * @see import { validateGrantTypes } from "@openauthjs/openauth/client"
   */
  validateGrantTypes,
  /**
   * Validate redirect URIs.
   * @see import { validateRedirectUris } from "@openauthjs/openauth/client"
   */
  validateRedirectUris,
  /**
   * Client D1 adapter.
   * @see import { ClientD1Adapter } from "@openauthjs/openauth/client"
   */
  ClientD1Adapter,
} from "./client/index.js"

// Middleware exports
export {
  /**
   * Bearer authentication middleware.
   * @see import { bearerAuth } from "@openauthjs/openauth/middleware"
   */
  bearerAuth,
  /**
   * Extract bearer token from request.
   * @see import { extractBearerToken } from "@openauthjs/openauth/middleware"
   */
  extractBearerToken,
  /**
   * Require specific scope middleware.
   * @see import { requireScope } from "@openauthjs/openauth/middleware"
   */
  requireScope,
  /**
   * Require any of specified scopes middleware.
   * @see import { requireAnyScope } from "@openauthjs/openauth/middleware"
   */
  requireAnyScope,
  /**
   * Rate limiting middleware.
   * @see import { rateLimit } from "@openauthjs/openauth/middleware"
   */
  rateLimit,
  /**
   * Endpoint-specific rate limiting.
   * @see import { endpointRateLimit } from "@openauthjs/openauth/middleware"
   */
  endpointRateLimit,
  /**
   * Tenant isolation middleware.
   * @see import { requireTenantMatch } from "@openauthjs/openauth/middleware"
   */
  requireTenantMatch,
  /**
   * Auth error handler middleware.
   * @see import { authErrorHandler } from "@openauthjs/openauth/middleware"
   */
  authErrorHandler,
  /**
   * Enterprise authentication middleware composition.
   * @see import { enterpriseAuth } from "@openauthjs/openauth/middleware"
   */
  enterpriseAuth,
  /**
   * Apply multiple middleware in sequence.
   * @see import { applyMiddleware } from "@openauthjs/openauth/middleware"
   */
  applyMiddleware,
  /**
   * Client authentication middleware.
   * @see import { clientAuth } from "@openauthjs/openauth/middleware"
   */
  clientAuth,
  /**
   * Auth error classes.
   * @see import { AuthError } from "@openauthjs/openauth/middleware"
   */
  AuthError,
  /**
   * Missing token error.
   * @see import { MissingTokenError } from "@openauthjs/openauth/middleware"
   */
  MissingTokenError,
  /**
   * Invalid token error.
   * @see import { InvalidTokenError } from "@openauthjs/openauth/middleware"
   */
  InvalidTokenError,
  /**
   * Insufficient scope error.
   * @see import { InsufficientScopeError } from "@openauthjs/openauth/middleware"
   */
  InsufficientScopeError,
  /**
   * Rate limit exceeded error.
   * @see import { RateLimitExceededError } from "@openauthjs/openauth/middleware"
   */
  RateLimitExceededError,
} from "./middleware/index.js"

export type {
  /**
   * M2M token payload type.
   * @see import type { M2MTokenPayload } from "@openauthjs/openauth/middleware"
   */
  M2MTokenPayload,
  /**
   * User token payload type.
   * @see import type { UserTokenPayload } from "@openauthjs/openauth/middleware"
   */
  UserTokenPayload,
  /**
   * Token payload union type.
   * @see import type { TokenPayload } from "@openauthjs/openauth/middleware"
   */
  TokenPayload,
  /**
   * Auth context variables for Hono.
   * @see import type { AuthContextVariables } from "@openauthjs/openauth/middleware"
   */
  AuthContextVariables,
  /**
   * Rate limit configuration.
   * @see import type { RateLimitConfig } from "@openauthjs/openauth/middleware"
   */
  RateLimitConfig,
  /**
   * Enterprise auth options.
   * @see import type { EnterpriseAuthOptions } from "@openauthjs/openauth/middleware"
   */
  EnterpriseAuthOptions,
} from "./middleware/index.js"

// RBAC exports
export {
  /**
   * RBAC D1 adapter.
   * @see import { RBACAdapter } from "@openauthjs/openauth/rbac"
   */
  RBACAdapter,
  /**
   * RBAC service implementation.
   * @see import { RBACServiceImpl } from "@openauthjs/openauth/rbac"
   */
  RBACServiceImpl,
  /**
   * Enrich token with RBAC claims.
   * @see import { enrichTokenWithRBAC } from "@openauthjs/openauth/rbac"
   */
  enrichTokenWithRBAC,
  /**
   * Create token enricher function.
   * @see import { createTokenEnricher } from "@openauthjs/openauth/rbac"
   */
  createTokenEnricher,
  /**
   * RBAC API endpoints.
   * @see import { rbacEndpoints } from "@openauthjs/openauth/rbac"
   */
  rbacEndpoints,
  /**
   * RBAC admin API endpoints.
   * @see import { rbacAdminEndpoints } from "@openauthjs/openauth/rbac"
   */
  rbacAdminEndpoints,
  /**
   * Default RBAC configuration.
   * @see import { DEFAULT_RBAC_CONFIG } from "@openauthjs/openauth/rbac"
   */
  DEFAULT_RBAC_CONFIG,
} from "./rbac/index.js"

export type {
  /**
   * Role type.
   * @see import type { Role } from "@openauthjs/openauth/rbac"
   */
  Role,
  /**
   * Permission type.
   * @see import type { Permission } from "@openauthjs/openauth/rbac"
   */
  Permission,
  /**
   * App type for RBAC.
   * @see import type { App } from "@openauthjs/openauth/rbac"
   */
  App,
  /**
   * RBAC claims for tokens.
   * @see import type { RBACClaims } from "@openauthjs/openauth/rbac"
   */
  RBACClaims,
  /**
   * RBAC configuration type.
   * @see import type { RBACConfig } from "@openauthjs/openauth/rbac"
   */
  RBACConfig,
  /**
   * RBAC service interface.
   * @see import type { RBACService } from "@openauthjs/openauth/rbac"
   */
  RBACService,
} from "./rbac/index.js"
