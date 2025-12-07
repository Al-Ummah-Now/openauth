/**
 * Enterprise Multi-Tenant OpenAuth - Complete Authentication Platform
 *
 * This module provides a production-ready enterprise authentication solution
 * that combines all enterprise features into a unified, easy-to-use API.
 *
 * ## Core Features
 *
 * - **Multi-Tenancy**: Complete tenant isolation with white-label branding
 * - **Multi-Account Sessions**: Users can be logged into up to 3 accounts per browser
 * - **Role-Based Access Control**: Fine-grained permissions with token enrichment
 * - **OIDC Compliance**: Full support for prompt, max_age, login_hint, account_hint
 * - **Single Sign-On**: Cross-app authentication within a tenant
 *
 * ## Quick Start
 *
 * ```ts title="enterprise-issuer.ts"
 * import {
 *   createMultiTenantIssuer,
 *   hexToSecret,
 * } from "@openauthjs/openauth/enterprise"
 * import { createTenantService } from "@openauthjs/openauth/tenant"
 * import { SessionServiceImpl } from "@openauthjs/openauth/session"
 * import { RBACServiceImpl, RBACAdapter } from "@openauthjs/openauth/rbac"
 * import { DynamoStorage } from "@openauthjs/openauth/storage/dynamo"
 * import { GoogleProvider } from "@openauthjs/openauth/provider/google"
 * import { createSubjects } from "@openauthjs/openauth/subject"
 * import { object, string, array } from "valibot"
 *
 * // Define subject schema with enterprise fields
 * const subjects = createSubjects({
 *   user: object({
 *     userId: string(),
 *     email: string(),
 *     tenantId: string(),
 *     roles: array(string()),
 *     permissions: array(string()),
 *   }),
 * })
 *
 * // Initialize storage
 * const storage = DynamoStorage({ table: "auth-storage" })
 *
 * // Initialize enterprise services
 * const tenantService = createTenantService(storage)
 * const sessionService = new SessionServiceImpl(storage, {
 *   maxAccountsPerSession: 3,
 *   sessionLifetimeSeconds: 7 * 24 * 60 * 60, // 7 days
 * })
 *
 * // Optional: Initialize RBAC (requires D1 database)
 * const rbacAdapter = new RBACAdapter(d1Database)
 * const rbacService = new RBACServiceImpl(rbacAdapter, storage)
 *
 * // Create the enterprise issuer
 * const { app } = createMultiTenantIssuer({
 *   tenantService,
 *   sessionService,
 *   rbacService, // Optional
 *   storage,
 *   sessionSecret: hexToSecret(process.env.SESSION_SECRET!),
 *   providers: {
 *     google: GoogleProvider({
 *       clientId: process.env.GOOGLE_CLIENT_ID!,
 *       clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 *     }),
 *   },
 *   subjects,
 *   tenantResolver: {
 *     baseDomain: "auth.example.com",
 *   },
 *   onSuccess: async (ctx, value, tenant) => {
 *     const userId = await findOrCreateUser({
 *       email: value.email,
 *       tenantId: tenant.id,
 *       provider: value.provider,
 *     })
 *
 *     return ctx.subject("user", {
 *       userId,
 *       email: value.email,
 *       tenantId: tenant.id,
 *       roles: value.roles,
 *       permissions: value.permissions,
 *     })
 *   },
 * })
 *
 * // Export for your runtime
 * export default app
 * ```
 *
 * ## Architecture
 *
 * ```
 * +-------------------------------------------------------------------+
 * |                    Enterprise Multi-Tenant Issuer                 |
 * +-------------------------------------------------------------------+
 *        |                    |                    |
 *        v                    v                    v
 * +-------------+      +-------------+      +-------------+
 * |   Tenant    |      |   Session   |      |    RBAC     |
 * |   Service   |      |   Service   |      |   Service   |
 * +-------------+      +-------------+      +-------------+
 *        |                    |                    |
 *        v                    v                    v
 * +-------------------------------------------------------------------+
 * |                      Storage Adapter (KV/Dynamo)                  |
 * +-------------------------------------------------------------------+
 * ```
 *
 * ## API Endpoints
 *
 * The enterprise issuer automatically mounts these endpoints:
 *
 * ### OAuth/OIDC
 *
 * | Endpoint | Method | Description |
 * |----------|--------|-------------|
 * | `/authorize` | GET | Authorization endpoint with OIDC extensions |
 * | `/token` | POST | Token endpoint |
 * | `/userinfo` | GET | UserInfo endpoint |
 * | `/.well-known/openid-configuration` | GET | OIDC discovery document |
 * | `/.well-known/oauth-authorization-server` | GET | OAuth discovery document |
 * | `/.well-known/jwks.json` | GET | JSON Web Key Set |
 *
 * ### Session Management
 *
 * | Endpoint | Method | Description |
 * |----------|--------|-------------|
 * | `/session/accounts` | GET | List logged-in accounts |
 * | `/session/switch` | POST | Switch active account |
 * | `/session/accounts/:userId` | DELETE | Sign out one account |
 * | `/session/all` | DELETE | Sign out all accounts |
 * | `/session/check` | GET | Silent session check (CORS enabled) |
 * | `/admin/sessions/revoke-user` | POST | Revoke all sessions for a user |
 * | `/admin/sessions/revoke` | POST | Revoke a specific session |
 *
 * ### RBAC (if configured)
 *
 * | Endpoint | Method | Description |
 * |----------|--------|-------------|
 * | `/rbac/check` | POST | Check single permission |
 * | `/rbac/check/batch` | POST | Check multiple permissions |
 * | `/rbac/permissions` | GET | Get user permissions |
 * | `/rbac/roles` | GET | Get user roles |
 * | `/rbac/admin/*` | Various | Admin management endpoints |
 *
 * ### Tenant Management
 *
 * | Endpoint | Method | Description |
 * |----------|--------|-------------|
 * | `/tenants` | POST/GET | Create/list tenants |
 * | `/tenants/:id` | GET/PUT/DELETE | Manage specific tenant |
 * | `/tenants/:id/branding` | PUT | Update tenant branding |
 * | `/tenants/:id/settings` | PUT | Update tenant settings |
 *
 * ## OIDC Parameters
 *
 * The enterprise issuer supports these OIDC parameters:
 *
 * | Parameter | Values | Description |
 * |-----------|--------|-------------|
 * | `prompt` | `none`, `login`, `consent`, `select_account` | Control auth UI behavior |
 * | `login_hint` | email or user ID | Pre-fill login form |
 * | `account_hint` | user ID | Select specific logged-in account |
 * | `max_age` | seconds | Force re-auth if session older than |
 *
 * ## Security
 *
 * - Session cookies encrypted with AES-256-GCM (JWE)
 * - 256-bit cryptographically random session IDs
 * - Tenant isolation at storage level
 * - RBAC with cached permission checking
 *
 * @see {@link createMultiTenantIssuer} - Main factory function
 * @see {@link EnterpriseIssuerConfig} - Configuration options
 * @see {@link EnterpriseSuccessContext} - Success callback context
 * @see [ENTERPRISE_FEATURES.md](../docs/ENTERPRISE_FEATURES.md) - Full documentation
 * @see [MIGRATION_GUIDE.md](../docs/MIGRATION_GUIDE.md) - Migration guide
 *
 * @packageDocumentation
 */

