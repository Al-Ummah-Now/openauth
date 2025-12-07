/**
 * OAuth Client Management Module
 *
 * Provides comprehensive CRUD APIs for OAuth client management with:
 * - Secure secret generation (256-bit entropy)
 * - Secret hashing with PBKDF2-SHA256 (100,000 iterations)
 * - Secret rotation with grace period support
 * - Tenant isolation
 * - Full validation
 *
 * @packageDocumentation
 */

// Types
export * from "./types.js"

// Errors
export * from "./errors.js"

// Service
export { ClientService } from "./service.js"

// API Routes
export { clientAdminRoutes } from "./api.js"

// Secret utilities
export {
  generateClientId,
  generateClientSecret,
  hashClientSecret,
  verifyClientSecret,
} from "./secret-generator.js"

// Validation
export {
  validateClientName,
  validateGrantTypes,
  validateScopes,
  validateRedirectUris,
  validateMetadata,
} from "./validation.js"

// D1 Adapter
export { ClientD1Adapter } from "./client-d1-adapter.js"
