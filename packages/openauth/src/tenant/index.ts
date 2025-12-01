/**
 * Tenant Management Module
 *
 * Provides multi-tenant white-label infrastructure for OpenAuth enterprise SSO.
 *
 * Features:
 * - Tenant CRUD operations with storage abstraction
 * - Tenant-isolated storage (prefixed keys)
 * - Multiple tenant resolution strategies (domain, subdomain, path, header, query)
 * - White-label branding with theme injection
 * - RESTful API routes for tenant management
 *
 * @example
 * ```typescript
 * import {
 *   createTenantService,
 *   createTenantResolver,
 *   createTenantThemeMiddleware,
 *   tenantApiRoutes,
 *   TenantStorageImpl
 * } from "@openauthjs/openauth/tenant"
 *
 * // Create tenant service
 * const tenantService = createTenantService(storage)
 *
 * // Set up Hono app with tenant middleware
 * const app = new Hono()
 *
 * // Apply tenant resolution to all routes
 * app.use("*", createTenantResolver({
 *   service: tenantService,
 *   storage,
 *   config: { baseDomain: "auth.example.com" }
 * }))
 *
 * // Apply theme middleware
 * app.use("*", createTenantThemeMiddleware())
 *
 * // Mount tenant admin API
 * app.route("/api/tenants", tenantApiRoutes(tenantService))
 * ```
 *
 * @packageDocumentation
 */

// Types (re-exports from contracts + internal types)
export type {
  // Contract types
  Theme,
  TenantBranding,
  EmailTemplateConfig,
  TenantSettings,
  TenantStatus,
  Tenant,
  TenantService,
  TenantResolver,
  TenantStorage,
  TenantContext,
  TenantErrorCode,
  // Internal types
  CreateTenantParams,
  UpdateTenantParams,
  ListTenantsParams,
  DomainLookup,
  TenantResolutionStrategy,
  TenantResolutionResult,
  TenantResolverConfig,
} from "./types.js"

export {
  // Error class
  TenantError,
  // Constants
  DEFAULT_RESOLVER_CONFIG,
  TENANT_STORAGE_KEYS,
  TENANT_STORAGE_PREFIX,
  THEME_CSS_VARS,
  THEME_HEADERS,
} from "./types.js"

// Service
export {
  TenantServiceImpl,
  createTenantService,
  type D1Database,
  type D1PreparedStatement,
  type D1Result,
} from "./service.js"

// Storage
export { TenantStorageImpl, createTenantStorage } from "./storage.js"

// Resolver middleware
export {
  createTenantResolver,
  getTenant,
  getTenantStorage,
  requireTenant,
  requireTenantStorage,
  type TenantResolverOptions,
} from "./resolver.js"

// Theme middleware
export {
  createTenantThemeMiddleware,
  buildCssVars,
  parseCssVars,
  generateThemeStyles,
  generateBrandingStyles,
  readThemeFromHeaders,
  type TenantThemeOptions,
} from "./theme.js"

// API routes
export { tenantApiRoutes, createTenantApi } from "./api.js"
