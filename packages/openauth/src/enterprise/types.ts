/**
 * Enterprise Issuer Types
 *
 * Type definitions for the multi-tenant enterprise issuer that integrates
 * session management, tenant resolution, and RBAC.
 *
 * @packageDocumentation
 */

import type {
  SessionService,
  TenantService,
  RBACService,
  Tenant,
  SessionConfig,
  BrowserSession,
  AccountSession,
  RBACClaims,
  PromptType,
  AuthorizationRequest,
} from "../contracts/types.js"
import type { StorageAdapter } from "../storage/storage.js"
import type { Provider } from "../provider/provider.js"
import type { SubjectSchema, SubjectPayload } from "../subject.js"
import type { Theme } from "../ui/theme.js"
import type { RenderOptions } from "../ui/render.js"
import type { D1Database } from "@cloudflare/workers-types"
import type { Context } from "hono"
import type { AuditService } from "../services/audit.js"
import type { UnknownStateError } from "../error.js"

// ============================================
// ENTERPRISE ISSUER CONFIGURATION
// ============================================

/**
 * Configuration for the multi-tenant enterprise issuer.
 *
 * @example
 * ```typescript
 * const config: EnterpriseIssuerConfig = {
 *   tenantService,
 *   sessionService,
 *   rbacService,
 *   storage,
 *   sessionSecret: hexToSecret(process.env.SESSION_SECRET!),
 *   providers: {
 *     google: GoogleProvider({ ... }),
 *     password: PasswordProvider({ ... }),
 *   },
 *   subjects,
 *   onSuccess: async (ctx, value, tenant) => {
 *     return ctx.subject("user", {
 *       userId: value.userID,
 *       tenantId: tenant.id,
 *       roles: value.roles,
 *     })
 *   },
 * }
 * ```
 */
export interface EnterpriseIssuerConfig<
  Providers extends Record<string, Provider<any>> = Record<
    string,
    Provider<any>
  >,
  Subjects extends SubjectSchema = SubjectSchema,
