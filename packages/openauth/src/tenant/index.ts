/**
 * Multi-tenant white-label infrastructure for OpenAuth enterprise SSO.
 *
 * This module enables a single OpenAuth deployment to serve multiple organizations
 * with complete data isolation and customizable branding. Each tenant can have
 * their own domain, theme, and authentication settings.
 *
 * ## Features
 *
 * - **Tenant CRUD Operations**: Full lifecycle management with storage abstraction
 * - **Tenant-Isolated Storage**: All data automatically prefixed with tenant ID
 * - **Multiple Resolution Strategies**: Domain, subdomain, path, header, or query parameter
 * - **White-Label Branding**: Custom themes, logos, colors, and CSS per tenant
 * - **RESTful Admin API**: Complete tenant management endpoints
 *
 * ## Quick Start
 *
 * ```ts title="tenant-setup.ts"
 * import {
 *   createTenantService,
 *   createTenantResolver,
 *   createTenantThemeMiddleware,
 *   tenantApiRoutes,
 * } from "@openauthjs/openauth/tenant"
 *
 * // Create tenant service
 * const tenantService = createTenantService(storage, d1Database)
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
 * // Apply theme middleware for branding
 * app.use("*", createTenantThemeMiddleware())
 *
 * // Mount tenant admin API
 * app.route("/api/tenants", tenantApiRoutes(tenantService))
 * ```
 *
 * ## Tenant Resolution Strategies
 *
 * Tenants are resolved from requests in priority order:
 *
 * 1. **Custom Domain**: `auth.clientcorp.com` -> tenant "clientcorp"
 * 2. **Subdomain**: `clientcorp.auth.example.com` -> tenant "clientcorp"
 * 3. **Path Prefix**: `/tenants/clientcorp/authorize` -> tenant "clientcorp"
 * 4. **HTTP Header**: `X-Tenant-ID: clientcorp` -> tenant "clientcorp"
 * 5. **Query Parameter**: `?tenant=clientcorp` -> tenant "clientcorp"
 *
 * ## Storage Key Prefixing
 *
 * All tenant data is automatically isolated:
 * ```
 * t:{tenantId}:oauth:code:{code}
 * t:{tenantId}:oauth:refresh:{subject}:{token}
 * t:{tenantId}:client:{clientId}
 * ```
 *
 * ## API Endpoints
 *
 * When mounted, the tenant API provides:
 *
 * | Endpoint | Method | Description |
 * |----------|--------|-------------|
 * | `/tenants` | POST | Create tenant |
 * | `/tenants` | GET | List tenants |
 * | `/tenants/:id` | GET | Get tenant by ID |
 * | `/tenants/:id` | PUT | Update tenant |
 * | `/tenants/:id` | DELETE | Delete tenant (soft delete) |
 * | `/tenants/:id/branding` | PUT | Update branding only |
 * | `/tenants/:id/settings` | PUT | Update settings only |
 *
 * ## Branding Configuration
 *
 * Each tenant can customize:
 * - Theme colors (primary, secondary, background, text)
 * - Logo images (light and dark variants)
 * - Favicon
 * - Custom CSS injection
 * - Email templates
 *
 * @see {@link TenantServiceImpl} - Main tenant service implementation
 * @see {@link createTenantResolver} - Middleware for tenant resolution
 * @see {@link createTenantThemeMiddleware} - Middleware for theme injection
 * @see {@link tenantApiRoutes} - REST API for tenant management
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
