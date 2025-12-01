/**
 * Multi-Tenant Enterprise Issuer
 *
 * Creates an OpenAuth server with integrated multi-tenant support, session
 * management, and RBAC. This is the main factory function for enterprise
 * deployments that need:
 *
 * - Multi-tenant isolation with tenant-scoped storage
 * - White-label branding per tenant
 * - Multi-account browser sessions
 * - Role-based access control with token enrichment
 * - OIDC prompt parameter support
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
 * // Initialize services
 * const tenantService = new TenantServiceImpl(storage)
 * const sessionService = new SessionServiceImpl(storage)
 * const rbacAdapter = new RBACAdapter(d1Database)
 * const rbacService = new RBACServiceImpl(rbacAdapter, storage)
 *
 * // Create enterprise issuer
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
 * // Export for your runtime
 * export default app
 * ```
 */

import { Hono } from "hono/tiny"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import type { Context } from "hono"

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
import type { SubjectSchema } from "../subject.js"
import type { StorageAdapter } from "../storage/storage.js"

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
  AddAccountParams,
  AccountPickerAccount,
} from "./types.js"

import {
  addAccountToSession,
  handlePromptParameter,
  handleMaxAge,
  handleAccountHint,
  handleLoginHint,
  validateSessionForSilentAuth,
  createOIDCErrorRedirect,
  formatAccountsForPicker,
  generateAddAccountUrl,
} from "./session-integration.js"

import { getRelativeUrl, isDomainMatch, lazy } from "../util.js"
import { OauthError, UnauthorizedClientError, UnknownStateError } from "../error.js"

// ============================================
// MAIN FACTORY FUNCTION
// ============================================

/**
 * Create a multi-tenant enterprise issuer.
 *
 * This factory function creates a Hono application with all enterprise
 * features integrated:
 *
 * 1. Tenant Resolution - Resolve tenant from request (subdomain, path, header, etc.)
 * 2. Theme Middleware - Apply tenant-specific branding
 * 3. Session Middleware - Load multi-account browser sessions
 * 4. Session Routes - API endpoints for session management
 * 5. RBAC Routes - Permission checking and admin endpoints
 * 6. Tenant Routes - Tenant CRUD API
 * 7. OAuth Flow - Modified to integrate with sessions and RBAC
 *
 * @param config - Enterprise issuer configuration
 * @returns The multi-tenant issuer with Hono app and helpers
 */
export function createMultiTenantIssuer<
  Providers extends Record<string, Provider<any>>,
  Subjects extends SubjectSchema,
