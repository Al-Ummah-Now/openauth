/**
 * The `issuer` create an OpentAuth server, a [Hono](https://hono.dev) app that's
 * designed to run anywhere.
 *
 * The `issuer` function requires a few things:
 *
 * ```ts title="issuer.ts"
 * import { issuer } from "@openauthjs/openauth"
 *
 * const app = issuer({
 *   providers: { ... },
 *   storage,
 *   subjects,
 *   success: async (ctx, value) => { ... }
 * })
 * ```
 *
 * #### Add providers
 *
 * You start by specifying the auth providers you are going to use. Let's say you want your users
 * to be able to authenticate with GitHub and with their email and password.
 *
 * ```ts title="issuer.ts"
 * import { GithubProvider } from "@openauthjs/openauth/provider/github"
 * import { PasswordProvider } from "@openauthjs/openauth/provider/password"
 *
 * const app = issuer({
 *   providers: {
 *     github: GithubProvider({
 *       // ...
 *     }),
 *     password: PasswordProvider({
 *       // ...
 *     }),
 *   },
 * })
 * ```
 *
 * #### Handle success
 *
 * The `success` callback receives the payload when a user completes a provider's auth flow.
 *
 * ```ts title="issuer.ts"
 * const app = issuer({
 *   providers: { ... },
 *   subjects,
 *   async success(ctx, value) {
 *     let userID
 *     if (value.provider === "password") {
 *       console.log(value.email)
 *       userID = ... // lookup user or create them
 *     }
 *     if (value.provider === "github") {
 *       console.log(value.tokenset.access)
 *       userID = ... // lookup user or create them
 *     }
 *     return ctx.subject("user", {
 *       userID
 *     })
 *   }
 * })
 * ```
 *
 * Once complete, the `issuer` issues the access tokens that a client can use. The `ctx.subject`
 * call is what is placed in the access token as a JWT.
 *
 * #### Define subjects
 *
 * You define the shape of these in the `subjects` field.
 *
 * ```ts title="subjects.ts"
 * import { object, string } from "valibot"
 * import { createSubjects } from "@openauthjs/openauth/subject"
 *
 * const subjects = createSubjects({
 *   user: object({
 *     userID: string()
 *   })
 * })
 * ```
 *
 * It's good to place this in a separate file since this'll be used in your client apps as well.
 *
 * ```ts title="issuer.ts"
 * import { subjects } from "./subjects.js"
 *
 * const app = issuer({
 *   providers: { ... },
 *   subjects,
 *   // ...
 * })
 * ```
 *
 * #### Deploy
 *
 * Since `issuer` is a Hono app, you can deploy it anywhere Hono supports.
 *
 * <Tabs>
 *   <TabItem label="Node">
 *   ```ts title="issuer.ts"
 *   import { serve } from "@hono/node-server"
 *
 *   serve(app)
 *   ```
 *   </TabItem>
 *   <TabItem label="Lambda">
 *   ```ts title="issuer.ts"
 *   import { handle } from "hono/aws-lambda"
 *
 *   export const handler = handle(app)
 *   ```
 *   </TabItem>
 *   <TabItem label="Bun">
 *   ```ts title="issuer.ts"
 *   export default app
 *   ```
 *   </TabItem>
 *   <TabItem label="Workers">
 *   ```ts title="issuer.ts"
 *   export default app
 *   ```
 *   </TabItem>
 * </Tabs>
 *
 * @packageDocumentation
 */
