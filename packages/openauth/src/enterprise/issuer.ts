/**
 * Multi-Tenant Enterprise Issuer
 *
 * Creates an OpenAuth server with integrated multi-tenant support, session
 * management, and RBAC. This enterprise issuer wraps the standard issuer
 * to inherit all core OAuth functionality while adding enterprise features:
 *
 * - Multi-tenant isolation with tenant-scoped storage
 * - White-label branding per tenant
 * - Multi-account browser sessions
 * - Role-based access control with token enrichment
 * - OIDC prompt parameter support
 *
 * **Architecture:**
 * The enterprise issuer uses composition rather than reimplementation:
 * 1. Enterprise middleware (tenant, session, theme) runs first
 * 2. Enterprise routes (/session/*, /admin/*, /rbac/*, /tenants/*) are mounted
 * 3. The standard issuer handles core OAuth (/authorize, /token, /.well-known/*)
 * 4. Success callback is intercepted to add RBAC and session management
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * import { createMultiTenantIssuer } from "@openauthjs/openauth/enterprise"
 * import { TenantServiceImpl } from "@openauthjs/openauth/tenant"
 * import { SessionServiceImpl, hexToSecret } from "@openauthjs/openauth/session"
 * import { RBACServiceImpl, RBACAdapter } from "@openauthjs/openauth/rbac"
 *
 * const { app } = createMultiTenantIssuer({
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
 *     const userId = await findOrCreateUser(value, tenant.id)
 *     return ctx.subject("user", {
 *       userId,
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

import { Hono } from "hono/tiny"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import type { Context, MiddlewareHandler, Next } from "hono"

import type {
  SessionService,
  TenantService,
  RBACService,
  Tenant,
  BrowserSession,
  AccountSession,
  RBACClaims,
  PromptType,
} from "../contracts/types.js"
import { DEFAULT_SESSION_CONFIG } from "../contracts/types.js"
import type { Provider } from "../provider/provider.js"
import type { SubjectPayload, SubjectSchema } from "../subject.js"
import { Storage, type StorageAdapter } from "../storage/storage.js"

import {
  createTenantResolver,
  getTenant,
  getTenantStorage,
  type TenantResolverOptions as BaseTenantResolverOptions,
} from "../tenant/resolver.js"
import { createTenantThemeMiddleware } from "../tenant/theme.js"
import { tenantApiRoutes } from "../tenant/api.js"
import { TenantStorageImpl } from "../tenant/storage.js"

import {
  createSessionMiddleware,
  createSessionCookieHeader,
} from "../session/middleware.js"
import { sessionRoutes, adminSessionRoutes } from "../session/routes.js"

import { rbacEndpoints } from "../rbac/endpoints.js"
import { rbacAdminEndpoints } from "../rbac/admin-endpoints.js"

import type {
  EnterpriseIssuerConfig,
  EnterpriseContextVariables,
  EnterpriseAuthorizationState,
  EnterpriseAuthResult,
  EnterpriseSuccessContext,
  MultiTenantIssuer,
  AccountPickerAccount,
} from "./types.js"

import {
  addAccountToSession,
  handlePromptParameter,
  handleMaxAge,
  handleAccountHint,
  handleLoginHint,
  validateSessionForSilentAuth,
  generateAddAccountUrl,
} from "./session-integration.js"

import {
  issuer as createBaseIssuer,
  type OnSuccessResponder,
} from "../issuer.js"
import { getRelativeUrl, isDomainMatch } from "../util.js"
import {
  OauthError,
  UnauthorizedClientError,
  UnknownStateError,
} from "../error.js"
import { setTheme, THEME_OPENAUTH } from "../ui/theme.js"
import type { Theme } from "../ui/theme.js"

// ============================================
// THEME RESOLUTION MIDDLEWARE
// ============================================

/**
 * Options for the enterprise theme middleware
 */
interface EnterpriseThemeMiddlewareOptions {
  tenantService: TenantService
  configTheme?: Theme
}

/**
 * Theme Resolution Middleware
 *
 * Resolves theme using priority chain and sets to globalThis for SSR.
 *
 * Priority Chain:
 * 1. tenant.branding.theme (resolved tenant's theme)
 * 2. config.theme (from createMultiTenantIssuer config)
 * 3. Default tenant from DB (prepared for future)
 * 4. THEME_OPENAUTH (hardcoded fallback)
 */
function createEnterpriseThemeMiddleware(
  options: EnterpriseThemeMiddlewareOptions,
): MiddlewareHandler {
  let defaultTenantCache: { tenant: Tenant | null; timestamp: number } | null =
    null
  const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

  return async function enterpriseThemeMiddleware(
    ctx: Context,
    next: Next,
  ): Promise<Response | void> {
    const tenant = getTenant(ctx)
    let resolvedTheme: Theme | null = null

    // Priority 1: Tenant's theme from branding
    if (tenant?.branding?.theme) {
      resolvedTheme = convertTenantThemeToUITheme(tenant.branding.theme)
    }

    // Priority 2: Config theme from createMultiTenantIssuer
    if (!resolvedTheme && options.configTheme) {
      resolvedTheme = options.configTheme
    }

    // Priority 3: Default tenant theme (prepared for future)
    if (!resolvedTheme) {
      const now = Date.now()
      if (
        defaultTenantCache &&
        now - defaultTenantCache.timestamp < CACHE_TTL
      ) {
        if (defaultTenantCache.tenant?.branding?.theme) {
          resolvedTheme = convertTenantThemeToUITheme(
            defaultTenantCache.tenant.branding.theme,
          )
        }
      } else {
        defaultTenantCache = { tenant: null, timestamp: now }
      }
    }

    // Priority 4: THEME_OPENAUTH fallback
    if (!resolvedTheme) {
      resolvedTheme = THEME_OPENAUTH
    }

    // Set theme to globalThis for SSR components
    setTheme(resolvedTheme)

    // Store in context for programmatic access
    ctx.set("resolvedTheme", resolvedTheme)

    await next()
  }
}