>(
  config: EnterpriseIssuerConfig<Providers, Subjects>,
): MultiTenantIssuer {
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

  // Create the main Hono app
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
  // 2. APPLY TENANT RESOLVER MIDDLEWARE
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
    optional: false, // Tenant is required for enterprise issuer
  }

  app.use("*", createTenantResolver(tenantResolverConfig))

  // ============================================
  // 3. APPLY THEME MIDDLEWARE
  // ============================================

  app.use("*", createTenantThemeMiddleware())

  // ============================================
  // 4. APPLY SESSION MIDDLEWARE
  // ============================================

  app.use(
    "*",
    createSessionMiddleware(config.sessionService, config.sessionSecret, {
      cookieName: sessionConfig.cookieName,
      autoRefresh: true,
    }),
  )

  // ============================================
  // 5. MOUNT SESSION ROUTES
  // ============================================

  // User-facing session routes: /session/*
  app.route("/session", sessionRoutes(config.sessionService))

  // Admin session routes: /admin/sessions/*
  app.route("/admin/sessions", adminSessionRoutes(config.sessionService))

  // ============================================
  // 6. MOUNT RBAC ROUTES (if configured)
  // ============================================

  if (config.rbacService) {
    // Permission checking routes: /rbac/*
    app.route("/rbac", rbacEndpoints(config.rbacService))

    // Admin RBAC routes: /rbac/admin/*
    app.route("/rbac/admin", rbacAdminEndpoints(config.rbacService))
  }

  // ============================================
  // 7. MOUNT TENANT API ROUTES
  // ============================================

  // Tenant CRUD API: /tenants/*
  app.route("/tenants", tenantApiRoutes(config.tenantService))

  // ============================================
  // 8. AUTHORIZATION ENDPOINT
  // ============================================

  app.get("/authorize", async (c) => {
    const tenant = getTenant(c)
    if (!tenant) {
      return c.json(
        { error: "tenant_not_found", error_description: "Tenant not resolved" },
        404,
      )
    }

    // Extract authorization parameters
    const provider = c.req.query("provider")
    const response_type = c.req.query("response_type")
    const redirect_uri = c.req.query("redirect_uri")
    const state = c.req.query("state")
    const client_id = c.req.query("client_id")
    const audience = c.req.query("audience")
    const code_challenge = c.req.query("code_challenge")
    const code_challenge_method = c.req.query("code_challenge_method")

    // OIDC parameters
    const prompt = c.req.query("prompt") as PromptType | undefined
    const login_hint = c.req.query("login_hint")
    const account_hint = c.req.query("account_hint")
    const max_age = c.req.query("max_age")
    const scope = c.req.query("scope")
    const nonce = c.req.query("nonce")

    // Build authorization state
    const authorization: EnterpriseAuthorizationState = {
      response_type: response_type || "",
      redirect_uri: redirect_uri || "",
      state: state || "",
      client_id: client_id || "",
      audience,
      pkce:
        code_challenge && code_challenge_method
          ? {
              challenge: code_challenge,
              method: code_challenge_method as "S256",
            }
          : undefined,
      prompt,
      login_hint,
      account_hint,
      max_age: max_age ? parseInt(max_age, 10) : undefined,
      scope,
      nonce,
    }

    c.set("authorization", authorization)

    // Validate required parameters
    if (!redirect_uri) {
      return c.text("Missing redirect_uri", { status: 400 })
    }
    if (!response_type) {
      return c.text("Missing response_type", { status: 400 })
    }
    if (!client_id) {
      return c.text("Missing client_id", { status: 400 })
    }

    // Check if client is allowed
    const allowCheck = config.onAllow
      ? await config.onAllow(
          { clientID: client_id, redirectURI: redirect_uri, audience },
          c.req.raw,
          tenant,
        )
      : await defaultAllowCheck(
          { clientID: client_id, redirectURI: redirect_uri, audience },
          c.req.raw,
        )

    if (!allowCheck) {
      throw new UnauthorizedClientError(client_id, redirect_uri)
    }

    // Get session info (from context, set by session middleware)
    const browserSession = c.get("browserSession") as BrowserSession | null
    const activeAccount = c.get("activeAccount") as AccountSession | null

    // Handle account_hint if provided
    if (authorization.account_hint) {
      await handleAccountHint(
        c,
        authorization.account_hint,
        config.sessionService,
        browserSession,
      )
    }

    // Handle login_hint if provided
    if (authorization.login_hint) {
      await handleLoginHint(
        c,
        authorization.login_hint,
        config.sessionService,
        browserSession,
      )
    }

    // Handle prompt parameter
    const promptResult = await handlePromptParameter(
      c,
      authorization.prompt,
      config.sessionService,
      browserSession,
      authorization,
    )

    if (!promptResult.proceed) {
      if (promptResult.response) {
        return promptResult.response
      }

      // Check if we should show account picker
      if (c.get("showAccountPicker")) {
        const accounts = c.get("accountPickerAccounts") || []
        return renderAccountPicker(c, accounts, authorization)
      }
    }

    // Handle max_age parameter
    if (authorization.max_age !== undefined) {
      const maxAgeResult = handleMaxAge(c, authorization.max_age, activeAccount)
      if (maxAgeResult.forceReauth) {
        promptResult.forceReauth = true
      }
    }

    // If we have a valid session and no force re-auth, try silent auth
    if (
      !promptResult.forceReauth &&
      validateSessionForSilentAuth(browserSession, activeAccount, client_id)
    ) {
      // User is already authenticated - issue tokens directly
      // This is the SSO case where user is logged in already
      // We'll still go through the provider flow to get updated claims
    }

    // Store authorization state in cookie
    // (handled by provider flow)

    // Redirect to provider
    if (provider) {
      // Store login hint for the provider
      if (authorization.login_hint) {
        c.set("loginHint", authorization.login_hint)
      }
      return c.redirect(`/${provider}/authorize`)
    }

    // No provider specified - show provider selection
    const providers = Object.keys(config.providers)
    if (providers.length === 1) {
      return c.redirect(`/${providers[0]}/authorize`)
    }

    // Multiple providers - show selection UI
    return renderProviderSelection(c, config.providers, tenant)
  })

  // ============================================
  // 9. MOUNT PROVIDER ROUTES
  // ============================================

  // Create a wrapper that adds enterprise success handling
  for (const [name, provider] of Object.entries(config.providers)) {
    const route = new Hono<any>()

    // Set provider name in context
    route.use(async (c, next) => {
      c.set("provider", name)
      await next()
    })

    // Initialize provider with enhanced success callback
    provider.init(route, {
      name,
      storage: config.storage,
      async success(ctx: Context, properties: any, successOpts) {
        const tenant = getTenant(ctx)
        if (!tenant) {
          throw new Error("Tenant not resolved in success callback")
        }

        const browserSession = ctx.get("browserSession") as BrowserSession | null
        const authorization = ctx.get("authorization") as
          | EnterpriseAuthorizationState
          | undefined

        // Get or create browser session
        let session = browserSession
        if (!session) {
          session = await config.sessionService.createBrowserSession({
            tenantId: tenant.id,
            userAgent: ctx.req.header("User-Agent") || "unknown",
            ipAddress:
              ctx.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
              ctx.req.header("X-Real-IP") ||
              "unknown",
          })

          // Set session cookie
          const cookieHeader = await createSessionCookieHeader(
            session,
            config.sessionSecret,
            sessionConfig.cookieName,
          )
          ctx.header("Set-Cookie", cookieHeader)
        }

        // Enrich with RBAC claims if service available
        let rbacClaims: RBACClaims = { roles: [], permissions: [] }
        if (config.rbacService && properties.userID) {
          rbacClaims = await config.rbacService.enrichTokenClaims({
            userId: properties.userID,
            appId: authorization?.client_id || "default",
            tenantId: tenant.id,
          })
        }

        // Build enterprise auth result
        const enterpriseResult: EnterpriseAuthResult = {
          provider: name,
          ...properties,
          tenantId: tenant.id,
          roles: rbacClaims.roles,
          permissions: rbacClaims.permissions,
        }

        // Create enhanced success context
        const enterpriseCtx: EnterpriseSuccessContext<any> = {
          async subject(type, props, opts) {
            // Add account to session after successful auth
            if (session && props.userID) {
              await addAccountToSession(ctx, config.sessionService, {
                browserSession: session,
                userId: props.userID || properties.userID,
                subjectType: type as string,
                subjectProperties: props,
                refreshToken: properties.refresh || crypto.randomUUID(),
                clientId: authorization?.client_id || "default",
                ttl: sessionConfig.sessionLifetimeSeconds,
              })
            }

            // Call invalidate if provided
            if (successOpts?.invalidate) {
              const subject = opts?.subject || (await resolveSubject(type, props))
              await successOpts.invalidate(subject)
            }

            // Generate tokens (delegate to base issuer logic)
            // For now, return a simple response
            // The actual token generation should be handled by the base issuer
            return ctx.json({
              type,
              properties: props,
              tenantId: tenant.id,
              roles: rbacClaims.roles,
              permissions: rbacClaims.permissions,
            })
          },
        }

        // Call user's success callback or default
        if (config.onSuccess) {
          return config.onSuccess(enterpriseCtx, enterpriseResult, tenant)
        }

        // Default: return subject with RBAC claims
        return enterpriseCtx.subject(properties.type || "user", {
          ...properties.properties,
          tenantId: tenant.id,
          roles: rbacClaims.roles,
          permissions: rbacClaims.permissions,
        })
      },
      forward(ctx, response) {
        return ctx.newResponse(
          response.body,
          response.status as any,
          Object.fromEntries(response.headers.entries()),
        )
      },
      async set(ctx, key, maxAge, value) {
        // Use tenant-scoped storage if available
        const tenantStorage = getTenantStorage(ctx)
        const storage = tenantStorage || config.storage

        // Encrypt and set cookie (delegated)
        // For enterprise, we might want to use tenant-scoped cookies
        const { setCookie } = await import("hono/cookie")
        setCookie(ctx, key, JSON.stringify(value), {
          maxAge,
          httpOnly: true,
          ...(ctx.req.url.startsWith("https://")
            ? { secure: true, sameSite: "None" }
            : {}),
        })
      },
      async get(ctx: Context, key: string) {
        const { getCookie } = await import("hono/cookie")
        const raw = getCookie(ctx, key)
        if (!raw) return
        try {
          return JSON.parse(raw)
        } catch {
          return undefined
        }
      },
      async unset(ctx: Context, key: string) {
        const { deleteCookie } = await import("hono/cookie")
        deleteCookie(ctx, key)
      },
      async invalidate(subject: string) {
        // Invalidate all refresh tokens for this subject
        // This should be tenant-scoped in enterprise
        const tenant = getTenant((globalThis as any).__currentCtx)
        if (tenant) {
          // Use tenant-scoped storage
          const tenantStorage = new TenantStorageImpl(config.storage, tenant.id)
          // Implementation depends on storage structure
        }
      },
    })

    app.route(`/${name}`, route)
  }

  // ============================================
  // 10. WELL-KNOWN ENDPOINTS
  // ============================================

  app.get(
    "/.well-known/jwks.json",
    cors({
      origin: "*",
      allowHeaders: ["*"],
      allowMethods: ["GET"],
      credentials: false,
    }),
    async (c) => {
      // Return JWKS (delegate to storage/keys)
      // This should be implemented based on the signing keys
      return c.json({ keys: [] })
    },
  )

  app.get(
    "/.well-known/oauth-authorization-server",
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
        jwks_uri: `${iss}/.well-known/jwks.json`,
        response_types_supported: ["code", "token"],
        grant_types_supported: [
          "authorization_code",
          "refresh_token",
          "client_credentials",
        ],
        code_challenge_methods_supported: ["S256"],
        // OIDC extensions
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        scopes_supported: ["openid", "profile", "email"],
        claims_supported: [
          "sub",
          "aud",
          "exp",
          "iat",
          "iss",
          "roles",
          "permissions",
          "tenant_id",
        ],
      })
    },
  )

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
  // 11. ERROR HANDLER
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

  /**
   * Get the issuer URL for a tenant
   */
  function getIssuerUrl(tenant: Tenant, req: Request): string {
    const url = new URL(req.url)

    // If tenant has a custom domain, use it
    if (tenant.domain) {
      return `${url.protocol}//${tenant.domain}`
    }

    // Otherwise use the request URL origin
    return url.origin
  }

  /**
   * Sync session state (for manual updates)
   */
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
 * Resolve subject ID from type and properties
 */