import { Provider, ProviderOptions } from "./provider/provider.js"
import { SubjectPayload, SubjectSchema } from "./subject.js"
import { Hono } from "hono/tiny"
import { handle as awsHandle } from "hono/aws-lambda"
import { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import type { v1 } from "@standard-schema/spec"

/**
 * Sets the subject payload in the JWT token and returns the response.
 *
 * ```ts
 * ctx.subject("user", {
 *   userID
 * })
 * ```
 */
export interface OnSuccessResponder<
  T extends { type: string; properties: any },
> {
  /**
   * The `type` is the type of the subject, that was defined in the `subjects` field.
   *
   * The `properties` are the properties of the subject. This is the shape of the subject that
   * you defined in the `subjects` field.
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
 * @internal
 */
export interface AuthorizationState {
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
   * The flow id this authorization belongs to (see `flow.ts`). Set on the
   * legacy `authorization` cookie so it is only used by its own tab.
   */
  flow?: string
}

/**
 * @internal
 */
export type Prettify<T> = {
  [K in keyof T]: T[K]
} & {}

import {
  MissingParameterError,
  OauthError,
  UnauthorizedClientError,
  UnknownStateError,
} from "./error.js"
import { compactDecrypt, CompactEncrypt, jwtVerify, SignJWT } from "jose"
import { Storage, StorageAdapter } from "./storage/storage.js"
import { encryptionKeys, legacySigningKeys, signingKeys } from "./keys.js"
import { validatePKCE } from "./pkce.js"
import { clientRequiresPkce } from "./client/native.js"
import {
  DEVICE_CODE_GRANT,
  deviceDiscovery,
  registerDeviceFlow,
  type DeviceFlowOptions,
} from "./device.js"
import { Select } from "./ui/select.js"
import type { Theme } from "./ui/theme.js"
import {
  RESOLVED_THEME_KEY,
  renderOptions,
  type RenderOptions,
} from "./ui/render.js"
import { RestartPage } from "./ui/restart.js"
import { inheritForwarded } from "./forward.js"
import {
  FLOW_BIND_COOKIE,
  FLOW_COMPLETED_TTL,
  FLOW_PARAM,
  FLOW_RECORD_VERSION,
  type FlowRecord,
  bindingHash,
  flowKey,
  isBindSecret,
  isFlowId,
  localeHintFor,
  newBindSecret,
  newFlowId,
  restartUrlFor,
} from "./flow.js"
import { timingSafeCompare } from "./random.js"

/** Key in a provider-state cookie naming the flow it was written for. */
const PROVIDER_FLOW_TAG = "__oaflow"
import { getRelativeUrl, isDomainMatch, lazy } from "./util.js"
import { DynamoStorage } from "./storage/dynamo.js"
import { MemoryStorage } from "./storage/memory.js"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import type { D1Database } from "@cloudflare/workers-types"
import { ClientD1Adapter } from "./client/client-d1-adapter.js"
import { ClientAuthenticator } from "./client/authenticator.js"
import { AuditService, type TokenUsageEvent } from "./services/audit.js"
import { RevocationService } from "./revocation.js"
import { validateScopes, parseScopes, generateM2MToken } from "./m2m/index.js"
import type { M2MConfig } from "./m2m/types.js"

/** @internal */
export const aws = awsHandle

export interface IssuerInput<
  Providers extends Record<string, Provider<any>>,
  Subjects extends SubjectSchema,
  Result = {
    [key in keyof Providers]: Prettify<
      {
        provider: key
      } & (Providers[key] extends Provider<infer T> ? T : {})
    >
  }[keyof Providers],
> {
  /**
   * The shape of the subjects that you want to return.
   *
   * @example
   *
   * ```ts title="issuer.ts"
   * import { object, string } from "valibot"
   * import { createSubjects } from "@openauthjs/openauth/subject"
   *
   * issuer({
   *   subjects: createSubjects({
   *     user: object({
   *       userID: string()
   *     })
   *   })
   *   // ...
   * })
   * ```
   */
  subjects: Subjects
  /**
   * The storage adapter that you want to use.
   *
   * @example
   * ```ts title="issuer.ts"
   * import { DynamoStorage } from "@openauthjs/openauth/storage/dynamo"
   *
   * issuer({
   *   storage: DynamoStorage()
   *   // ...
   * })
   * ```
   */
  storage?: StorageAdapter
  /**
   * The providers that you want your OpenAuth server to support.
   *
   * @example
   *
   * ```ts title="issuer.ts"
   * import { GithubProvider } from "@openauthjs/openauth/provider/github"
   *
   * issuer({
   *   providers: {
   *     github: GithubProvider()
   *   }
   * })
   * ```
   *
   * The key is just a string that you can use to identify the provider. It's passed back to
   * the `success` callback.
   *
   * You can also specify multiple providers.
   *
   * ```ts
   * {
   *   providers: {
   *     github: GithubProvider(),
   *     google: GoogleProvider()
   *   }
   * }
   * ```
   */
  providers: Providers
  /**
   * The theme you want to use for the UI.
   *
   * This includes the UI the user sees when selecting a provider. And the `PasswordUI` and
   * `CodeUI` that are used by the `PasswordProvider` and `CodeProvider`.
   *
   * @example
   * ```ts title="issuer.ts"
   * import { THEME_SST } from "@openauthjs/openauth/ui/theme"
   *
   * issuer({
   *   theme: THEME_SST
   *   // ...
   * })
   * ```
   *
   * Or define your own.
   *
   * ```ts title="issuer.ts"
   * import type { Theme } from "@openauthjs/openauth/ui/theme"
   *
   * const MY_THEME: Theme = {
   *   // ...
   * }
   *
   * issuer({
   *   theme: MY_THEME
   *   // ...
   * })
   * ```
   */
  theme?: Theme
  /**
   * Fixed issuer URL, e.g. `https://auth.example.com`.
   *
   * When set, it is used as the `iss` claim of issued tokens, in the
   * `/.well-known/oauth-authorization-server` document and when verifying
   * tokens. Request-derived values (Host, `X-Forwarded-Host`,
   * `X-Forwarded-Proto`, `X-Forwarded-Port`) are then ignored for the issuer
   * and for the default redirect_uri allow check.
   *
   * When not set, the issuer is derived from the request URL and forwarded
   * headers (legacy behaviour).
   */
  issuer?: string
  /**
   * Enable the device authorization grant (RFC 8628) for clients registered
   * in `clientDb` with the `urn:ietf:params:oauth:grant-type:device_code`
   * grant. Adds `/device_authorization`, `/activate` (en/ar) and the grant
   * on `/token`. Requires `clientDb`.
   */
  device?: DeviceFlowOptions
  /**
   * PKCE policy. Only `S256` is ever accepted.
   */
  pkce?: {
    /**
     * Require PKCE on `/authorize` (response_type=code) for clients that are
     * registered in `clientDb` without a client secret (public clients).
     * Confidential clients and clients not registered in `clientDb` are not
     * affected.
     * @default false
     */
    requireForPublicClients?: boolean
  }
  /**
   * Set the TTL, in seconds, for access and refresh tokens.
   *
   * @example
   * ```ts
   * {
   *   ttl: {
   *     access: 60 * 60 * 24 * 30,
   *     refresh: 60 * 60 * 24 * 365
   *   }
   * }
   * ```
   */
  ttl?: {
    /**
     * Interval in seconds where the access token is valid.
     * @default 30d
     */
    access?: number
    /**
     * Interval in seconds where the refresh token is valid.
     * @default 1y
     */
    refresh?: number
    /**
     * Interval in seconds where refresh token reuse is allowed. This helps mitigrate
     * concurrency issues.
     * @default 60s
     */
    reuse?: number
    /**
     * Interval in seconds to retain refresh tokens for reuse detection.
     * @default 0s
     */
    retention?: number
  }
  /**
   * Optionally, configure the UI that's displayed when the user visits the root URL of the
   * of the OpenAuth server.
   *
   * ```ts title="issuer.ts"
   * import { Select } from "@openauthjs/openauth/ui/select"
   *
   * issuer({
   *   select: Select({
   *     providers: {
   *       github: { hide: true },
   *       google: { display: "Google" }
   *     }
   *   })
   *   // ...
   * })
   * ```
   *
   * @default Select()
   */
  select?(providers: Record<string, string>, req: Request): Promise<Response>
  /**
   * @internal
   */
  start?(req: Request): Promise<void>
  /**
   * The success callback that's called when the user completes the flow.
   *
   * This is called after the user has been redirected back to your app after the OAuth flow.
   *
   * @example
   * ```ts
   * {
   *   success: async (ctx, value) => {
   *     let userID
   *     if (value.provider === "password") {
   *       console.log(value.email)
   *       userID = ... // lookup user or create them
   *     }
   *     if (value.provider === "github") {
   *       console.log(value.tokenset.access)
   *       userID = ... // lookup user or create them
   *     }
   *     return ctx.subject("user", {
   *       userID
   *     })
   *   },
   *   // ...
   * }
   * ```
   */
  success(
    response: OnSuccessResponder<SubjectPayload<Subjects>>,
    input: Result,
    req: Request,
    c?: Context,
  ): Promise<Response>
  /**
   * Render the response for an unrecoverable sign-in state. Defaults to a
   * friendly, localized "Start sign-in again" page (see `restart`).
   */
  error?(
    error: UnknownStateError,
    req: Request,
    render?: RenderOptions,
  ): Promise<Response>
  /**
   * The friendly page shown when a sign-in can't be resumed links back to the
   * app that started it (origin of the flow's redirect_uri). When that client
   * is unknown (e.g. a bookmarked `/password/authorize`), it links here.
   */
  restart?: {
    /** e.g. `https://app.example.com`. Defaults to `/`. */
    fallbackUrl?: string
  }
  /**
   * Override the logic for whether a client request is allowed to call the issuer.
   *
   * By default, it uses the following:
   *
   * - Allow if the `redirectURI` is localhost.
   * - Compare `redirectURI` to the request's hostname or the `x-forwarded-host` header. If they
   *   are from the same sub-domain level, then allow.
   *
   * @example
   * ```ts
   * {
   *   allow: async (input, req) => {
   *     // Allow all clients
   *     return true
   *   }
   * }
   * ```
   */
  allow?(
    input: {
      clientID: string
      redirectURI: string
      audience?: string
    },
    req: Request,
    c?: Context,
  ): Promise<boolean>
  /**
   * D1 database for client credentials (optional).
   * If provided, enables client authentication for confidential clients.
   *
   * @example
   * ```ts
   * issuer({
   *   clientDb: env.AUTH_DB,
   *   // ... other config
   * })
   * ```
   */
  clientDb?: D1Database
  /**
   * Audit configuration for token usage logging (optional).
   * Provides async, non-blocking audit logging to D1.
   *
   * @example
   * ```ts
   * issuer({
   *   audit: {
   *     service: new AuditService({ database: env.AUTH_DB }),
   *     hooks: {
   *       onTokenGenerated: true,
   *       onTokenRefreshed: true,
   *       onTokenRevoked: true,
   *       onTokenReused: true
   *     }
   *   }
   * })
   * ```
   */
  audit?: {
    service: AuditService
    hooks?: {
      onTokenGenerated?: boolean
      onTokenRefreshed?: boolean
      onTokenRevoked?: boolean
      onTokenReused?: boolean
    }
  }
  /**
   * CORS configuration for cross-origin requests (optional).
   * Applies globally to all endpoints.
   *
   * @example
   * ```ts
   * issuer({
   *   cors: {
   *     origins: env.ALLOWED_ORIGINS.split(','),
   *     credentials: true
   *   }
   * })
   * ```
   */
  cors?: {
    origins: string[]
    credentials?: boolean
    methods?: string[]
    headers?: string[]
    maxAge?: number
  }
  /**
   * M2M (Machine-to-Machine) authentication configuration (optional).
   * Enables OAuth 2.0 Client Credentials Grant (RFC 6749 Section 4.4).
   *
   * Requires `clientDb` to be configured for client authentication.
   *
   * @example
   * ```ts
   * issuer({
   *   clientDb: env.AUTH_DB,
   *   m2m: {
   *     ttl: 3600, // 1 hour token lifetime
   *     includeTenantId: true
   *   }
   * })
   * ```
   */
  m2m?: M2MConfig
}

/**
 * Create an OpenAuth server, a Hono app.
 */
export function issuer<
  Providers extends Record<string, Provider<any>>,
  Subjects extends SubjectSchema,
  Result = {
    [key in keyof Providers]: Prettify<
      {
        provider: key
      } & (Providers[key] extends Provider<infer T> ? T : {})
    >
  }[keyof Providers],
>(input: IssuerInput<Providers, Subjects, Result>) {
  // Default TTL constants (in seconds)
  const DEFAULT_ACCESS_TOKEN_TTL = 60 * 60 * 24 * 30 // 30 days
  const DEFAULT_REFRESH_TOKEN_TTL = 60 * 60 * 24 * 365 // 1 year
  const DEFAULT_REFRESH_REUSE_WINDOW = 60 // 60 seconds
  const DEFAULT_REFRESH_RETENTION = 0 // No retention
  const AUTHORIZATION_CODE_TTL = 60 // 60 seconds
  const AUTHORIZATION_COOKIE_TTL = 60 * 60 * 24 // 24 hours

  const error =
    input.error ??
    async function (
      err: UnknownStateError,
      req: Request,
      render?: RenderOptions,
    ) {
      return unknownStateResponse(
        err,
        req,
        input.restart?.fallbackUrl,
        render?.theme,
      )
    }
  const configuredIssuer = normalizeIssuer(input.issuer)
  const ttlAccess = input.ttl?.access ?? DEFAULT_ACCESS_TOKEN_TTL
  const ttlRefresh = input.ttl?.refresh ?? DEFAULT_REFRESH_TOKEN_TTL
  const ttlRefreshReuse = input.ttl?.reuse ?? DEFAULT_REFRESH_REUSE_WINDOW
  const ttlRefreshRetention = input.ttl?.retention ?? DEFAULT_REFRESH_RETENTION
  const select = lazy(() => input.select ?? Select())
  const allow = lazy(
    () =>
      input.allow ??
      (async (input: any, req: Request) => {
        const parsed = new URL(input.redirectURI)
        // The domain rule only applies to web redirects
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
          return false
        const redir = parsed.hostname
        if (redir === "localhost" || redir === "127.0.0.1") {
          return true
        }
        // When a fixed issuer is configured, never trust X-Forwarded-Host
        const forwarded = configuredIssuer
          ? undefined
          : req.headers.get("x-forwarded-host")
        const host = forwarded
          ? new URL(`https://${forwarded}`).hostname
          : new URL(req.url).hostname

        return isDomainMatch(redir, host)
      }),
  )

  let storage = input.storage
  if (process.env.OPENAUTH_STORAGE) {
    const parsed = JSON.parse(process.env.OPENAUTH_STORAGE)
    if (parsed.type === "dynamo") storage = DynamoStorage(parsed.options)
    if (parsed.type === "memory") storage = MemoryStorage()
    if (parsed.type === "cloudflare")
      throw new Error(
        "Cloudflare storage cannot be configured through env because it requires bindings.",
      )
  }
  if (!storage)
    throw new Error(
      "Store is not configured. Either set the `storage` option or set `OPENAUTH_STORAGE` environment variable.",
    )
  const flowStorage: StorageAdapter = storage
  const allSigning = lazy(() =>
    Promise.all([signingKeys(storage), legacySigningKeys(storage)]).then(
      ([a, b]) => [...a, ...b],
    ),
  )
  const allEncryption = lazy(() => encryptionKeys(storage))
  const signingKey = lazy(() => allSigning().then((all) => all[0]))
  const encryptionKey = lazy(() => allEncryption().then((all) => all[0]))

  // Initialize client authentication if clientDb is provided
  let clientAuthenticator: ClientAuthenticator | undefined
  let clientAdapter: ClientD1Adapter | undefined
  if (input.clientDb) {
    clientAdapter = new ClientD1Adapter(input.clientDb)
    clientAuthenticator = new ClientAuthenticator({
      adapter: clientAdapter,
    })
  }

  // Initialize revocation service
  const revocationService = new RevocationService({
    storage,
    revocationTTL: ttlAccess, // Match access token TTL
  })

  const auth: Omit<ProviderOptions<any>, "name"> = {
    async success(ctx: Context, properties: any, successOpts) {
      return await input.success(
        {
          async subject(type, properties, subjectOpts) {
            const authorization = await getAuthorization(ctx)
            const subject = subjectOpts?.subject
              ? subjectOpts.subject
              : await resolveSubject(type, properties)
            await successOpts?.invalidate?.(
              await resolveSubject(type, properties),
            )
            if (authorization.response_type === "token") {
              const location = new URL(authorization.redirect_uri)
              const tokens = await generateTokens(ctx, {
                subject,
                type: type as string,
                properties,
                clientID: authorization.client_id,
                ttl: {
                  access: subjectOpts?.ttl?.access ?? ttlAccess,
                  refresh: subjectOpts?.ttl?.refresh ?? ttlRefresh,
                },
                authTime: Date.now(),
              })
              location.hash = new URLSearchParams({
                access_token: tokens.access,
                refresh_token: tokens.refresh,
                state: authorization.state || "",
              }).toString()
              await finishFlow(ctx)
              return ctx.redirect(location.toString(), 302)
            }
            if (authorization.response_type === "code") {
              const code = crypto.randomUUID()
              await Storage.set(
                storage,
                ["oauth:code", code],
                {
                  type,
                  properties,
                  subject,
                  redirectURI: authorization.redirect_uri,
                  clientID: authorization.client_id,
                  pkce: authorization.pkce,
                  ttl: {
                    access: subjectOpts?.ttl?.access ?? ttlAccess,
                    refresh: subjectOpts?.ttl?.refresh ?? ttlRefresh,
                  },
                  // The user just authenticated (OIDC auth_time)
                  authTime: Date.now(),
                },
                AUTHORIZATION_CODE_TTL,
              )
              const location = new URL(authorization.redirect_uri)
              location.searchParams.set("code", code)
              location.searchParams.set("state", authorization.state || "")
              await finishFlow(ctx)
              return ctx.redirect(location.toString(), 302)
            }
            throw new OauthError(
              "invalid_request",
              `Unsupported response_type: ${authorization.response_type}`,
            )
          },
        },
        {
          provider: ctx.get("provider"),
          ...properties,
        },
        ctx.req.raw,
        ctx,
      )
    },
    forward(ctx, response) {
      return ctx.newResponse(
        response.body,
        response.status as any,
        Object.fromEntries(response.headers.entries()),
      )
    },
    async set(ctx, key, maxAge, value) {
      const cookieOptions = {
        maxAge,
        httpOnly: true,
        ...(ctx.req.url.startsWith("https://")
          ? { secure: true, sameSite: "None" as const }
          : {}),
      }
      if (key === "authorization") {
        setCookie(ctx, key, await encrypt(value), cookieOptions)
        return
      }
      const flow = await loadFlow(ctx)
      if (flow?.record && flow.bound && !flow.record.completedAt) {
        // Inside a live flow, provider state is kept per flow (encrypted, so
        // codes and password hashes are never readable in storage) and the
        // cookie is tagged with the flow: an OAuth callback, which comes back
        // without ?auth_flow=, recovers its own flow from it, and the cookie
        // can stand in for a storage read that lags behind.
        const sealed = await encrypt(value)
        flow.record.provider = { ...flow.record.provider, [key]: sealed }
        setCookie(
          ctx,
          key,
          await encrypt({ [PROVIDER_FLOW_TAG]: flow.id, v: value }),
          cookieOptions,
        )
        await saveFlow(flow.id, flow.record)
        return
      }
      setCookie(ctx, key, await encrypt(value), cookieOptions)
    },
    async get(ctx: Context, key: string) {
      const raw = getCookie(ctx, key)
      const decoded = raw
        ? await decrypt(raw).catch((ex) => {
            console.error("failed to decrypt", key, ex)
          })
        : undefined
      if (key === "authorization") return decoded
      const tagged =
        decoded &&
        typeof decoded === "object" &&
        typeof decoded[PROVIDER_FLOW_TAG] === "string"
      const cookieFlow: string | undefined = tagged
        ? decoded[PROVIDER_FLOW_TAG]
        : undefined
      const cookieValue = tagged ? decoded.v : decoded

      // A callback without ?auth_flow= (OAuth redirect): adopt the flow the
      // provider state was written for, so the code goes to that flow's client.
      if (!ctx.req.query(FLOW_PARAM) && cookieFlow && isFlowId(cookieFlow)) {
        if (ctx.get("oauthFlowId") !== cookieFlow) {
          ctx.set("oauthFlowId", cookieFlow)
          ctx.set("oauthFlow", undefined)
        }
      }

      const flow = await loadFlow(ctx)
      if (flow?.record && flow.bound && !flow.record.completedAt) {
        const sealed = flow.record.provider?.[key]
        if (typeof sealed === "string") {
          const value = await decrypt(sealed).catch(() => undefined)
          if (value !== undefined) return value
        }
        // Storage lag: the cookie of this same flow is just as good.
        if (cookieFlow === flow.id) return cookieValue
        // Never use another tab's progress.
        return undefined
      }
      if (flow) {
        // Flow id present but no usable record (lag / expired): only this
        // flow's cookie, or a legacy untagged cookie.
        if (cookieFlow) return cookieFlow === flow.id ? cookieValue : undefined
        return cookieValue
      }
      return cookieValue
    },
    async unset(ctx: Context, key: string) {
      deleteCookie(ctx, key)
      if (key === "authorization") return
      const flow = await loadFlow(ctx)
      if (flow?.record && flow.bound && flow.record.provider?.[key]) {
        delete flow.record.provider[key]
        await saveFlow(flow.id, flow.record)
      }
    },
    async invalidate(subject: string) {
      // Resolve the scan in case modifications interfere with iteration
      const keys = await Array.fromAsync(
        Storage.scan(this.storage, ["oauth:refresh", subject]),
      )
      for (const [key] of keys) {
        await Storage.remove(this.storage, key)
      }
    },
    storage,
  }

  type LoadedFlow = {
    id: string
    record?: FlowRecord<AuthorizationState>
    /** The record is bound to this browser's `oa_flow_bind` cookie. */
    bound: boolean
  }

  /** The flow named by `?auth_flow=`, loaded once per request. */
  async function loadFlow(ctx: Context): Promise<LoadedFlow | undefined> {
    const cached = ctx.get("oauthFlow") as LoadedFlow | null | undefined
    if (cached !== undefined) return cached ?? undefined
    const id =
      ctx.req.query(FLOW_PARAM) ||
      (ctx.get("oauthFlowId") as string | undefined)
    let result: LoadedFlow | undefined
    if (id) {
      result = { id, bound: false }
      if (isFlowId(id)) {
        const record = await Storage.get<FlowRecord<AuthorizationState>>(
          flowStorage,
          flowKey(id),
        )
        if (record && record.v === FLOW_RECORD_VERSION) {
          result.record = record
          const secret = getCookie(ctx, FLOW_BIND_COOKIE)
          result.bound =
            isBindSecret(secret) &&
            timingSafeCompare(await bindingHash(secret), record.binding)
        }
      }
    }
    ctx.set("oauthFlow", result ?? null)
    return result
  }

  async function saveFlow(id: string, record: FlowRecord<AuthorizationState>) {
    const ttl = Math.max(60, Math.ceil((record.expiresAt - Date.now()) / 1000))
    await Storage.set(flowStorage, flowKey(id), record, ttl)
  }

  function flowError(
    reason: UnknownStateError["reason"],
    authorization?: AuthorizationState,
  ) {
    return new UnknownStateError({
      reason,
      restartUrl: restartUrlFor(authorization?.redirect_uri),
      locale: localeHintFor(authorization?.redirect_uri),
    })
  }

  async function getAuthorization(ctx: Context) {
    const flow = await loadFlow(ctx)
    if (flow) {
      // A flow id in the URL pins this request to that flow: never fall back
      // to another tab's authorization.
      if (flow.record && flow.bound) {
        if (flow.record.completedAt)
          throw flowError("completed", flow.record.authorization)
        return flow.record.authorization
      }
      // Storage may lag right after /authorize: accept the legacy cookie, but
      // only when it was written for this same flow (it is browser-bound).
      const cookie = (await auth.get(ctx, "authorization")) as
        | AuthorizationState
        | undefined
      if (cookie?.flow && cookie.flow === flow.id) return cookie
      throw flowError(
        flow.record ? "mismatch" : "expired",
        flow.record?.authorization,
      )
    }
    const match =
      (await auth.get(ctx, "authorization")) || ctx.get("authorization")
    if (!match) throw new UnknownStateError({ reason: "missing" })
    return match as AuthorizationState
  }

  /**
   * Called once a code/token was issued. Marks the flow completed (kept for a
   * while so a resubmitted form sends the user back to the app instead of
   * failing) and removes the legacy cookie only when it belongs to this flow.
   */
  async function finishFlow(ctx: Context) {
    const flow = await loadFlow(ctx)
    if (!flow) {
      deleteCookie(ctx, "authorization")
      return
    }
    if (flow.record && flow.bound) {
      const now = Date.now()
      flow.record = {
        ...flow.record,
        completedAt: now,
        provider: undefined,
        expiresAt: now + FLOW_COMPLETED_TTL * 1000,
      }
      ctx.set("oauthFlow", flow)
      await saveFlow(flow.id, flow.record)
    }
    const cookie = (await auth.get(ctx, "authorization")) as
      | AuthorizationState
      | undefined
    if (cookie?.flow === flow.id) deleteCookie(ctx, "authorization")
  }

  /** Start a flow for a validated authorization; returns its id. */
  async function startFlow(c: Context, authorization: AuthorizationState) {
    const https = c.req.url.startsWith("https://")
    const cookieOptions = {
      httpOnly: true,
      path: "/",
      maxAge: AUTHORIZATION_COOKIE_TTL,
      ...(https ? { secure: true, sameSite: "None" as const } : {}),
    }
    let secret = getCookie(c, FLOW_BIND_COOKIE)
    if (!isBindSecret(secret)) secret = newBindSecret()
    // Re-set on every /authorize so the binding outlives every open flow.
    setCookie(c, FLOW_BIND_COOKIE, secret, cookieOptions)
    const id = newFlowId()
    const now = Date.now()
    await Storage.set(
      flowStorage,
      flowKey(id),
      {
        v: FLOW_RECORD_VERSION,
        authorization,
        binding: await bindingHash(secret),
        createdAt: now,
        expiresAt: now + AUTHORIZATION_COOKIE_TTL * 1000,
      } satisfies FlowRecord<AuthorizationState>,
      AUTHORIZATION_COOKIE_TTL,
    )
    return id
  }

  async function encrypt(value: any) {
    return await new CompactEncrypt(
      new TextEncoder().encode(JSON.stringify(value)),
    )
      .setProtectedHeader({ alg: "RSA-OAEP-512", enc: "A256GCM" })
      .encrypt(await encryptionKey().then((k) => k.public))
  }

  async function resolveSubject(type: string, properties: any) {
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

  async function generateTokens(
    ctx: Context,
    value: {
      type: string
      properties: any
      subject: string
      clientID: string
      ttl: {
        access: number
        refresh: number
      }
      timeUsed?: number
      nextToken?: string
      /**
       * When the user last authenticated (ms). Kept on the refresh token, so
       * refreshed access tokens report the original sign-in, not the refresh.
       * Absent for tokens issued before it was recorded and for clients.
       */
      authTime?: number
    },
    opts?: {
      generateRefreshToken?: boolean
    },
  ) {
    const refreshToken = value.nextToken ?? crypto.randomUUID()
    if (opts?.generateRefreshToken ?? true) {
      /**
       * Generate and store the next refresh token after the one we are currently returning.
       * Reserving these in advance avoids concurrency issues with multiple refreshes.
       *
       * The access token includes a `jti` (JWT ID) claim which is used for token revocation tracking.
       * This allows access tokens to be revoked before expiration via the /token/revoke endpoint (RFC 7009).
       * The jti is stored in the revocation list when a token is explicitly revoked, and checked during
       * token introspection to determine if the token is still active.
       */
      const refreshValue = {
        ...value,
        nextToken: crypto.randomUUID(),
      }
      delete refreshValue.timeUsed
      await Storage.set(
        storage!,
        ["oauth:refresh", value.subject, refreshToken],
        refreshValue,
        value.ttl.refresh,
      )
    }
    const accessTimeUsed = Math.floor((value.timeUsed ?? Date.now()) / 1000)
    const tokens = {
      access: await new SignJWT({
        mode: "access",
        type: value.type,
        properties: value.properties,
        jti: crypto.randomUUID(),
        aud: value.clientID,
        iss: issuer(ctx),
        sub: value.subject,
        // OIDC auth_time (seconds): lets resource servers demand a recent
        // sign-in for sensitive actions (e.g. account deletion)
        ...(value.authTime
          ? { auth_time: Math.floor(value.authTime / 1000) }
          : {}),
      })
        .setIssuedAt(accessTimeUsed)
        .setExpirationTime(Math.floor(accessTimeUsed + value.ttl.access))
        .setProtectedHeader(
          await signingKey().then((k) => ({
            alg: k.alg,
            kid: k.id,
            typ: "JWT",
          })),
        )
        .sign(await signingKey().then((item) => item.private)),
      expiresIn: Math.floor(
        accessTimeUsed + value.ttl.access - Date.now() / 1000,
      ),
      refresh: [value.subject, refreshToken].join(":"),
    }

    // Fire audit event for token generation if configured
    if (input.audit?.hooks?.onTokenGenerated) {
      void input.audit.service.logTokenUsage({
        token_id: refreshToken,
        subject: value.subject,
        event_type: "generated",
        client_id: value.clientID,
        timestamp: Date.now(),
      })
    }

    return tokens
  }

  async function decrypt(value: string) {
    return JSON.parse(
      new TextDecoder().decode(
        await compactDecrypt(
          value,
          await encryptionKey().then((v) => v.private),
        ).then((value) => value.plaintext),
      ),
    )
  }

  function issuer(ctx: Context) {
    if (configuredIssuer) return configuredIssuer
    return new URL(getRelativeUrl(ctx, "/")).origin
  }

  const app = new Hono<{
    Variables: {
      authorization: AuthorizationState
      resolvedTheme?: Theme
    }
  }>().use(logger())

  // The theme travels with the request. The enterprise issuer has already set
  // this request's tenant theme (and tenant context) when it mounts or forwards
  // to this app.
  app.use("*", async (c, next) => {
    inheritForwarded(c, [RESOLVED_THEME_KEY, "enterpriseRequestContext"])
    if (input.theme && !c.get(RESOLVED_THEME_KEY))
      c.set(RESOLVED_THEME_KEY, input.theme)
    await next()
  })

  // Device authorization grant (RFC 8628), see device.ts
  const deviceToken =
    input.device && clientAdapter
      ? registerDeviceFlow(
          app,
          {
            storage,
            clients: clientAdapter,
            issuer,
            generateTokens: (c, grant) => generateTokens(c, grant),
          },
          input.device,
        )
      : undefined

  // Apply global CORS if configured
  if (input.cors) {
    app.use(
      "*",
      cors({
        origin: input.cors.origins,
        credentials: input.cors.credentials ?? true,
        allowMethods: input.cors.methods ?? [
          "GET",
          "POST",
          "PUT",
          "DELETE",
          "OPTIONS",
        ],
        allowHeaders: input.cors.headers ?? ["Content-Type", "Authorization"],
        maxAge: input.cors.maxAge,
      }),
    )
  }

  for (const [name, value] of Object.entries(input.providers)) {
    const route = new Hono<any>()
    route.use(async (c, next) => {
      c.set("provider", name)
      await next()
    })
    value.init(route, {
      name,
      ...auth,
    })
    app.route(`/${name}`, route)
  }

  app.get(
    "/.well-known/jwks.json",
    cors({
      origin: "*",
      allowHeaders: ["*"],
      allowMethods: ["GET"],
      credentials: false,
    }),
    async (c) => {
      const all = await allSigning()
      return c.json({
        keys: all.map((item) => ({
          ...item.jwk,
          alg: item.alg,
          exp: item.expired
            ? Math.floor(item.expired.getTime() / 1000)
            : undefined,
        })),
      })
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
      const iss = issuer(c)
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
          ...(deviceToken ? [DEVICE_CODE_GRANT] : []),
        ],
        ...(deviceToken ? deviceDiscovery(iss, input.device!) : {}),
      })
    },
  )

  app.post(
    "/token",
    cors({
      origin: "*",
      allowHeaders: ["*"],
      allowMethods: ["POST"],
      credentials: false,
    }),
    async (c) => {
      const form = await c.req.formData()
      const grantType = form.get("grant_type")

      if (grantType === DEVICE_CODE_GRANT && deviceToken) {
        return deviceToken(c, form)
      }

      if (grantType === "authorization_code") {
        const code = form.get("code")
        if (!code)
          return c.json(
            {
              error: "invalid_request",
              error_description: "Missing code",
            },
            400,
          )
        const key = ["oauth:code", code.toString()]
        const payload = await Storage.get<{
          type: string
          properties: any
          clientID: string
          redirectURI: string
          subject: string
          ttl: {
            access: number
            refresh: number
          }
          pkce?: AuthorizationState["pkce"]
        }>(storage, key)
        if (!payload) {
          return c.json(
            {
              error: "invalid_grant",
              error_description: "Authorization code has been used or expired",
            },
            400,
          )
        }
        if (payload.redirectURI !== form.get("redirect_uri")) {
          return c.json(
            {
              error: "invalid_redirect_uri",
              error_description: "Redirect URI mismatch",
            },
            400,
          )
        }
        if (payload.clientID !== form.get("client_id")) {
          return c.json(
            {
              error: "unauthorized_client",
              error_description:
                "Client is not authorized to use this authorization code",
            },
            403,
          )
        }

        if (payload.pkce) {
          const codeVerifier = form.get("code_verifier")?.toString()
          if (!codeVerifier)
            return c.json(
              {
                error: "invalid_grant",
                error_description: "Missing code_verifier",
              },
              400,
            )

          if (
            !(await validatePKCE(
              codeVerifier,
              payload.pkce.challenge,
              payload.pkce.method,
            ))
          ) {
            return c.json(
              {
                error: "invalid_grant",
                error_description: "Code verifier does not match",
              },
              400,
            )
          }
        }
        const tokens = await generateTokens(c, payload)
        await Storage.remove(storage, key)
        return c.json({
          access_token: tokens.access,
          token_type: "bearer",
          expires_in: tokens.expiresIn,
          refresh_token: tokens.refresh,
        })
      }

      if (grantType === "refresh_token") {
        const refreshToken = form.get("refresh_token")
        if (!refreshToken)
          return c.json(
            {
              error: "invalid_request",
              error_description: "Missing refresh_token",
            },
            400,
          )
        const splits = refreshToken.toString().split(":")
        const token = splits.pop()!
        const subject = splits.join(":")
        const key = ["oauth:refresh", subject, token]
        const payload = await Storage.get<{
          type: string
          properties: any
          clientID: string
          subject: string
          ttl: {
            access: number
            refresh: number
          }
          nextToken: string
          timeUsed?: number
        }>(storage, key)
        if (!payload) {
          return c.json(
            {
              error: "invalid_grant",
              error_description: "Refresh token has been used or expired",
            },
            400,
          )
        }
        // SECURITY: if the caller identifies itself (client_id in the form or
        // HTTP Basic auth), it must be the client the token was issued to.
        // Callers that send no client_id keep working (legacy behaviour).
        // Checked before any reuse bookkeeping so a mismatched request does
        // not consume the token.
        const presentedClientIds = getPresentedClientIds(c, form)
        if (
          presentedClientIds.length > 0 &&
          presentedClientIds.some((id) => id !== payload.clientID)
        ) {
          return c.json(
            {
              error: "invalid_grant",
              error_description: "Refresh token was not issued to this client",
            },
            400,
          )
        }
        const generateRefreshToken = payload.timeUsed === undefined
        if (ttlRefreshReuse <= 0) {
          // no reuse interval, remove the refresh token immediately
          await Storage.remove(storage, key)
        } else if (payload.timeUsed === undefined) {
          payload.timeUsed = Date.now()
          await Storage.set(
            storage,
            key,
            payload,
            ttlRefreshReuse + ttlRefreshRetention,
          )
        } else if (Date.now() > payload.timeUsed + ttlRefreshReuse * 1000) {
          // token was reused past the allowed interval
          await auth.invalidate(subject)

          // Fire audit event for token reuse detection if configured
          if (input.audit?.hooks?.onTokenReused) {
            void input.audit.service.logTokenUsage({
              token_id: token,
              subject,
              event_type: "reused",
              client_id: payload.clientID,
              timestamp: Date.now(),
            })
          }

          return c.json(
            {
              error: "invalid_grant",
              error_description: "Refresh token has been used or expired",
            },
            400,
          )
        }
        const tokens = await generateTokens(c, payload, {
          generateRefreshToken,
        })

        // Fire audit event for token refresh if configured
        if (input.audit?.hooks?.onTokenRefreshed) {
          void input.audit.service.logTokenUsage({
            token_id: token,
            subject,
            event_type: "refreshed",
            client_id: payload.clientID,
            timestamp: Date.now(),
          })
        }

        return c.json({
          access_token: tokens.access,
          token_type: "bearer",
          refresh_token: tokens.refresh,
          expires_in: tokens.expiresIn,
        })
      }

      if (grantType === "client_credentials") {
        const provider = form.get("provider")

        if (!provider) {
          // ============================================
          // M2M CLIENT CREDENTIALS FLOW (RFC 6749 Section 4.4)
          // ============================================
          // When no provider is specified, this is a pure M2M flow
          // using client_id/client_secret from the clientDb.

          if (!clientAuthenticator) {
            return c.json(
              {
                error: "unsupported_grant_type",
                error_description:
                  "M2M authentication requires clientDb configuration",
              },
              400,
            )
          }

          // Extract client credentials (Basic auth or POST body)
          const credentials = extractClientCredentials(c, form)
          if (!credentials.clientId || !credentials.clientSecret) {
            return c.json(
              {
                error: "invalid_request",
                error_description: "Missing client credentials",
              },
              400,
            )
          }

          // Authenticate client
          const authResult = await clientAuthenticator.authenticateClient(
            credentials.clientId,
            credentials.clientSecret,
          )

          if (!authResult.client) {
            return c.json(
              {
                error: "invalid_client",
                error_description: "Client authentication failed",
              },
              401,
            )
          }

          const client = authResult.client

          // Verify client has client_credentials grant type
          const allowedGrants = client.grant_types || []
          if (!allowedGrants.includes("client_credentials")) {
            return c.json(
              {
                error: "unauthorized_client",
                error_description:
                  "Client not authorized for client_credentials grant",
              },
              403,
            )
          }

          // Parse and validate scopes
          const requestedScopes = parseScopes(form.get("scope")?.toString())
          const allowedScopes = client.scopes || []

          const scopeResult = validateScopes(requestedScopes, allowedScopes)
          if (!scopeResult.valid) {
            return c.json(
              {
                error: "invalid_scope",
                error_description: `Scope(s) not allowed: ${scopeResult.denied.join(", ")}`,
              },
              400,
            )
          }

          // Generate M2M token
          const { access_token, expires_in } = await generateM2MToken({
            clientId: credentials.clientId,
            tenantId: (client as any).tenant_id,
            scopes: scopeResult.granted,
            issuer: issuer(c),
            signingKey: await signingKey(),
            config: input.m2m,
          })

          // Return token response (no refresh token per RFC 6749)
          return c.json({
            access_token,
            token_type: "Bearer",
            expires_in,
            scope: scopeResult.granted.join(" "),
          })
        }

        // ============================================
        // PROVIDER-BASED CLIENT CREDENTIALS FLOW
        // ============================================
        // When a provider is specified, use the provider's client() method.
        const match = input.providers[provider.toString()]
        if (!match)
          return c.json({ error: "invalid `provider` query parameter" }, 400)
        if (!match.client)
          return c.json(
            { error: "this provider does not support client_credentials" },
            400,
          )
        const clientID = form.get("client_id")
        const clientSecret = form.get("client_secret")
        if (!clientID)
          return c.json({ error: "missing `client_id` form value" }, 400)
        if (!clientSecret)
          return c.json({ error: "missing `client_secret` form value" }, 400)
        const response = await match.client({
          clientID: clientID.toString(),
          clientSecret: clientSecret.toString(),
          params: Object.fromEntries([...form.entries()]) as Record<
            string,
            string
          >,
        })
        return input.success(
          {
            async subject(type, properties, opts) {
              const tokens = await generateTokens(c, {
                type: type as string,
                subject:
                  opts?.subject || (await resolveSubject(type, properties)),
                properties,
                clientID: clientID.toString(),
                ttl: {
                  access: opts?.ttl?.access ?? ttlAccess,
                  refresh: opts?.ttl?.refresh ?? ttlRefresh,
                },
              })
              return c.json({
                access_token: tokens.access,
                refresh_token: tokens.refresh,
              })
            },
          },
          {
            provider: provider.toString(),
            ...response,
          },
          c.req.raw,
          c,
        )
      }

      throw new Error("Invalid grant_type")
    },
  )

  app.get("/authorize", async (c) => {
    const provider = c.req.query("provider")
    const response_type = c.req.query("response_type")
    const redirect_uri = c.req.query("redirect_uri")
    const state = c.req.query("state")
    const client_id = c.req.query("client_id")
    const audience = c.req.query("audience")
    const code_challenge = c.req.query("code_challenge")
    const code_challenge_method = c.req.query("code_challenge_method")
    const authorization: AuthorizationState = {
      response_type,
      redirect_uri,
      state,
      client_id,
      audience,
      pkce:
        code_challenge && code_challenge_method
          ? {
              challenge: code_challenge,
              method: code_challenge_method,
            }
          : undefined,
    } as AuthorizationState
    c.set("authorization", authorization)

    if (!redirect_uri) {
      return c.text("Missing redirect_uri", { status: 400 })
    }

    if (!response_type) {
      throw new MissingParameterError("response_type")
    }

    if (!client_id) {
      throw new MissingParameterError("client_id")
    }

    if (input.start) {
      await input.start(c.req.raw)
    }

    if (
      !(await allow()(
        {
          clientID: client_id,
          redirectURI: redirect_uri,
          audience,
        },
        c.req.raw,
        c,
      ))
    )
      throw new UnauthorizedClientError(client_id, redirect_uri)
    // PKCE: only S256 is supported (and advertised). Reject other methods
    // up-front instead of failing later at the token endpoint.
    if (code_challenge_method && code_challenge_method !== "S256") {
      throw new OauthError(
        "invalid_request",
        "Unsupported code_challenge_method; only S256 is supported",
      )
    }
    // PKCE policy: issuer-wide for public clients, or per client (native apps)
    if (response_type === "code" && !code_challenge && clientAdapter) {
      const registered = await clientAdapter.getClientById(client_id)
      if (clientRequiresPkce(registered, input.pkce)) {
        throw new OauthError(
          "invalid_request",
          "PKCE (code_challenge with S256) is required for this client",
        )
      }
    }
    const flowId = await startFlow(c, authorization)
    await auth.set(c, "authorization", AUTHORIZATION_COOKIE_TTL, {
      ...authorization,
      flow: flowId,
    })
    const flowQuery = new URLSearchParams({ [FLOW_PARAM]: flowId })
    const lang = c.req.query("lang")
    if (lang) flowQuery.set("lang", lang)
    if (provider) return c.redirect(`/${provider}/authorize?${flowQuery}`)
    const providers = Object.keys(input.providers)
    if (providers.length === 1)
      return c.redirect(`/${providers[0]}/authorize?${flowQuery}`)
    // The selection page links to /{provider}/authorize: let it see the flow.
    const selectUrl = new URL(c.req.url)
    selectUrl.searchParams.set(FLOW_PARAM, flowId)
    return auth.forward(
      c,
      await select()(
        Object.fromEntries(
          Object.entries(input.providers).map(([key, value]) => [
            key,
            value.type,
          ]),
        ),
        new Request(selectUrl.toString(), c.req.raw),
        renderOptions(c),
      ),
    )
  })

  app.get("/userinfo", async (c) => {
    const header = c.req.header("Authorization")

    if (!header) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "Missing Authorization header",
        },
        400,
      )
    }

    const [type, token] = header.split(" ")

    if (type !== "Bearer") {
      return c.json(
        {
          error: "invalid_request",
          error_description: "Missing or invalid Authorization header",
        },
        400,
      )
    }

    if (!token) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "Missing token",
        },
        400,
      )
    }

    const result = await jwtVerify<{
      mode: "access"
      type: keyof SubjectSchema
      properties: v1.InferInput<SubjectSchema[keyof SubjectSchema]>
    }>(token, () => signingKey().then((item) => item.public), {
      issuer: issuer(c),
    })

    const validated = await input.subjects[result.payload.type][
      "~standard"
    ].validate(result.payload.properties)

    if (!validated.issues && result.payload.mode === "access") {
      return c.json(validated.value as SubjectSchema)
    }

    return c.json({
      error: "invalid_token",
      error_description: "Invalid token",
    })
  })

  /**
   * Collect the client_id values a token request identifies itself with
   * (form `client_id` and/or the username of HTTP Basic auth).
   */
  function getPresentedClientIds(c: Context, form: FormData): string[] {
    const ids: string[] = []
    const formClientId = form.get("client_id")?.toString()
    if (formClientId) ids.push(formClientId)
    const authHeader = c.req.header("Authorization")
    if (authHeader) {
      const [type, credentials] = authHeader.split(" ")
      if (type === "Basic" && credentials) {
        try {
          const decoded = atob(credentials)
          const colonIndex = decoded.indexOf(":")
          const id =
            colonIndex === -1 ? decoded : decoded.substring(0, colonIndex)
          if (id) ids.push(decodeURIComponentSafe(id))
        } catch {
          // Malformed header: treat as an unknown client
          ids.push("")
        }
      }
    }
    return ids
  }

  /**
   * Helper function to extract and validate client credentials from request.
   * Supports both Authorization header (Basic auth) and form data.
   *
   * @param requireSecret - If true, requires client_secret (for introspection).
   *                        If false, only requires client_id (for revocation with public clients).
   */
  function extractClientCredentials(
    c: Context,
    form: FormData,
    requireSecret: boolean = true,
  ): {
    clientId?: string
    clientSecret?: string
    error?: Response
  } {
    const authHeader = c.req.header("Authorization")
    let clientId: string | undefined
    let clientSecret: string | undefined

    if (authHeader) {
      const [type, credentials] = authHeader.split(" ")
      if (type === "Basic" && credentials) {
        try {
          const decoded = atob(credentials)
          const colonIndex = decoded.indexOf(":")
          if (colonIndex === -1) {
            return {
              error: c.json(
                {
                  error: "invalid_client",
                  error_description: "Invalid client credentials format",
                },
                401,
              ),
            }
          }
          clientId = decoded.substring(0, colonIndex)
          clientSecret = decoded.substring(colonIndex + 1)
        } catch (error) {
          console.error("Failed to decode Basic auth:", error)
          return {
            error: c.json(
              {
                error: "invalid_client",
                error_description: "Invalid Authorization header encoding",
              },
              401,
            ),
          }
        }
      }
    }

    // Fall back to form data if not in header
    if (!clientId || !clientSecret) {
      clientId = form.get("client_id")?.toString()
      clientSecret = form.get("client_secret")?.toString()
    }

    // Validate required credentials based on endpoint type
    if (requireSecret) {
      // Introspection: Requires both client_id and client_secret (confidential clients only)
      if (!clientId || !clientSecret) {
        return {
          error: c.json(
            {
              error: "invalid_request",
              error_description: "Client authentication required",
            },
            401,
          ),
        }
      }
    } else {
      // Revocation: Only requires client_id (public clients allowed)
      if (!clientId) {
        return {
          error: c.json(
            {
              error: "invalid_request",
              error_description: "Missing client_id parameter",
            },
            400,
          ),
        }
      }
    }

    return { clientId, clientSecret }
  }

  /**
   * Simple rate limiting using sliding window.
   * Tracks requests per client_id with configurable limits.
   */
  async function checkRateLimit(
    clientId: string,
    endpoint: string,
    limit: number = 60, // requests per minute
    window: number = 60, // seconds
  ): Promise<boolean> {
    if (!storage) return true // Skip rate limiting if no storage

    const now = Date.now()
    const key = ["ratelimit", endpoint, clientId]

    // Get current request log
    const log = (await Storage.get<number[]>(storage, key)) || []

    // Remove old entries (outside the window)
    const windowStart = now - window * 1000
    const recentRequests = log.filter((timestamp) => timestamp > windowStart)

    // Check if limit exceeded
    if (recentRequests.length >= limit) {
      return false
    }

    // Add current request and save
    recentRequests.push(now)
    await Storage.set(storage, key, recentRequests, window)

    return true
  }

  // RFC 7662: Token Introspection Endpoint
  app.post("/token/introspect", async (c) => {
    // Client authentication is required for introspection
    if (!clientAuthenticator) {
      return c.json(
        {
          error: "unsupported_operation",
          error_description: "Token introspection is not enabled",
        },
        501,
      )
    }

    const form = await c.req.formData()
    const token = form.get("token")?.toString()

    if (!token) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "Missing token parameter",
        },
        400,
      )
    }

    // Extract and validate client credentials
    const credentials = extractClientCredentials(c, form)
    if (credentials.error) {
      return credentials.error
    }

    // Authenticate the client
    // Note: Token introspection typically requires confidential clients (with secrets)
    // since it's used by resource servers to validate tokens
    const authResult = await clientAuthenticator.authenticateClient(
      credentials.clientId!,
      credentials.clientSecret,
    )
    if (!authResult.client) {
      return c.json(
        {
          error: "invalid_client",
          error_description: "Client authentication failed",
        },
        401,
      )
    }
    const client = authResult.client

    // Apply rate limiting (60 requests per minute per client)
    const allowed = await checkRateLimit(
      credentials.clientId!,
      "token_introspect",
    )
    if (!allowed) {
      return c.json(
        {
          error: "slow_down",
          error_description: "Rate limit exceeded. Please try again later.",
        },
        429,
      )
    }

    try {
      // Try to verify as JWT (access token)
      const result = await jwtVerify<{
        mode: "access"
        type: keyof SubjectSchema
        properties: v1.InferInput<SubjectSchema[keyof SubjectSchema]>
      }>(token, () => signingKey().then((item) => item.public), {
        issuer: issuer(c),
      })

      // Extract JTI from token for revocation check
      const tokenId = result.payload.jti as string
      if (!tokenId) {
        return c.json({ active: false })
      }

      /**
       * Authorization Policy (RFC 7662 Section 2.2):
       *
       * Only the client (audience) that the token was issued to is allowed to introspect it.
       * This follows the principle of least privilege - clients should only be able to verify
       * tokens that were issued for their use.
       *
       * Per RFC 7662, when a client attempts to introspect a token they're not authorized to see,
       * the endpoint returns { active: false } rather than an error, preventing information disclosure
       * about the existence or validity of tokens issued to other clients.
       *
       * Alternative policies could include:
       * - Allowing introspection based on client trust levels (e.g., resource servers)
       * - Implementing scope-based authorization for privileged clients
       * - Using token ownership tracking for multi-tenant scenarios
       */
      if (result.payload.aud !== credentials.clientId) {
        // Per RFC 7662, return inactive for tokens the client shouldn't see
        return c.json({ active: false })
      }

      // Check if token has been revoked
      const isRevoked = await revocationService.isAccessTokenRevoked(tokenId)
      if (isRevoked) {
        return c.json({ active: false })
      }

      // Token is active
      return c.json({
        active: true,
        scope: Array.isArray(result.payload.scope)
          ? result.payload.scope.join(" ")
          : result.payload.scope || "", // Use scope from token, or empty string if missing
        client_id: result.payload.aud,
        username: result.payload.sub,
        token_type: "Bearer",
        exp: result.payload.exp,
        iat: result.payload.iat,
        sub: result.payload.sub,
        iss: result.payload.iss,
        aud: result.payload.aud,
      })
    } catch (error) {
      // Token verification failed - could be expired, invalid, or a refresh token
      console.error("Token introspection failed:", error)

      // Return inactive for invalid tokens
      return c.json({ active: false })
    }
  })

  // RFC 7009: Token Revocation Endpoint
  app.post("/token/revoke", async (c) => {
    // Client authentication is required for revocation
    if (!clientAuthenticator) {
      return c.json(
        {
          error: "unsupported_operation",
          error_description: "Token revocation is not enabled",
        },
        501,
      )
    }

    const form = await c.req.formData()
    const token = form.get("token")?.toString()
    const tokenTypeHint = form.get("token_type_hint")?.toString()

    if (!token) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "Missing token parameter",
        },
        400,
      )
    }

    // Extract and validate client credentials
    // Note: requireSecret=false allows public clients (RFC 7009)
    const credentials = extractClientCredentials(c, form, false)
    if (credentials.error) {
      return credentials.error
    }

    // ============================================
    // CLIENT AUTHENTICATION (Public vs Confidential)
    // ============================================
    // RFC 7009: "A client's request must contain a valid client_id,
    // in the case of a public client, or valid client credentials,
    // in the case of a confidential client."

    // SECURITY: clients without a stored secret (public clients) are
    // rejected; a valid client_secret is required.
    const authResult = await clientAuthenticator.authenticateClient(
      credentials.clientId!,
      credentials.clientSecret,
    )

    if (!authResult.client) {
      return c.json(
        {
          error: "invalid_client",
          error_description: "Client authentication failed",
        },
        401,
      )
    }

    const client = authResult.client

    // Apply rate limiting (60 requests per minute per client)
    const allowed = await checkRateLimit(credentials.clientId!, "token_revoke")
    if (!allowed) {
      return c.json(
        {
          error: "slow_down",
          error_description: "Rate limit exceeded. Please try again later.",
        },
        429,
      )
    }

    // Attempt to revoke the token
    try {
      // If hint is refresh_token or token looks like refresh token (has colon separator)
      if (tokenTypeHint === "refresh_token" || token.includes(":")) {
        const splits = token.split(":")
        const tokenId = splits.pop()!
        const subject = splits.join(":")

        await revocationService.revokeRefreshToken(subject, tokenId)

        // Fire audit event if configured
        if (input.audit?.hooks?.onTokenRevoked) {
          void input.audit.service.logTokenUsage({
            token_id: tokenId,
            subject,
            event_type: "revoked",
            client_id: credentials.clientId!,
            timestamp: Date.now(),
          })
        }

        return c.json({}) // Success - return empty response per RFC 7009
      }

      // Otherwise, treat as access token (JWT)
      const result = await jwtVerify<{
        mode: "access"
        type: keyof SubjectSchema
        properties: v1.InferInput<SubjectSchema[keyof SubjectSchema]>
      }>(token, () => signingKey().then((item) => item.public), {
        issuer: issuer(c),
      })

      // SECURITY: Verify token belongs to requesting client
      // This prevents clients from revoking other clients' tokens
      if (result.payload.aud !== credentials.clientId) {
        // Per RFC 7009: Return success even for tokens we can't/won't revoke
        // to prevent information disclosure about token ownership
        return c.json({})
      }

      // Extract JTI from token for revocation
      const tokenId = result.payload.jti as string
      if (!tokenId) {
        // Token doesn't have JTI, can't revoke - but return success per RFC 7009
        return c.json({})
      }

      // Revoke the access token
      await revocationService.revokeAccessToken(tokenId)

      // Optionally revoke all refresh tokens for this subject
      // await revocationService.revokeAllRefreshTokens(result.payload.sub as string)

      // Fire audit event if configured
      if (input.audit?.hooks?.onTokenRevoked) {
        void input.audit.service.logTokenUsage({
          token_id: tokenId,
          subject: result.payload.sub as string,
          event_type: "revoked",
          client_id: credentials.clientId!,
          timestamp: Date.now(),
        })
      }

      return c.json({}) // Success - return empty response per RFC 7009
    } catch (error) {
      // Per RFC 7009, even if revocation fails, return success
      // to prevent information disclosure
      console.error("Token revocation error:", error)
      return c.json({})
    }
  })

  app.onError(async (err, c) => {
    console.error(err)
    if (err instanceof UnknownStateError) {
      return auth.forward(c, await error(err, c.req.raw, renderOptions(c)))
    }
    let authorization: AuthorizationState
    try {
      authorization = await getAuthorization(c)
    } catch (stateErr) {
      // No flow to report the error to: show the friendly restart page
      // instead of letting a second error escape.
      if (stateErr instanceof UnknownStateError)
        return auth.forward(
          c,
          await error(stateErr, c.req.raw, renderOptions(c)),
        )
      throw stateErr
    }
    const url = new URL(authorization.redirect_uri)
    // Never leak internal error details to the client; they are logged above.
    const oauth =
      err instanceof OauthError
        ? err
        : new OauthError("server_error", "Internal server error")
    url.searchParams.set("error", oauth.error)
    url.searchParams.set("error_description", oauth.description)
    // RFC 6749 §4.1.2.1: echo state so the client can match the error to its request
    if (authorization.state) url.searchParams.set("state", authorization.state)
    return c.redirect(url.toString())
  })

  return app
}

/**
 * The response for an unrecoverable sign-in state: a completed flow sends the
 * user back to the app (they are signed in); anything else renders the
 * friendly, localized restart page.
 */
export function unknownStateResponse(
  err: UnknownStateError,
  req: Request,
  fallbackUrl?: string,
  theme?: Theme,
): Response {
  const restartUrl = err.restartUrl || fallbackUrl
  if (err.reason === "completed" && restartUrl) {
    return new Response(null, {
      status: 302,
      headers: { Location: restartUrl, "Cache-Control": "no-store" },
    })
  }
  return RestartPage(req, { restartUrl, locale: err.locale, theme })
}

/**
 * Normalize a configured issuer URL: validates it and strips trailing slashes.
 * Returns undefined when not configured.
 */
export function normalizeIssuer(value?: string): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  // Throws on invalid URLs so misconfiguration fails fast
  const url = new URL(trimmed)
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Invalid issuer URL: ${value}`)
  }
  let end = trimmed.length
  while (end > 0 && trimmed.charCodeAt(end - 1) === 47 /* "/" */) end--
  return trimmed.slice(0, end)
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