/**
 * Convert tenant branding theme to UI Theme type
 */
function convertTenantThemeToUITheme(tenantTheme: Record<string, any>): Theme {
  if (tenantTheme.primary !== undefined) {
    return tenantTheme as Theme
  }

  return {
    primary: tenantTheme.primary || tenantTheme.primaryColor || "#007bff",
    background: tenantTheme.background || tenantTheme.backgroundColor,
    title: tenantTheme.title,
    favicon: tenantTheme.favicon,
    logo: tenantTheme.logo || tenantTheme.logoLight,
    font: tenantTheme.font || {
      family: tenantTheme.fontFamily,
    },
    css: tenantTheme.css || tenantTheme.customCss,
    radius: tenantTheme.radius,
  }
}

// ============================================
// MAIN FACTORY FUNCTION
// ============================================

/**
 * Create a multi-tenant enterprise issuer.
 *
 * This factory function creates a Hono application that wraps the standard
 * OpenAuth issuer with enterprise features:
 *
 * 1. Tenant Resolution - Resolve tenant from request
 * 2. Theme Middleware - Apply tenant-specific branding
 * 3. Session Middleware - Load multi-account browser sessions
 * 4. Enterprise Routes - Session management, RBAC, tenant APIs
 * 5. Base Issuer - Standard OAuth flow (inherits all functionality)
 *
 * @param config - Enterprise issuer configuration
 * @returns The multi-tenant issuer with Hono app and helpers
 */
export function createMultiTenantIssuer<
  Providers extends Record<string, Provider<any>>,
  Subjects extends SubjectSchema,