> {
  /**
   * Tenant service for resolving and managing tenants
   */
  tenantService: TenantService

  /**
   * Session service for multi-account session management
   */
  sessionService: SessionService

  /**
   * Optional RBAC service for role-based access control.
   * If provided, token claims will be enriched with roles and permissions.
   */
  rbacService?: RBACService

  /**
   * Base storage adapter for OAuth data
   */
  storage: StorageAdapter

  /**
   * 256-bit secret key for session cookie encryption.
   * Use hexToSecret() or base64ToSecret() to convert from string.
   */
  sessionSecret: Uint8Array

  /**
   * Optional session configuration overrides
   */
  sessionConfig?: Partial<SessionConfig>

  /**
   * Authentication providers (Google, GitHub, Password, etc.)
   */
  providers: Providers

  /**
   * Subject schema definitions for token payloads
   */
  subjects: Subjects

  /**
   * Optional D1 database for client credentials (confidential clients)
   */
  clientDb?: D1Database

  /**
   * Optional theme configuration for UI customization.
   *
   * This theme serves as the default for all tenants that don't have
   * their own branding.theme configured.
   *
   * Theme priority chain (resolved per request):
   * 1. tenant.branding.theme (per-tenant customization) - highest priority
   * 2. config.theme (this property) - default for all tenants
   * 3. THEME_OPENAUTH (hardcoded fallback) - lowest priority
   *
   * The resolved theme is kept on the request context, available via
   * ctx.get("resolvedTheme"), and passed to every page render.
   *
   * @example
   * ```typescript
   * import { THEME_TERMINAL } from "@openauthjs/openauth/ui/theme"
   *
   * createMultiTenantIssuer({
   *   theme: THEME_TERMINAL,
   *   // ... other config
   * })
   * ```
   *
   * @example Custom theme
   * ```typescript
   * createMultiTenantIssuer({
   *   theme: {
   *     title: "My App",
   *     primary: "#FF5E00",
   *     background: { light: "#FFF", dark: "#000" },
   *     font: { family: "Inter, sans-serif" }
   *   },
   *   // ... other config
   * })
   * ```
   */
  theme?: Theme

  /**
   * Fixed issuer URL (e.g. `https://auth.example.com`).
   *
   * When set, it is used as the `iss` claim of every token, in discovery
   * documents (`/.well-known/openid-configuration`,
   * `/.well-known/oauth-authorization-server`) and when verifying tokens.
   * Request-derived values (Host, X-Forwarded-Host/Proto/Port) are then
   * ignored for the issuer and for the default redirect_uri allow check.
   *
   * When not set, the issuer is derived from the request (legacy behaviour).
   */
  issuer?: string

  /**
   * Device authorization grant (RFC 8628). See `IssuerInput.device`.
   * Requires `clientDb`.
   */
  device?: import("../device.js").DeviceFlowOptions
  /**
   * PKCE policy (only `S256` is ever accepted). See `IssuerInput.pkce`.
   */
  pkce?: {
    /**
     * Require PKCE for clients registered in `clientDb` without a secret.
     * @default false
     */
    requireForPublicClients?: boolean
    /**
     * Require PKCE (or client authentication) at the code exchange: `true`
     * for every client, or only for the listed client ids. See
     * `IssuerInput.pkce.requireForCodeExchange`.
     * @default false
     */
    requireForCodeExchange?:
      | boolean
      | readonly string[]
      | ((clientId: string) => boolean)
  }

  /**
   * TTL configuration for access and refresh tokens (in seconds)
   */
  ttl?: {
    access?: number
    refresh?: number
    reuse?: number
    retention?: number
  }

  /**
   * Callback invoked when authentication succeeds.
   * Receives the auth result enriched with tenant context and RBAC claims.
   *
   * @param ctx - Enhanced context with subject() method
   * @param value - Auth result with provider data + RBAC enrichment
   * @param tenant - The resolved tenant
   * @returns Response to complete the auth flow
   */
  onSuccess?: (
    ctx: EnterpriseSuccessContext<SubjectPayload<Subjects>>,
    value: EnterpriseAuthResult,
    tenant: Tenant,
  ) => Promise<Response>

  /**
   * Called on every refresh grant, before the claims are recomputed. Return
   * `{ revoke: true }` when the user may no longer refresh (deleted,
   * suspended): the client gets `invalid_grant` and the token family is
   * revoked. Throwing answers a retryable `503 temporarily_unavailable`.
   *
   * After it, when `rbacService` is configured, the token's `roles` and
   * `permissions` are recomputed from RBAC for the token's own tenant
   * (`properties.tenantId`), exactly as at sign-in (RBAC's merged with any
   * `roles`/`permissions` this returns). The refreshed access
   * token, the rotated refresh token and (when the session service supports
   * it) the user's account sessions carry the current roles.
   */
  onRefresh?: (
    input: {
      type: string
      properties: Record<string, unknown>
      subject: string
      clientID: string
      /** The tenant the token was issued in. */
      tenantId: string
      /** The user id read from the properties (`id`, `userId` or `userID`). */
      userId?: string
    },
    req: Request,
  ) => Promise<
    | void
    | { revoke: true; reason?: string }
    /**
     * Roles/permissions from the app's own sources (as its onSuccess adds
     * them): merged with RBAC's, as at sign-in. Without this, roles that
     * are not in RBAC are not carried over by a refresh.
     */
    | { revoke?: false; roles?: string[]; permissions?: string[] }
  >

  /**
   * Callback to determine if a client is allowed to authorize.
   * Called after tenant resolution, so tenant context is available.
   *
   * @param input - Client authorization parameters
   * @param req - The original request
   * @param tenant - The resolved tenant
   * @returns true if allowed, false otherwise
   */
  onAllow?: (
    input: {
      clientID: string
      redirectURI: string
      audience?: string
    },
    req: Request,
    tenant: Tenant,
  ) => Promise<boolean>

  /**
   * Tenant resolver configuration
   */
  tenantResolver?: TenantResolverOptions

  /**
   * CORS configuration
   */
  cors?: CorsOptions

  /**
   * Custom provider selection UI.
   *
   * When multiple providers are configured and no provider is specified
   * in the authorization request, this function is called to render a
   * provider selection UI.
   *
   * @param providers - Map of provider names to their types
   * @param req - The original request
   * @returns Response with provider selection UI
   */
  select?(providers: Record<string, string>, req: Request): Promise<Response>

  /**
   * Audit configuration for token usage logging.
   *
   * Provides async, non-blocking audit logging for compliance and
   * security monitoring. Tracks token generation, refresh, revocation,
   * and suspicious activity like token reuse.
   *
   * @example
   * ```typescript
   * import { AuditService } from "@openauthjs/openauth/services/audit"
   *
   * createMultiTenantIssuer({
   *   audit: {
   *     service: new AuditService({ database: env.AUTH_DB }),
   *     hooks: {
   *       onTokenGenerated: true,
   *       onTokenRefreshed: true,
   *       onTokenRevoked: true,
   *       onTokenReused: true, // Security: detect token theft
   *     }
   *   },
   *   // ... other config
   * })
   * ```
   */
  audit?: {
    /**
     * The audit service instance for logging
     */
    service: AuditService
    /**
     * Which token events to log
     */
    hooks?: {
      /** Log when new tokens are generated */
      onTokenGenerated?: boolean
      /** Log when tokens are refreshed */
      onTokenRefreshed?: boolean
      /** Log when tokens are revoked */
      onTokenRevoked?: boolean
      /** Log when token reuse is detected (security incident) */
      onTokenReused?: boolean
    }
  }

  /**
   * Custom error handler for unknown state errors.
   *
   * Called when the authorization state cannot be found or validated.
   * This typically happens when cookies expire or are cleared.
   *
   * @param error - The UnknownStateError that occurred
   * @param req - The original request
   * @returns Custom error response
   *
   * @example
   * ```typescript
   * createMultiTenantIssuer({
   *   error: async (err, req) => {
   *     // Log the error
   *     console.error('Auth state error:', err)
   *
   *     // Return custom error page
   *     return new Response('Session expired. Please try again.', {
   *       status: 400,
   *       headers: { 'Content-Type': 'text/plain' }
   *     })
   *   },
   *   // ... other config
   * })
   * ```
   */
  error?(
    error: UnknownStateError,
    req: Request,
    render?: RenderOptions,
  ): Promise<Response>

  /**
   * Where the friendly "Start sign-in again" page links when the flow's
   * client is unknown. See `IssuerInput.restart`.
   */
  restart?: {
    fallbackUrl?: string
  }

  /**
   * Called with every unexpected error the issuer answers with a 500 (not an
   * OauthError or an unknown sign-in state): report it (with its stack) and
   * return the reference it was reported under. A browser then gets the
   * localized "Something went wrong / Try again" page showing that reference;
   * other callers get `{ error: "server_error", reference }`. Must not throw;
   * a throw is ignored.
   */
  onServerError?: (
    error: unknown,
    request: Request,
  ) => string | undefined | Promise<string | undefined>

  /**
   * Single sign-on across clients: when the browser already has an active
   * signed-in account, `/authorize` without `prompt` completes silently
   * (no sign-in form). `prompt=login` and `max_age` still force a sign-in.
   * @default true
   */
  singleSignOn?: boolean

  /**
   * Check `/authorize` against the client registry (`clientDb`): the client
   * must exist in the tenant, be enabled, allow `authorization_code`, and have
   * registered the exact `redirect_uri` (full string, query included, as
   * OAuth 2.1 requires; register each variant such as `?locale=en`).
   *
   * - `"enforce"`: reject with a clear en/ar error page (HTTP 400). The user
   *   is never redirected to an unverified redirect_uri.
   * - `"report"`: log the problem and continue (for rolling out).
   *
   * Requires `clientDb`. Unset: no registry check (domain allow check only).
   */
  clientRegistry?: {
    mode: "enforce" | "report"
    /** Where the error page's button goes. Defaults to `restart.fallbackUrl`. */
    homeUrl?: string
  }
}

