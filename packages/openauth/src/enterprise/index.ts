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