import { Hono } from "hono/tiny"
import type { Context } from "hono"
import type { D1Database } from "@cloudflare/workers-types"

import type {
  SessionService,
  TenantService,
  RBACService,
} from "../contracts/types.js"
import type { StorageAdapter } from "../storage/storage.js"

// ============================================
// MAIN EXPORTS
// ============================================

// Enterprise Issuer Factory
export { createMultiTenantIssuer } from "./issuer.js"

// Session Integration Helpers
export {
  addAccountToSession,
  handlePromptParameter,
  handleMaxAge,
  handleAccountHint,
  handleLoginHint,
  validateSessionForSilentAuth,
  createOIDCErrorRedirect,
  createOIDCErrorFragment,
  formatAccountsForPicker,
  generateAddAccountUrl,
} from "./session-integration.js"

// Default Tenant Cache
export {
  getDefaultTenantTheme,
  invalidateDefaultTenantCache,
  DEFAULT_TENANT_ID,
  DEFAULT_CACHE_TTL_MS,
} from "./default-tenant-cache.js"

// ============================================
// TYPE EXPORTS
// ============================================

export type {
  // Configuration
  EnterpriseIssuerConfig,
  TenantResolverOptions,
  CorsOptions,
  // Success handling
  EnterpriseSuccessContext,
  EnterpriseAuthResult,
  // Session integration
  AddAccountParams,
  PromptHandlerResult,
  OIDCErrorResponse,
  // Context types
  EnterpriseContextVariables,
  EnterpriseAuthorizationState,
  // Account picker
  AccountPickerAccount,
  AccountPickerResponse,
  // Result types
  MultiTenantIssuer,
} from "./types.js"