/**
 * Tenant resolver options for enterprise issuer
 */
export interface TenantResolverOptions {
  /**
   * Base domain for subdomain-based tenant resolution
   * (e.g., "auth.example.com" - tenant123.auth.example.com -> tenant123)
   */
  baseDomain?: string

  /**
   * Path prefix for path-based tenant resolution
   * (e.g., "/tenants" - /tenants/tenant123/authorize -> tenant123)
   */
  pathPrefix?: string

  /**
   * Header name for header-based tenant resolution
   * @default "X-Tenant-ID"
   */
  headerName?: string

  /**
   * Query parameter name for query-based tenant resolution
   * @default "tenant"
   */
  queryParam?: string

  /**
   * Custom domain to tenant ID mapping
   */
  customDomains?: Map<string, string>
}

/**
 * CORS configuration options
 */
export interface CorsOptions {
  origins: string[]
  credentials?: boolean
  methods?: string[]
  headers?: string[]
  maxAge?: number
}

// ============================================
// SUCCESS CONTEXT
// ============================================

/**
 * Enhanced context passed to the onSuccess callback.
 * Extends the standard subject() method with enterprise features.
 */
export interface EnterpriseSuccessContext<
  T extends { type: string; properties: any },
> {
  /**
   * Set the subject payload for the JWT token.
   *
   * @param type - The subject type defined in subjects schema
   * @param properties - The subject properties
   * @param opts - Optional TTL and subject ID overrides
   */
  subject<Type extends T["type"]>(
    type: Type,
    properties: Extract<T, { type: Type }>["properties"],
    opts?: {
      ttl?: {
        access?: number
        refresh?: number
      }
      subject?: string
    },
  ): Promise<Response>
}

/**
 * Authentication result enriched with enterprise features.
 * Passed to the onSuccess callback.
 */
export interface EnterpriseAuthResult {
  /**
   * The provider that was used for authentication
   */
  provider: string

  /**
   * User ID from the provider
   */
  userID?: string

  /**
   * Subject type
   */
  type?: string

  /**
   * Subject properties from the provider
   */
  properties?: Record<string, unknown>

  /**
   * Refresh token if applicable
   */
  refresh?: string

  /**
   * Tenant ID from context
   */
  tenantId: string