>(config: EnterpriseIssuerConfig<Providers, Subjects>): MultiTenantIssuer {
  // Validate required config
  if (!config.tenantService) {
    throw new Error("tenantService is required")
  }
  if (!config.sessionService) {
    throw new Error("sessionService is required")
  }
  if (!config.storage) {
    throw new Error("storage is required")
  }
  if (!config.sessionSecret || config.sessionSecret.length !== 32) {
    throw new Error("sessionSecret must be a 256-bit (32 byte) Uint8Array")
  }
  if (!config.providers || Object.keys(config.providers).length === 0) {
    throw new Error("At least one provider is required")
  }
  if (!config.subjects) {
    throw new Error("subjects schema is required")
  }

  // Session config with defaults
  const sessionConfig = {
    ...DEFAULT_SESSION_CONFIG,
    ...config.sessionConfig,
  }

  // ============================================
  // CONTEXT FOR PASSING DATA TO SUCCESS CALLBACK
  // ============================================
  // We use a WeakMap to associate request objects with their enterprise context
  // This avoids polluting the global scope while enabling the success callback
  // to access tenant and session information.
  const requestContextMap = new WeakMap<
    Request,
    {
      tenant: Tenant
      browserSession: BrowserSession | null
      authorization: EnterpriseAuthorizationState | null
    }
  >()

  // ============================================
  // CREATE BASE ISSUER WITH WRAPPED SUCCESS
  // ============================================

  const baseIssuer = createBaseIssuer({
    subjects: config.subjects,
    storage: config.storage,
    providers: config.providers,
    theme: config.theme,
    ttl: config.ttl,
    clientDb: config.clientDb,
    audit: config.audit,
    error: config.error,

    // Allow check delegates to enterprise onAllow with tenant context
    allow: async (input, req) => {
      const ctx = requestContextMap.get(req)
      if (!ctx?.tenant) {
        // Fallback to default allow check if no tenant context
        return defaultAllowCheck(input, req)
      }

      if (config.onAllow) {
        return config.onAllow(input, req, ctx.tenant)
      }
      return defaultAllowCheck(input, req)
    },

    // Success callback intercepts to add enterprise features
    success: async (responder, value, req) => {
      const ctx = requestContextMap.get(req)
      if (!ctx?.tenant) {
        // No enterprise context - delegate directly to base
        throw new Error("Enterprise context not found for request")
      }

      const tenant = ctx.tenant
      let browserSession = ctx.browserSession
      const authorization = ctx.authorization

      // Track if we need to set a session cookie
      let sessionCookieHeader: string | null = null

      // Create browser session if one doesn't exist
      if (!browserSession) {
        browserSession = await config.sessionService.createBrowserSession({
          tenantId: tenant.id,
          userAgent: req.headers.get("User-Agent") || "unknown",
          ipAddress:
            req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
            "unknown",
        })
        // Generate the cookie header to add to the response
        sessionCookieHeader = await createSessionCookieHeader(
          browserSession,
          config.sessionSecret,
          sessionConfig.cookieName,
        )
      }

      // Get or create browser session reference
      let session = browserSession

      // Enrich with RBAC claims if service available
      let rbacClaims: RBACClaims = { roles: [], permissions: [] }
      if (config.rbacService && (value as any).userID) {
        rbacClaims = await config.rbacService.enrichTokenClaims({
          userId: (value as any).userID,
          clientId: authorization?.client_id || "default",
          tenantId: tenant.id,
        })
      }

      // Build enterprise auth result
      const enterpriseResult: EnterpriseAuthResult = {
        ...(value as Record<string, unknown>),
        provider: value.provider as string,
        tenantId: tenant.id,
        roles: rbacClaims.roles,
        permissions: rbacClaims.permissions,
      }

      // Create enhanced success context that wraps the base responder
      const enterpriseCtx: EnterpriseSuccessContext<SubjectPayload<Subjects>> =
        {
          async subject(type, properties, opts) {
            // Enrich properties with enterprise data
            const baseProperties =
              typeof properties === "object" && properties !== null
                ? properties
                : {}

            // Merge roles from both sources:
            // - baseProperties.roles: from app's onSuccess (e.g., database lookup)
            // - rbacClaims.roles: from RBAC service (if userID was available)
            // This ensures app-provided roles aren't overwritten by empty RBAC claims
            const baseRoles = Array.isArray((baseProperties as any).roles)
              ? (baseProperties as any).roles
              : []
            const basePermissions = Array.isArray(
              (baseProperties as any).permissions,
            )
              ? (baseProperties as any).permissions
              : []

            // Combine and deduplicate
            const mergedRoles = [
              ...new Set([...baseRoles, ...rbacClaims.roles]),
            ]
            const mergedPermissions = [
              ...new Set([...basePermissions, ...rbacClaims.permissions]),
            ]

            const enrichedProperties = {
              ...baseProperties,
              tenantId: tenant.id,
              roles: mergedRoles,
              permissions: mergedPermissions,
            }

            // Add account to session after successful auth
            // Extract userId from properties (different providers may use different keys)
            const userId =
              (baseProperties as any).userId ||
              (baseProperties as any).userID ||
              (baseProperties as any).id ||
              (baseProperties as any).sub
            if (session && userId) {
              try {
                // Generate a session-specific refresh token
                // This is separate from the OAuth refresh token managed by base issuer
                const sessionRefreshToken = crypto.randomUUID()

                await config.sessionService.addAccountToSession({
                  browserSessionId: session.id,
                  userId: String(userId),
                  subjectType: type as string,
                  subjectProperties: enrichedProperties,
                  refreshToken: sessionRefreshToken,
                  clientId: authorization?.client_id || "default",
                  ttl: sessionConfig.sessionLifetimeSeconds,
                })
              } catch (err) {
                // Log but don't fail the auth flow
                console.error("Failed to add account to session:", err)
              }
            }

            // Delegate to base responder for actual token generation
            const response = await responder.subject(
              type as any,
              enrichedProperties as any,
              opts,
            )

            // Add session cookie if we created a new session
            if (sessionCookieHeader) {
              const headers = new Headers(response.headers)
              headers.append("Set-Cookie", sessionCookieHeader)
              return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers,
              })
            }

            return response
          },
        }

      // Call user's success callback or default
      if (config.onSuccess) {
        const response = await config.onSuccess(
          enterpriseCtx,
          enterpriseResult,
          tenant,
        )
        // Add session cookie if we created a new session
        if (sessionCookieHeader) {
          const headers = new Headers(response.headers)
          headers.append("Set-Cookie", sessionCookieHeader)
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          })
        }
        return response
      }

      // Default: use base subject method with enriched properties
      const defaultType = (value as any).type || "user"
      const defaultProperties = (value as any).properties || value

      const response = await enterpriseCtx.subject(defaultType, {
        ...defaultProperties,
        tenantId: tenant.id,
        roles: rbacClaims.roles,
        permissions: rbacClaims.permissions,
      })

      // Add session cookie if we created a new session
      if (sessionCookieHeader) {
        const headers = new Headers(response.headers)
        headers.append("Set-Cookie", sessionCookieHeader)
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        })
      }

      return response
    },

    // Provider selection UI (inherits from base)
    select: config.select,
  })

  // ============================================
  // CREATE ENTERPRISE APP (WRAPS BASE ISSUER)
  // ============================================

  const app = new Hono<{
    Variables: EnterpriseContextVariables
  }>()

  // Add logging
  app.use(logger())

  // ============================================
  // 1. APPLY GLOBAL CORS (if configured)
  // ============================================

  if (config.cors) {
    app.use(
      "*",
      cors({
        origin: config.cors.origins,
        credentials: config.cors.credentials ?? true,
        allowMethods: config.cors.methods ?? [
          "GET",
          "POST",
          "PUT",
          "DELETE",
          "OPTIONS",
        ],
        allowHeaders: config.cors.headers ?? ["Content-Type", "Authorization"],
        maxAge: config.cors.maxAge,
      }),
    )
  }

  // ============================================
  // 2. TENANT RESOLVER MIDDLEWARE
  // ============================================

  const tenantResolverConfig: BaseTenantResolverOptions = {
    service: config.tenantService,
    storage: config.storage,
    config: config.tenantResolver
      ? {
          baseDomain: config.tenantResolver.baseDomain,
          pathPrefix: config.tenantResolver.pathPrefix,
          headerName: config.tenantResolver.headerName,
          queryParam: config.tenantResolver.queryParam,
          customDomains: config.tenantResolver.customDomains,
        }
      : undefined,
    optional: false,
  }

  app.use("*", createTenantResolver(tenantResolverConfig))

  // ============================================
  // 3. THEME RESOLUTION MIDDLEWARE
  // ============================================

  app.use(
    "*",
    createEnterpriseThemeMiddleware({
      tenantService: config.tenantService,
      configTheme: config.theme,
    }),
  )

  // Also apply header-based theme middleware for API consumers
  app.use("*", createTenantThemeMiddleware())

  // ============================================
  // 4. SESSION MIDDLEWARE
  // ============================================

  app.use(
    "*",
    createSessionMiddleware(config.sessionService, config.sessionSecret, {
      cookieName: sessionConfig.cookieName,
      autoRefresh: true,
    }),
  )

  // ============================================
  // 5. CONTEXT BRIDGE MIDDLEWARE
  // ============================================
  // Store enterprise context in WeakMap so success callback can access it

  app.use("*", async (ctx, next) => {
    const tenant = getTenant(ctx)
    const browserSession = ctx.get("browserSession") as BrowserSession | null
    const authorization = ctx.get("authorization") as
      | EnterpriseAuthorizationState
      | undefined

    if (tenant) {
      requestContextMap.set(ctx.req.raw, {
        tenant,
        browserSession,
        authorization: authorization || null,
      })
    }

    await next()
  })

  // ============================================
  // 6. ENTERPRISE ROUTES
  // ============================================

  // User-facing session routes: /session/*
  app.route("/session", sessionRoutes(config.sessionService))

  // Admin session routes: /admin/sessions/*
  app.route("/admin/sessions", adminSessionRoutes(config.sessionService))

  // RBAC routes (if configured)
  if (config.rbacService) {
    app.route("/rbac", rbacEndpoints(config.rbacService))
    app.route("/rbac/admin", rbacAdminEndpoints(config.rbacService))
  }

  // Tenant CRUD API: /tenants/*
  app.route("/tenants", tenantApiRoutes(config.tenantService))

  // ============================================
  // 7. ENHANCED /authorize
  // ============================================
  // Override the base /authorize to add OIDC prompt parameter handling
  // before delegating to the base issuer

  app.get("/authorize", async (c) => {
    const tenant = getTenant(c)
    if (!tenant) {
      return c.json(
        { error: "tenant_not_found", error_description: "Tenant not resolved" },
        404,
      )
    }

    // Extract OIDC parameters
    const prompt = c.req.query("prompt") as PromptType | undefined
    const login_hint = c.req.query("login_hint")
    const account_hint = c.req.query("account_hint")
    const max_age = c.req.query("max_age")

    // Get session info
    const browserSession = c.get("browserSession") as BrowserSession | null
    const activeAccount = c.get("activeAccount") as AccountSession | null

    // Debug: Log prompt=none handling
    console.log("[authorize] OIDC params:", {
      prompt,
      hasBrowserSession: !!browserSession,
      browserSessionId: browserSession?.id,
      activeUserId: browserSession?.active_user_id,
      hasActiveAccount: !!activeAccount,
      activeAccountUserId: activeAccount?.user_id,
      activeAccountExpiresAt: activeAccount?.expires_at,
      now: Date.now(),
      cookieHeader: c.req.header("Cookie")?.substring(0, 50) + "...",
    })

    // Build enterprise authorization state for context
    const authorization: EnterpriseAuthorizationState = {
      redirect_uri: c.req.query("redirect_uri") || "",
      response_type: c.req.query("response_type") || "",
      state: c.req.query("state") || "",
      client_id: c.req.query("client_id") || "",
      audience: c.req.query("audience"),
      pkce:
        c.req.query("code_challenge") && c.req.query("code_challenge_method")
          ? {
              challenge: c.req.query("code_challenge")!,
              method: c.req.query("code_challenge_method") as "S256",
            }
          : undefined,
      prompt,
      login_hint,
      account_hint,
      max_age: max_age ? parseInt(max_age, 10) : undefined,
      scope: c.req.query("scope"),
      nonce: c.req.query("nonce"),
    }

    c.set("authorization", authorization)

    // Update context map with authorization
    requestContextMap.set(c.req.raw, {
      tenant,
      browserSession,
      authorization,
    })

    // Track the effective active account (may be updated by account_hint or login_hint)
    let effectiveActiveAccount = activeAccount

    // Handle account_hint if provided
    if (authorization.account_hint && browserSession) {
      const accountHintResult = await handleAccountHint(
        c,
        authorization.account_hint,
        config.sessionService,
        browserSession,
      )
      // Use the selected account if account_hint matched
      if (accountHintResult.selectedAccount) {
        effectiveActiveAccount = accountHintResult.selectedAccount
      }
    }

    // Handle login_hint if provided
    if (authorization.login_hint && browserSession) {
      const loginHintAccount = await handleLoginHint(
        c,
        authorization.login_hint,
        config.sessionService,
        browserSession,
      )
      // Use the matched account if login_hint found one
      if (loginHintAccount) {
        effectiveActiveAccount = loginHintAccount
      }
    }

    // Handle prompt parameter (OIDC specific)
    const promptResult = await handlePromptParameter(
      c,
      authorization.prompt,
      config.sessionService,
      browserSession,
      authorization,
      effectiveActiveAccount,
    )

    // Debug: Log prompt result
    console.log("[authorize] promptResult:", {
      proceed: promptResult.proceed,
      hasSilentAuth: !!promptResult.silentAuth,
      silentAuthUserId: promptResult.silentAuth?.user_id,
      forceReauth: promptResult.forceReauth,
      hasResponse: !!promptResult.response,
    })

    if (!promptResult.proceed) {
      if (promptResult.response) {
        return promptResult.response
      }

      // Check if we should show account picker
      if (c.get("showAccountPicker")) {
        const accounts = c.get("accountPickerAccounts") || []
        return renderAccountPicker(c, accounts, authorization, tenant)
      }
    }

    // Handle max_age parameter
    if (authorization.max_age !== undefined && activeAccount) {
      const maxAgeResult = handleMaxAge(c, authorization.max_age, activeAccount)
      if (maxAgeResult.forceReauth) {
        promptResult.forceReauth = true
      }
    }

    // Handle silent auth (prompt=none with authenticated user)
    // Issue authorization code directly without going through provider flow
    if (promptResult.silentAuth && !promptResult.forceReauth) {
      const account = promptResult.silentAuth
      const code = crypto.randomUUID()

      // Store authorization code (same as base issuer)
      await Storage.set(
        config.storage,
        ["oauth:code", code],
        {
          type: account.subject_type,
          properties: account.subject_properties,
          subject: account.user_id,
          redirectURI: authorization.redirect_uri,
          clientID: authorization.client_id,
          pkce: authorization.pkce,
          ttl: {
            access: config.ttl?.access ?? 60 * 60 * 24 * 30 * 1000, // 30 days
            refresh: config.ttl?.refresh ?? 60 * 60 * 24 * 365 * 1000, // 1 year
          },
        },
        60 * 10 * 1000, // 10 min TTL for code
      )

      // Redirect back with code
      const location = new URL(authorization.redirect_uri)
      location.searchParams.set("code", code)
      location.searchParams.set("state", authorization.state || "")
      return c.redirect(location.toString(), 302)
    }

    // Delegate to base issuer for actual authorization
    // Create a new request that will be handled by the base issuer
    const baseResponse = await baseIssuer.request(c.req.raw)
    return baseResponse
  })

  // ============================================
  // 7B. ACCOUNT PICKER REMOVE
  // ============================================
  // Remove an account from the session and return to the account picker

  app.post("/account-picker/remove", async (c) => {
    const tenant = getTenant(c)
    if (!tenant) {
      return c.json({ error: "Tenant not found" }, 400)
    }

    // Parse form data with proper type validation
    const formData = await c.req.parseBody()
    const userId =
      typeof formData.user_id === "string" ? formData.user_id : undefined
    const clientId =
      typeof formData.client_id === "string" ? formData.client_id : undefined
    const redirectUri =
      typeof formData.redirect_uri === "string"
        ? formData.redirect_uri
        : undefined
    const responseType =
      typeof formData.response_type === "string"
        ? formData.response_type
        : undefined
    const state =
      typeof formData.state === "string" ? formData.state : undefined
    const scope =
      typeof formData.scope === "string" ? formData.scope : undefined
    const nonce =
      typeof formData.nonce === "string" ? formData.nonce : undefined

    // Validate required OAuth parameters
    if (!userId) {
      return c.json({ error: "Missing user_id" }, 400)
    }
    if (!clientId) {
      return c.json({ error: "Missing or invalid client_id" }, 400)
    }
    if (!redirectUri) {
      return c.json({ error: "Missing or invalid redirect_uri" }, 400)
    }
    if (!responseType) {
      return c.json({ error: "Missing or invalid response_type" }, 400)
    }

    // Get browser session from cookie
    const browserSession = c.get("browserSession")
    if (browserSession) {
      // Remove the account from the session
      await config.sessionService.removeAccount(browserSession.id, userId)

      // If this was the active account, we need to switch to another or clear
      if (browserSession.active_user_id === userId) {
        const remainingAccounts = await config.sessionService.listAccounts(
          browserSession.id,
        )
        if (remainingAccounts.length > 0) {
          await config.sessionService.switchActiveAccount(
            browserSession.id,
            remainingAccounts[0].user_id,
          )
        }
      }
    }

    // Redirect back to authorize with select_account prompt
    const authorizeUrl = new URL("/authorize", new URL(c.req.url).origin)
    authorizeUrl.searchParams.set("client_id", clientId)
    authorizeUrl.searchParams.set("redirect_uri", redirectUri)
    authorizeUrl.searchParams.set("response_type", responseType)
    if (state) authorizeUrl.searchParams.set("state", state)
    if (scope) authorizeUrl.searchParams.set("scope", scope)
    if (nonce) authorizeUrl.searchParams.set("nonce", nonce)
    authorizeUrl.searchParams.set("prompt", "select_account")

    return c.redirect(authorizeUrl.toString(), 302)
  })

  // ============================================
  // 8. WELL-KNOWN ENDPOINTS
  // ============================================
  // Override to include enterprise-specific claims

  app.get(
    "/.well-known/openid-configuration",
    cors({
      origin: "*",
      allowHeaders: ["*"],
      allowMethods: ["GET"],
      credentials: false,
    }),
    async (c) => {
      const tenant = getTenant(c)
      const iss = getIssuerUrl(tenant!, c.req.raw)

      return c.json({
        issuer: iss,
        authorization_endpoint: `${iss}/authorize`,
        token_endpoint: `${iss}/token`,
        userinfo_endpoint: `${iss}/userinfo`,
        jwks_uri: `${iss}/.well-known/jwks.json`,
        registration_endpoint: `${iss}/register`,
        scopes_supported: ["openid", "profile", "email", "offline_access"],
        response_types_supported: ["code", "token", "id_token", "code token"],
        response_modes_supported: ["query", "fragment"],
        grant_types_supported: [
          "authorization_code",
          "refresh_token",
          "implicit",
          "client_credentials",
        ],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: [
          "client_secret_basic",
          "client_secret_post",
          "none",
        ],
        claims_supported: [
          "sub",
          "iss",
          "aud",
          "exp",
          "iat",
          "nonce",
          "email",
          "email_verified",
          "name",
          "picture",
          "roles",
          "permissions",
          "tenant_id",
        ],
        code_challenge_methods_supported: ["S256"],
        // Enterprise extensions
        prompt_values_supported: ["none", "login", "consent", "select_account"],
        claim_types_supported: ["normal"],
        service_documentation: `${iss}/docs`,
      })
    },
  )

  // ============================================
  // 9. BASE ISSUER
  // ============================================
  // The base issuer handles:
  // - /token (authorization_code, refresh_token, client_credentials)
  // - /.well-known/jwks.json
  // - /.well-known/oauth-authorization-server
  // - /userinfo
  // - /token/introspect
  // - /token/revoke
  // - /{provider}/* routes

  app.route("/", baseIssuer)

  // ============================================
  // 10. ERROR HANDLING
  // ============================================

  app.onError(async (err, c) => {
    console.error("Enterprise issuer error:", err)

    if (err instanceof UnknownStateError) {
      return c.json(
        {
          error: "invalid_state",
          error_description: err.message,
        },
        400,
      )
    }

    if (err instanceof OauthError) {
      const authorization = c.get("authorization") as
        | EnterpriseAuthorizationState
        | undefined
      if (authorization?.redirect_uri) {
        const url = new URL(authorization.redirect_uri)
        url.searchParams.set("error", err.error)
        url.searchParams.set("error_description", err.description)
        if (authorization.state) {
          url.searchParams.set("state", authorization.state)
        }
        return c.redirect(url.toString())
      }

      return c.json(
        {
          error: err.error,
          error_description: err.description,
        },
        400,
      )
    }

    return c.json(
      {
        error: "server_error",
        error_description: err.message || "Internal server error",
      },
      500,
    )
  })

  // ============================================
  // HELPER FUNCTIONS
  // ============================================

  function getIssuerUrl(tenant: Tenant, req: Request): string {
    const url = new URL(req.url)

    if (tenant.domain) {
      return `${url.protocol}//${tenant.domain}`
    }

    return url.origin
  }

  async function syncSession(
    ctx: Context,
    browserSession: BrowserSession,
  ): Promise<void> {
    const cookieHeader = await createSessionCookieHeader(
      browserSession,
      config.sessionSecret,
      sessionConfig.cookieName,
    )
    ctx.header("Set-Cookie", cookieHeader)
  }

  return {
    app,
    getIssuerUrl,
    syncSession,
  }
}