// ============================================
// RE-EXPORTS FROM OTHER MODULES
// ============================================

// Session utilities (commonly used with enterprise issuer)
export {
  hexToSecret,
  base64ToSecret,
  secretToHex,
  generateCookieSecret,
} from "../session/cookie.js"

// Contract types (for typing)
export type {
  Tenant,
  TenantService,
  TenantBranding,
  TenantSettings,
  TenantStatus,
  SessionService,
  SessionConfig,
  BrowserSession,
  AccountSession,
  RBACService,
  RBACClaims,
  Role,
  Permission,
  PromptType,
} from "../contracts/types.js"

// Default configs
export {
  DEFAULT_SESSION_CONFIG,
  DEFAULT_RBAC_CONFIG,
} from "../contracts/types.js"

// ============================================
// ENTERPRISE ADMIN API
// ============================================

/**
 * Configuration for creating enterprise admin routes
 */
export interface EnterpriseAdminConfig {
  /**
   * D1 Database for storing admin data (users, clients, providers, RBAC)
   */
  database: D1Database

  /**
   * Storage adapter for KV-based data
   */
  storage: StorageAdapter

  /**
   * Tenant service instance
   */
  tenantService?: TenantService

  /**
   * Session service instance
   */
  sessionService?: SessionService

  /**
   * RBAC service instance (optional)
   */
  rbacService?: RBACService

  /**
   * Encryption key for provider secrets (32 bytes / 256 bits)
   * Required if using dynamic providers
   */
  providerEncryptionKey?: Uint8Array

  /**
   * Enable/disable specific admin modules
   */
  modules?: {
    users?: boolean
    clients?: boolean
    providers?: boolean
    rbac?: boolean
    tenants?: boolean
    sessions?: boolean
  }

  /**
   * Middleware to apply to all admin routes (e.g., authentication)
   */
  middleware?: ((ctx: Context, next: () => Promise<void>) => Promise<void>)[]

  /**
   * Prefix for admin routes (default: "/admin")
   */
  prefix?: string
}

/**
 * Result of createEnterpriseAdminRoutes
 */
export interface EnterpriseAdminRoutes {
  /**
   * The Hono app with all admin routes mounted
   */
  app: InstanceType<typeof Hono>

  /**
   * Individual route handlers for selective mounting
   */
  routes: {
    users?: InstanceType<typeof Hono>
    clients?: InstanceType<typeof Hono>
    providers?: InstanceType<typeof Hono>
    rbac?: InstanceType<typeof Hono>
    tenants?: InstanceType<typeof Hono>
    sessions?: InstanceType<typeof Hono>
  }
}

/**
 * Create enterprise admin API routes
 *
 * This function creates a unified Hono app with all enterprise admin APIs mounted:
 * - User Management API (/users)
 * - Client Management API (/clients)
 * - Dynamic Provider API (/providers)
 * - RBAC Admin API (/rbac)
 * - Tenant API (/tenants)
 * - Session Admin API (/sessions)
 *
 * @example Basic usage
 * ```typescript
 * import { createEnterpriseAdminRoutes } from "@openauthjs/openauth/enterprise"
 *
 * const { app: adminApp } = createEnterpriseAdminRoutes({
 *   database: env.DB,
 *   storage: kvStorage,
 *   providerEncryptionKey: hexToBytes(env.ENCRYPTION_KEY),
 * })
 *
 * // Mount under /admin
 * mainApp.route("/admin", adminApp)
 * ```
 *
 * @example With authentication middleware
 * ```typescript
 * import { bearerAuth, requireScope } from "@openauthjs/openauth/middleware"
 *
 * const { app: adminApp } = createEnterpriseAdminRoutes({
 *   database: env.DB,
 *   storage: kvStorage,
 *   middleware: [
 *     bearerAuth({ issuerUrl: env.ISSUER_URL }),
 *     requireScope("admin:write"),
 *   ],
 * })
 * ```
 *
 * @example Selective module enabling
 * ```typescript
 * const { app: adminApp } = createEnterpriseAdminRoutes({
 *   database: env.DB,
 *   storage: kvStorage,
 *   modules: {
 *     users: true,
 *     clients: true,
 *     providers: false, // Disable dynamic providers
 *     rbac: true,
 *   },
 * })
 * ```
 */
