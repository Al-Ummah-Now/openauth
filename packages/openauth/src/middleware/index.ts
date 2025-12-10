/**
 * Middleware Module Exports
 */

// Types
export type {
  M2MTokenPayload,
  UserTokenPayload,
  TokenPayload,
  AuthContextVariables,
  RateLimitConfig,
  RateLimitInfo,
} from "./types.js"

// Errors
export {
  AuthError,
  MissingTokenError,
  InvalidTokenError,
  InsufficientScopeError,
  TenantMismatchError,
  RateLimitExceededError,
} from "./errors.js"

// Bearer Auth
export {
  bearerAuth,
  extractBearerToken,
  clearJWKSCache,
  type BearerAuthOptions,
} from "./bearer-auth.js"

// Scope Authorization
export {
  requireScope,
  requireAnyScope,
  requireScopeIf,
  hasScope,
  hasAllScopes,
  hasAnyScope,
} from "./require-scope.js"

// Tenant Isolation
export {
  requireTenantMatch,
  tenantFromSubdomain,
  requireBodyTenantMatch,
} from "./tenant-isolation.js"

// Rate Limiting
export {
  rateLimit,
  endpointRateLimit,
  memoryStore,
  kvStore,
  defaultKeyGenerator,
  type RateLimitStore,
  type KeyGenerator,
} from "./rate-limit.js"

// Error Handling
export { authErrorHandler, onAuthError } from "./error-handler.js"

// Composition
export {
  enterpriseAuth,
  applyMiddleware,
  type EnterpriseAuthOptions,
} from "./compose.js"

// Re-export client authentication from existing module
export {
  clientAuth,
  requireClientAuth,
  optionalClientAuth,
  ClientAuthError,
  type ClientAuthMiddlewareOptions,
} from "./client-auth.js"