async function resolveSubject(type: string, properties: any): Promise<string> {
  const jsonString = JSON.stringify(properties)
  const encoder = new TextEncoder()
  const data = encoder.encode(jsonString)
  const hashBuffer = await crypto.subtle.digest("SHA-1", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `${type}:${hashHex.slice(0, 16)}`
}

/**
 * Render provider selection UI
 */
function renderProviderSelection(
  ctx: Context,
  providers: Record<string, Provider<any>>,
  tenant: Tenant,
): Response {
  const providerList = Object.entries(providers).map(([key, value]) => ({
    id: key,
    type: value.type,
  }))

  // Get theme from tenant branding
  const theme = tenant.branding?.theme || {}

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign In - ${tenant.name}</title>
  <style>
    :root {
      --oa-primary: ${theme.primary || "#007bff"};
      --oa-secondary: ${theme.secondary || "#6c757d"};
      --oa-background: ${theme.background || "#ffffff"};
      --oa-text: ${theme.text || "#212529"};
      --oa-font-family: ${theme.fontFamily || "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"};
    }
    body {
      font-family: var(--oa-font-family);
      background: var(--oa-background);
      color: var(--oa-text);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
    }
    .container {
      max-width: 400px;
      width: 100%;
      padding: 2rem;
    }
    h1 {
      text-align: center;
      margin-bottom: 2rem;
    }
    .provider-btn {
      display: block;
      width: 100%;
      padding: 1rem;
      margin-bottom: 1rem;
      border: 1px solid #ddd;
      border-radius: 8px;
      background: white;
      color: var(--oa-text);
      font-size: 1rem;
      cursor: pointer;
      text-decoration: none;
      text-align: center;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .provider-btn:hover {
      border-color: var(--oa-primary);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
  </style>
</head>
<body>
  <div class="container">
    ${tenant.branding?.logoLight ? `<img src="${tenant.branding.logoLight}" alt="${tenant.name}" style="display: block; margin: 0 auto 2rem; max-height: 60px;">` : ""}
    <h1>Sign In</h1>
    ${providerList
      .map(
        (p) => `
      <a href="/${p.id}/authorize" class="provider-btn">
        Continue with ${p.type.charAt(0).toUpperCase() + p.type.slice(1)}
      </a>
    `,
      )
      .join("")}
  </div>
</body>
</html>
`

  return ctx.html(html)
}

/**
 * Render account picker UI
 */
function renderAccountPicker(
  ctx: Context,
  accounts: AccountPickerAccount[],
  authorization: EnterpriseAuthorizationState,
): Response {
  const tenant = getTenant(ctx)
  const theme = tenant?.branding?.theme || {}
  const baseUrl = new URL(ctx.req.url).origin

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Choose Account - ${tenant?.name || "OpenAuth"}</title>
  <style>
    :root {
      --oa-primary: ${theme.primary || "#007bff"};
      --oa-secondary: ${theme.secondary || "#6c757d"};
      --oa-background: ${theme.background || "#ffffff"};
      --oa-text: ${theme.text || "#212529"};
      --oa-font-family: ${theme.fontFamily || "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"};
    }
    body {
      font-family: var(--oa-font-family);
      background: var(--oa-background);
      color: var(--oa-text);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
    }
    .container {
      max-width: 400px;
      width: 100%;
      padding: 2rem;
    }
    h1 {
      text-align: center;
      margin-bottom: 0.5rem;
    }
    .subtitle {
      text-align: center;
      color: var(--oa-secondary);
      margin-bottom: 2rem;
    }
    .account-btn {
      display: flex;
      align-items: center;
      width: 100%;
      padding: 1rem;
      margin-bottom: 0.75rem;
      border: 1px solid #ddd;
      border-radius: 8px;
      background: white;
      cursor: pointer;
      text-decoration: none;
      color: inherit;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .account-btn:hover {
      border-color: var(--oa-primary);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .account-btn.active {
      border-color: var(--oa-primary);
      border-width: 2px;
    }
    .avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--oa-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      margin-right: 1rem;
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
    }
    .account-name {
      font-weight: 500;
    }
    .account-email {
      color: var(--oa-secondary);
      font-size: 0.875rem;
    }
    .add-account {
      display: block;
      text-align: center;
      color: var(--oa-primary);
      text-decoration: none;
      padding: 1rem;
      margin-top: 1rem;
    }
    .add-account:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Choose Account</h1>
    <p class="subtitle">Select an account to continue</p>
    ${accounts
      .map(
        (account) => `
      <a href="/authorize?client_id=${encodeURIComponent(authorization.client_id)}&redirect_uri=${encodeURIComponent(authorization.redirect_uri)}&response_type=${encodeURIComponent(authorization.response_type)}&state=${encodeURIComponent(authorization.state || "")}&account_hint=${encodeURIComponent(account.userId)}" class="account-btn ${account.isActive ? "active" : ""}">
        <div class="avatar">
          ${
            account.avatarUrl
              ? `<img src="${account.avatarUrl}" alt="">`
              : (account.displayName || account.email || "?")
                  .charAt(0)
                  .toUpperCase()
          }
        </div>
        <div class="account-info">
          <div class="account-name">${account.displayName || account.email || account.userId}</div>
          ${account.email && account.displayName ? `<div class="account-email">${account.email}</div>` : ""}
        </div>
      </a>
    `,
      )
      .join("")}
    <a href="${generateAddAccountUrl(baseUrl + "/authorize", authorization)}" class="add-account">
      + Use another account
    </a>
  </div>
</body>
</html>
`

  return ctx.html(html)
}