export function createEnterpriseAdminRoutes(
  config: EnterpriseAdminConfig,
): EnterpriseAdminRoutes {
  const app = new Hono()
  const routes: EnterpriseAdminRoutes["routes"] = {}

  // Default all modules to enabled
  const modules = {
    users: config.modules?.users ?? true,
    clients: config.modules?.clients ?? true,
    providers: config.modules?.providers ?? true,
    rbac: config.modules?.rbac ?? true,
    tenants: config.modules?.tenants ?? true,
    sessions: config.modules?.sessions ?? true,
  }

  // Apply global middleware
  if (config.middleware && config.middleware.length > 0) {
    for (const mw of config.middleware) {
      app.use("*", mw)
    }
  }

  // Mount User Management API
  if (modules.users) {
    const { userApiRoutes } = require("../user/api.js")
    const { createUserService } = require("../user/service.js")
    const { createD1UserAdapter } = require("../user/d1-adapter.js")

    const userAdapter = createD1UserAdapter({ database: config.database })
    const userService = createUserService({
      adapter: userAdapter,
      storage: config.storage,
    })

    const userRoutes = userApiRoutes(userService)
    routes.users = userRoutes
    app.route("/users", userRoutes)
  }

  // Mount Client Management API
  if (modules.clients) {
    const { clientAdminRoutes } = require("../client/api.js")
    const { ClientService } = require("../client/service.js")
    const { ClientD1Adapter } = require("../client/client-d1-adapter.js")

    const clientAdapter = new ClientD1Adapter(config.database)
    const clientService = new ClientService(clientAdapter, config.storage)

    const clientRoutes = clientAdminRoutes(clientService)
    routes.clients = clientRoutes
    app.route("/clients", clientRoutes)
  }

  // Mount Dynamic Provider API
  if (modules.providers && config.providerEncryptionKey) {
    const { createProviderApi } = require("../dynamic-provider/api.js")

    const providerRoutes = createProviderApi({
      database: config.database,
      encryptionKey: config.providerEncryptionKey,
    })
    routes.providers = providerRoutes
    app.route("/providers", providerRoutes)
  }

  // Mount RBAC Admin API
  if (modules.rbac) {
    if (config.rbacService) {
      const { rbacAdminEndpoints } = require("../rbac/admin-endpoints.js")
      const rbacRoutes = rbacAdminEndpoints(config.rbacService)
      routes.rbac = rbacRoutes
      app.route("/rbac", rbacRoutes)
    } else {
      // Create RBAC service from database
      const { RBACAdapter } = require("../rbac/d1-adapter.js")
      const { RBACServiceImpl } = require("../rbac/service.js")

      const rbacAdapter = new RBACAdapter(config.database)
      const rbacService = new RBACServiceImpl(rbacAdapter, config.storage)

      const { rbacAdminEndpoints } = require("../rbac/admin-endpoints.js")
      const rbacRoutes = rbacAdminEndpoints(rbacService)
      routes.rbac = rbacRoutes
      app.route("/rbac", rbacRoutes)
    }
  }

  // Mount Tenant API
  if (modules.tenants && config.tenantService) {
    const { tenantApiRoutes } = require("../tenant/api.js")
    const tenantRoutes = tenantApiRoutes(config.tenantService)
    routes.tenants = tenantRoutes
    app.route("/tenants", tenantRoutes)
  }

  // Mount Session Admin API
  if (modules.sessions && config.sessionService) {
    const { adminSessionRoutes } = require("../session/routes.js")
    const sessionRoutes = adminSessionRoutes(config.sessionService)
    routes.sessions = sessionRoutes
    app.route("/sessions", sessionRoutes)
  }

  return { app, routes }
}

/**
 * Configuration for creating a complete enterprise issuer with all features
 */
export interface CreateEnterpriseIssuerOptions {
  /**
   * D1 Database for admin data
   */
  database: D1Database

  /**
   * Storage adapter for KV-based data
   */
  storage: StorageAdapter

  /**
   * 256-bit secret key for session cookie encryption
   */
  sessionSecret: Uint8Array

  /**
   * Encryption key for provider secrets (32 bytes / 256 bits)
   */
  providerEncryptionKey?: Uint8Array

