/**
 * Enterprise Multi-Tenant OpenAuth Module
 *
 * This module provides a complete enterprise-grade authentication solution
 * that integrates:
 *
 * - **Multi-Tenancy**: Tenant resolution, isolation, and white-label branding
 * - **Session Management**: Multi-account browser sessions with SSO
 * - **RBAC**: Role-based access control with token enrichment
 * - **OIDC Compliance**: Support for prompt, max_age, login_hint parameters
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   createMultiTenantIssuer,
 *   hexToSecret,
 * } from "@openauthjs/openauth/enterprise"
 * import { TenantServiceImpl, createTenantService } from "@openauthjs/openauth/tenant"
 * import { SessionServiceImpl } from "@openauthjs/openauth/session"
 * import { RBACServiceImpl, RBACAdapter } from "@openauthjs/openauth/rbac"
 * import { DynamoStorage } from "@openauthjs/openauth/storage/dynamo"
 * import { GoogleProvider } from "@openauthjs/openauth/provider/google"
 * import { createSubjects } from "@openauthjs/openauth/subject"
 * import { object, string, array } from "valibot"
 *
 * // Define subjects schema
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
 * // Initialize services
 * const tenantService = createTenantService(storage)
 * const sessionService = new SessionServiceImpl(storage, {
 *   maxAccountsPerSession: 3,
 *   sessionLifetimeSeconds: 7 * 24 * 60 * 60, // 7 days
 * })
 *
 * // Optional: Initialize RBAC
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
 *     // Look up or create user in your database
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
 * // Export for your runtime (Cloudflare Workers, Node, Bun, etc.)
 * export default app
 * ```
 *
 * ## API Endpoints
 *
 * The enterprise issuer exposes these endpoints:
 *
 * ### OAuth/OIDC
 * - `GET /authorize` - Authorization endpoint with OIDC extensions
 * - `POST /token` - Token endpoint (via providers)
 * - `GET /userinfo` - UserInfo endpoint
 * - `GET /.well-known/openid-configuration` - OIDC discovery
 * - `GET /.well-known/oauth-authorization-server` - OAuth discovery
 * - `GET /.well-known/jwks.json` - JSON Web Key Set
 *
 * ### Session Management
 * - `GET /session/accounts` - List logged-in accounts
 * - `POST /session/switch` - Switch active account
 * - `DELETE /session/accounts/:userId` - Sign out one account
 * - `DELETE /session/all` - Sign out all accounts
 * - `GET /session/check` - Silent session check
 *
 * ### Admin Session Management
 * - `POST /admin/sessions/revoke-user` - Revoke all sessions for a user
 * - `POST /admin/sessions/revoke` - Revoke a specific session
 *
 * ### RBAC (if configured)
 * - `POST /rbac/check` - Check single permission
 * - `POST /rbac/check/batch` - Check multiple permissions
 * - `GET /rbac/permissions` - Get user permissions
 * - `GET /rbac/roles` - Get user roles
 *
 * ### RBAC Admin
 * - `POST /rbac/admin/apps` - Create app
 * - `GET /rbac/admin/apps` - List apps
 * - `POST /rbac/admin/roles` - Create role
 * - `GET /rbac/admin/roles` - List roles
 * - `POST /rbac/admin/permissions` - Create permission
 * - `GET /rbac/admin/permissions` - List permissions
 * - `POST /rbac/admin/users/:userId/roles` - Assign role
 * - `DELETE /rbac/admin/users/:userId/roles/:roleId` - Remove role
 * - `POST /rbac/admin/roles/:roleId/permissions` - Assign permission
 * - `DELETE /rbac/admin/roles/:roleId/permissions/:permissionId` - Remove permission
 *
 * ### Tenant Management
 * - `POST /tenants` - Create tenant
 * - `GET /tenants` - List tenants
 * - `GET /tenants/:id` - Get tenant
 * - `PUT /tenants/:id` - Update tenant
 * - `DELETE /tenants/:id` - Delete tenant
 * - `PUT /tenants/:id/branding` - Update branding
 * - `PUT /tenants/:id/settings` - Update settings
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