// ============================================
// INTERNAL HELPERS
// ============================================

/**
 * Default client allow check
 */
async function defaultAllowCheck(
  input: { clientID: string; redirectURI: string; audience?: string },
  req: Request,
): Promise<boolean> {
  const redir = new URL(input.redirectURI).hostname
  if (redir === "localhost" || redir === "127.0.0.1") {
    return true
  }
  const forwarded = req.headers.get("x-forwarded-host")
  const host = forwarded
    ? new URL(`https://${forwarded}`).hostname
    : new URL(req.url).hostname

  return isDomainMatch(redir, host)
}

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(str: string | undefined | null): string {
  if (!str) return ""
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Helper to get theme value supporting both string and ColorScheme types
 */
function getThemeValue(
  value: string | { light: string; dark: string } | undefined,
  mode: "light" | "dark",
): string | undefined {
  if (!value) return undefined
  if (typeof value === "string") return value
  return value[mode]
}

/**
 * Convert theme radius to CSS multiplier
 */
function getRadiusMultiplier(radius?: string): string {
  switch (radius) {
    case "none":
      return "0"
    case "sm":
      return "1"
    case "md":
      return "1.25"
    case "lg":
      return "1.5"
    case "full":
      return "1000000000001"
    default:
      return "1"
  }
}

/**
 * Default OpenAuth logo SVG for fallback
 */
const OPENAUTH_LOGO_SVG = `<svg class="logo-default" width="51" height="51" viewBox="0 0 51 51" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M0 50.2303V0.12854H50.1017V50.2303H0ZM3.08002 11.8326H11.7041V3.20856H3.08002V11.8326ZM14.8526 11.8326H23.4766V3.20856H14.8526V11.8326ZM26.5566 11.8326H35.1807V3.20856H26.5566V11.8326ZM38.3292 11.8326H47.0217V3.20856H38.3292V11.8326ZM3.08002 23.6052H11.7041V14.9811H3.08002V23.6052ZM14.8526 23.6052H23.4766V14.9811H14.8526V23.6052ZM26.5566 23.6052H35.1807V14.9811H26.5566V23.6052ZM38.3292 23.6052H47.0217V14.9811H38.3292V23.6052ZM3.08002 35.3092H11.7041V26.6852H3.08002V35.3092ZM14.8526 35.3092H23.4766V26.6852H14.8526V35.3092ZM26.5566 35.3092H35.1807V26.6852H26.5566V35.3092ZM38.3292 35.3092H47.0217V26.6852H38.3292V35.3092ZM3.08002 47.1502H11.7041V38.3893H3.08002V47.1502ZM14.8526 47.1502H23.4766V38.3893H14.8526V47.1502ZM26.5566 47.1502H35.1807V38.3893H26.5566V47.1502ZM38.3292 47.1502H47.0217V38.3893H38.3292V47.1502Z" fill="currentColor"/>
</svg>`

/**
 * Render account picker UI with full theme support
 */
function renderAccountPicker(
  ctx: Context,
  accounts: AccountPickerAccount[],
  authorization: EnterpriseAuthorizationState,
  tenant: Tenant,
): Response {
  // Get resolved theme from middleware context, with fallbacks
  const resolvedTheme: Theme | undefined = ctx.get("resolvedTheme")
  const tenantTheme = tenant?.branding?.theme
  const theme: Theme = resolvedTheme || (tenantTheme as Theme) || THEME_OPENAUTH

  const baseUrl = new URL(ctx.req.url).origin

  // Extract theme values with light/dark support
  const primaryLight = getThemeValue(theme.primary, "light") || "#000000"
  const primaryDark = getThemeValue(theme.primary, "dark") || "#ffffff"
  const bgLight = getThemeValue(theme.background, "light") || "#ffffff"
  const bgDark = getThemeValue(theme.background, "dark") || "#0e0e11"
  const logoLight = getThemeValue(theme.logo, "light")
  const logoDark = getThemeValue(theme.logo, "dark")
  const hasLogo = logoLight && logoDark
  const fontFamily =
    theme.font?.family ||
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  const fontScale = theme.font?.scale || "1"
  const radius = getRadiusMultiplier(theme.radius)
  const title = theme.title || tenant?.name || "OpenAuth"

  // Build favicon HTML
  let faviconHtml = ""
  if (theme.favicon) {
    faviconHtml = `<link rel="icon" href="${escapeHtml(theme.favicon)}">`
  } else {
    faviconHtml = `
    <link rel="icon" href="https://openauth.js.org/favicon.ico" sizes="48x48">
    <link rel="icon" href="https://openauth.js.org/favicon.svg" media="(prefers-color-scheme: light)">
    <link rel="icon" href="https://openauth.js.org/favicon-dark.svg" media="(prefers-color-scheme: dark)">
    <link rel="shortcut icon" href="https://openauth.js.org/favicon.svg" type="image/svg+xml">`
  }

  // Build logo HTML
  let logoHtml = ""
  if (hasLogo) {
    logoHtml = `
    <img class="logo" src="${escapeHtml(logoLight!)}" data-mode="light" alt="${escapeHtml(title)}">
    <img class="logo" src="${escapeHtml(logoDark!)}" data-mode="dark" alt="${escapeHtml(title)}">`
  } else {
    logoHtml = OPENAUTH_LOGO_SVG
  }

  const html = `
<!DOCTYPE html>
<html style="
  --color-background-light: ${escapeHtml(bgLight)};
  --color-background-dark: ${escapeHtml(bgDark)};
  --color-primary-light: ${escapeHtml(primaryLight)};
  --color-primary-dark: ${escapeHtml(primaryDark)};
  --font-family: ${escapeHtml(fontFamily)};
  --font-scale: ${escapeHtml(fontScale)};
  --border-radius: ${escapeHtml(radius)};
">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Choose Account - ${escapeHtml(title)}</title>
  ${faviconHtml}
  <style>
    @import url("https://unpkg.com/tailwindcss@3.4.15/src/css/preflight.css");

    :root {
      --color-background: var(--color-background-dark);
      --color-primary: var(--color-primary-dark);
      --font-size-xs: calc(0.75rem * var(--font-scale, 1));
      --font-size-sm: calc(0.875rem * var(--font-scale, 1));
      --font-size-md: calc(1rem * var(--font-scale, 1));
      --font-size-lg: calc(1.125rem * var(--font-scale, 1));
    }

    @media (prefers-color-scheme: light) {
      :root {
        --color-background: var(--color-background-light);
        --color-primary: var(--color-primary-light);
      }
    }

    /* Computed contrast colors */
    :root {
      --color-high: oklch(from var(--color-background) clamp(0, calc((l - 0.714) * -1000), 1) 0 0);
      --color-low: oklch(from var(--color-background) clamp(0, calc((l - 0.714) * 1000), 1) 0 0);
      --color-border: oklch(from var(--color-background) calc(clamp(0.22, l + (-0.12 * clamp(0, calc((l - 0.714) * 1000), 1) + 0.06), 0.88)) c h);
      --color-surface: oklch(from var(--color-background) calc(l + (-0.06 * clamp(0, calc((l - 0.714) * 1000), 1) + 0.03)) c h);
    }

    body {
      font-family: var(--font-family);
      background: var(--color-background);
      color: var(--color-high);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      padding: 1rem;
    }

    .container {
      max-width: 380px;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .logo-container {
      text-align: center;
      margin-bottom: 0.5rem;
    }

    .logo {
      height: 2.5rem;
      width: auto;
      margin: 0 auto;
      display: none;
    }

    @media (prefers-color-scheme: light) {
      .logo[data-mode="light"] { display: block; }
    }

    @media (prefers-color-scheme: dark) {
      .logo[data-mode="dark"] { display: block; }
    }

    .logo-default {
      height: 2.5rem;
      width: auto;
      margin: 0 auto;
      color: var(--color-high);
    }

    .header {
      text-align: center;
    }

    h1 {
      font-size: var(--font-size-lg);
      font-weight: 600;
      margin: 0 0 0.25rem 0;
    }

    .subtitle {
      color: var(--color-low);
      font-size: var(--font-size-sm);
      margin: 0;
    }

    .accounts-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .account-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .account-btn {
      display: flex;
      align-items: center;
      flex: 1;
      padding: 0.75rem 1rem;
      border: 1px solid var(--color-border);
      border-radius: calc(var(--border-radius) * 0.25rem);
      background: var(--color-surface);
      cursor: pointer;
      text-decoration: none;
      color: inherit;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .account-btn:hover {
      border-color: var(--color-primary);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .account-btn.active {
      border-color: var(--color-primary);
      border-width: 2px;
    }

    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--color-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      color: oklch(from var(--color-primary) clamp(0, calc((l - 0.714) * -1000), 1) 0 0);
      font-weight: 600;
      font-size: var(--font-size-sm);
      margin-right: 0.75rem;
      flex-shrink: 0;
    }

    .avatar img {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      object-fit: cover;
    }

    .account-info {
      flex: 1;
      text-align: left;
      min-width: 0;
    }

    .account-name {
      font-weight: 500;
      font-size: var(--font-size-sm);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .account-email {
      color: var(--color-low);
      font-size: var(--font-size-xs);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .signout-btn {
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--color-border);
      border-radius: calc(var(--border-radius) * 0.25rem);
      background: transparent;
      color: var(--color-low);
      font-size: var(--font-size-xs);
      cursor: pointer;
      transition: border-color 0.2s, color 0.2s;
      white-space: nowrap;
    }

    .signout-btn:hover {
      border-color: #dc3545;
      color: #dc3545;
    }

    .add-account {
      display: block;
      text-align: center;
      color: var(--color-primary);
      text-decoration: none;
      padding: 0.75rem;
      font-size: var(--font-size-sm);
      font-weight: 500;
    }

    .add-account:hover {
      text-decoration: underline;
    }
  </style>
  ${theme.css ? `<style>${theme.css}</style>` : ""}
</head>
<body>
  <div class="container">
    <div class="logo-container">
      ${logoHtml}
    </div>
    <div class="header">
      <h1>Choose Account</h1>
      <p class="subtitle">Select an account to continue</p>
    </div>
    <div class="accounts-list">
    ${accounts
      .map((account) => {
        const accountUrl = new URL("/authorize", baseUrl)
        accountUrl.searchParams.set("client_id", authorization.client_id)
        accountUrl.searchParams.set("redirect_uri", authorization.redirect_uri)
        accountUrl.searchParams.set(
          "response_type",
          authorization.response_type,
        )
        if (authorization.state)
          accountUrl.searchParams.set("state", authorization.state)
        if (authorization.scope)
          accountUrl.searchParams.set("scope", authorization.scope)
        if (authorization.nonce)
          accountUrl.searchParams.set("nonce", authorization.nonce)
        accountUrl.searchParams.set("prompt", "none")
        accountUrl.searchParams.set("account_hint", account.userId)
        const activeClass = Boolean(account.isActive) ? "active" : ""
        return `
      <div class="account-row">
        <a href="${escapeHtml(accountUrl.toString())}" class="account-btn ${activeClass}">
          <div class="avatar">
            ${
              account.avatarUrl
                ? `<img src="${escapeHtml(account.avatarUrl)}" alt="">`
                : escapeHtml(
                    (account.displayName || account.email || "?")
                      .charAt(0)
                      .toUpperCase(),
                  )
            }
          </div>
          <div class="account-info">
            <div class="account-name">${escapeHtml(account.displayName || account.email || account.userId)}</div>
            ${account.email && account.displayName ? `<div class="account-email">${escapeHtml(account.email)}</div>` : ""}
          </div>
        </a>
        <form method="POST" action="/account-picker/remove" style="margin: 0;">
          <input type="hidden" name="user_id" value="${escapeHtml(account.userId)}">
          <input type="hidden" name="client_id" value="${escapeHtml(authorization.client_id)}">
          <input type="hidden" name="redirect_uri" value="${escapeHtml(authorization.redirect_uri)}">
          <input type="hidden" name="response_type" value="${escapeHtml(authorization.response_type)}">
          <input type="hidden" name="state" value="${escapeHtml(authorization.state || "")}">
          <input type="hidden" name="scope" value="${escapeHtml(authorization.scope || "")}">
          <input type="hidden" name="nonce" value="${escapeHtml(authorization.nonce || "")}">
          <button type="submit" class="signout-btn">Sign out</button>
        </form>
      </div>
    `
      })
      .join("")}
    </div>
    <a href="${generateAddAccountUrl(baseUrl + "/authorize", authorization)}" class="add-account">
      + Use another account
    </a>
  </div>
</body>
</html>
`

  return ctx.html(html)
}