  /**
   * Roles from RBAC (if rbacService is configured)
   */
  roles: string[]

  /**
   * Permissions from RBAC (if rbacService is configured)
   */
  permissions: string[]

  /**
   * Additional provider-specific data
   */
  [key: string]: unknown
}

// ============================================
// SESSION INTEGRATION TYPES
// ============================================

/**
 * Parameters for adding an account to a session
 */
export interface AddAccountParams {
  /**
   * The browser session (from middleware)
   */
  browserSession: BrowserSession

  /**
   * User ID to add
   */
  userId: string

  /**
   * Subject type (e.g., "user")
   */
  subjectType: string

  /**
   * Subject properties to store
   */
  subjectProperties: Record<string, unknown>

  /**
   * Refresh token for the account
   */
  refreshToken: string

  /**
   * Client ID that initiated the auth
   */
  clientId: string

  /**
   * TTL in seconds for the account session
   */
  ttl: number
}

/**
 * Result of handling the OIDC prompt parameter
 */
export interface PromptHandlerResult {
  /**
   * Whether to proceed with the auth flow
   */
  proceed: boolean

  /**
   * If proceed is false, the response to return
   */
  response?: Response

  /**
   * If proceed is true, the selected account (for select_account)
   */
  selectedAccount?: AccountSession

  /**
   * Force re-authentication (for prompt=login)
   */
  forceReauth?: boolean

  /**
   * Silent auth - issue code directly for this account (for prompt=none)
   */
  silentAuth?: AccountSession
}

/**
 * OIDC error response for silent auth failures
 */
export interface OIDCErrorResponse {
  error: string
  error_description: string
  state?: string
}

// ============================================
// CONTEXT TYPES
// ============================================

/**
 * Context variables set by enterprise middleware
 */
export interface EnterpriseRequestContext {
  tenant: Tenant
  browserSession: BrowserSession | null
  authorization: EnterpriseAuthorizationState | null
}

export interface EnterpriseContextVariables {
  /** Tenant, session and authorization of this request, for the success callback. */
  enterpriseRequestContext?: EnterpriseRequestContext
  /**
   * Resolved tenant
   */
  tenant: Tenant

  /**
   * Tenant-scoped storage
   */
  tenantStorage: StorageAdapter

  /**
   * Browser session (may be null if no session)
   */
  browserSession: BrowserSession | null

  /**
   * Active account in the session (may be null)
   */
  activeAccount: AccountSession | null

  /**
   * Client ID from the authorization request
   */
  clientId?: string

  /**
   * Authorization state
   */
  authorization?: EnterpriseAuthorizationState

  /**
   * Resolved theme for the current request.
   *
   * Available after theme resolution middleware runs.
   * Set using the following priority chain:
   * 1. tenant.branding.theme (per-tenant customization)
   * 2. config.theme (from createMultiTenantIssuer)
   * 3. THEME_OPENAUTH (hardcoded fallback)
   *
   * Can be accessed programmatically via `ctx.get("resolvedTheme")`.
   */
  resolvedTheme?: Theme
}

/**
 * Extended authorization state with OIDC parameters
 */
export interface EnterpriseAuthorizationState {
  redirect_uri: string
  response_type: string
  state: string
  client_id: string
  audience?: string
  pkce?: {
    challenge: string
    method: "S256"
  }
  /**
   * OIDC prompt parameter
   */
  prompt?: PromptType
  /**
   * Login hint (email or user ID)
   */
  login_hint?: string
  /**
   * Account hint (user ID to select)
   */
  account_hint?: string
  /**
   * Maximum authentication age in seconds
   */
  max_age?: number
  /**
   * Requested ACR values
   */
  acr_values?: string
  /**
   * Scope
   */
  scope?: string
  /**
   * Nonce for ID token
   */
  nonce?: string
}

// ============================================
// ACCOUNT PICKER TYPES
// ============================================

/**
 * Account picker display data
 */
export interface AccountPickerAccount {
  userId: string
  displayName?: string
  email?: string
  avatarUrl?: string
  subjectType: string
  isActive: boolean
  authenticatedAt: number
}

/**
 * Account picker response
 */
export interface AccountPickerResponse {
  accounts: AccountPickerAccount[]
  addAccountUrl: string
  cancelUrl: string
}

// ============================================
// ISSUER FACTORY RESULT
// ============================================

/**
 * Result of createMultiTenantIssuer
 */
export interface MultiTenantIssuer {
  /**
   * The Hono app instance
   */
  app: any // Hono type

  /**
   * Helper to get issuer URL for a tenant
   */
  getIssuerUrl: (tenant: Tenant, req: Request) => string

  /**
   * Helper to manually trigger session sync
   */
  syncSession: (ctx: Context, browserSession: BrowserSession) => Promise<void>
}