  /**
   * Authentication providers
   */
  providers: Record<string, any>

  /**
   * Subject schema definitions
   */
  subjects: any

  /**
   * Success callback
   */
  onSuccess?: (ctx: any, value: any, tenant: any) => Promise<Response>

  /**
   * Tenant resolver options
   */
  tenantResolver?: {
    baseDomain?: string
    pathPrefix?: string
    headerName?: string
    queryParam?: string
  }

  /**
   * Enable admin API routes
   */
  enableAdminApi?: boolean

  /**
   * Admin API prefix (default: "/admin")
   */
  adminApiPrefix?: string

  /**
   * Admin API authentication middleware
   */
  adminApiMiddleware?: ((
    ctx: Context,
    next: () => Promise<void>,
  ) => Promise<void>)[]
}

/**
 * Create a complete enterprise issuer with all features enabled
 *
 * This is a convenience function that sets up:
 * 1. Multi-tenant issuer with session management
 * 2. RBAC service with token enrichment
 * 3. User management service
 * 4. Client management service
 * 5. Dynamic provider management
 * 6. Admin API routes (optional)
 *
 * @example
 * ```typescript
 * import { createCompleteEnterpriseIssuer } from "@openauthjs/openauth/enterprise"
 * import { GoogleProvider } from "@openauthjs/openauth/provider/google"
 *
 * const { app, services } = await createCompleteEnterpriseIssuer({
 *   database: env.DB,
 *   storage: kvStorage,
 *   sessionSecret: hexToSecret(env.SESSION_SECRET),
 *   providerEncryptionKey: hexToBytes(env.ENCRYPTION_KEY),
 *   providers: {
 *     google: GoogleProvider({
 *       clientId: env.GOOGLE_CLIENT_ID,
 *       clientSecret: env.GOOGLE_CLIENT_SECRET,
 *     }),
 *   },
 *   subjects,
 *   enableAdminApi: true,
 *   onSuccess: async (ctx, value, tenant) => {
 *     return ctx.subject("user", {
 *       userId: value.userID,
 *       tenantId: tenant.id,
 *       roles: value.roles,
 *       permissions: value.permissions,
 *     })
 *   },
 * })
 *
 * export default app
 * ```
 */
export async function createCompleteEnterpriseIssuer(
  options: CreateEnterpriseIssuerOptions,
): Promise<{
  app: InstanceType<typeof Hono>
  services: {
    tenantService: TenantService
    sessionService: SessionService
    rbacService: RBACService
    userService?: any
    clientService?: any
  }
}> {
  // Import services dynamically
  const { TenantServiceImpl } = await import("../tenant/service.js")
  const { SessionServiceImpl } = await import("../session/service.js")
  const { RBACServiceImpl } = await import("../rbac/service.js")
  const { RBACAdapter } = await import("../rbac/d1-adapter.js")

  // Initialize services
  const tenantService = new TenantServiceImpl(options.storage)
  const sessionService = new SessionServiceImpl(options.storage)
  const rbacAdapter = new RBACAdapter(options.database)
  const rbacService = new RBACServiceImpl(rbacAdapter, options.storage)

  // Create the multi-tenant issuer
  const { createMultiTenantIssuer } = await import("./issuer.js")

  const { app: issuerApp } = createMultiTenantIssuer({
    tenantService,
    sessionService,
    rbacService,
    storage: options.storage,
    sessionSecret: options.sessionSecret,
    providers: options.providers,
    subjects: options.subjects,
    tenantResolver: options.tenantResolver,
    onSuccess: options.onSuccess,
  })

  // Create combined app
  const app = new Hono()

  // Mount admin API if enabled
  let userService: any
  let clientService: any

  if (options.enableAdminApi) {
    const { app: adminApp, routes } = createEnterpriseAdminRoutes({
      database: options.database,
      storage: options.storage,
      tenantService,
      sessionService,
      rbacService,
      providerEncryptionKey: options.providerEncryptionKey,
      middleware: options.adminApiMiddleware,
    })

    const prefix = options.adminApiPrefix || "/admin"
    app.route(prefix, adminApp)

    // Store service references
    if (routes.users) {
      // Services are created internally by createEnterpriseAdminRoutes
    }
  }

  // Mount the main issuer
  app.route("/", issuerApp)

  return {
    app,
    services: {
      tenantService,
      sessionService,
      rbacService,
      userService,
      clientService,
    },
  }
}
