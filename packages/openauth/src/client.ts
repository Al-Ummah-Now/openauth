/**
 * Use the OpenAuth client kick off your OAuth flows, exchange tokens, refresh tokens,
 * and verify tokens.
 *
 * First, create a client.
 *
 * ```ts title="client.ts"
 * import { createClient } from "@openauthjs/openauth/client"
 *
 * const client = createClient({
 *   clientID: "my-client",
 *   issuer: "https://auth.myserver.com"
 * })
 * ```
 *
 * Kick off the OAuth flow by calling `authorize`.
 *
 * ```ts
 * const redirect_uri = "https://myserver.com/callback"
 *
 * const { url } = await client.authorize(
 *   redirect_uri,
 *   "code"
 * )
 * ```
 *
 * When the user completes the flow, `exchange` the code for tokens.
 *
 * ```ts
 * const tokens = await client.exchange(query.get("code"), redirect_uri)
 * ```
 *
 * And `verify` the tokens.
 *
 * ```ts
 * const verified = await client.verify(subjects, tokens.access)
 * ```
 *
 * @packageDocumentation
 */
import {
  createLocalJWKSet,
  errors,
  JSONWebKeySet,
  jwtVerify,
  decodeJwt,
} from "jose"
import { SubjectSchema } from "./subject.js"
import type { v1 } from "@standard-schema/spec"
import {
  AuthRequestError,
  InvalidAccessTokenError,
  InvalidAuthorizationCodeError,
  InvalidRefreshTokenError,
  InvalidSubjectError,
} from "./error.js"
import { generatePKCE } from "./pkce.js"

/**
 * The well-known information for an OAuth 2.0 authorization server.
 * @internal
 */
export interface WellKnown {
  /**
   * The URI to the JWKS endpoint.
   */
  jwks_uri: string
  /**
   * The URI to the token endpoint.
   */
  token_endpoint: string
  /**
   * The URI to the authorization endpoint.
   */
  authorization_endpoint: string
}

/**
 * The tokens returned by the auth server.
 */
export interface Tokens {
  /**
   * The access token.
   */
  access: string
  /**
   * The refresh token.
   */
  refresh: string

  /**
   * The number of seconds until the access token expires.
   */
  expiresIn: number
}

interface ResponseLike {
  json(): Promise<unknown>
  ok: Response["ok"]
}
type FetchLike = (...args: any[]) => Promise<ResponseLike>

/**
 * The challenge that you can use to verify the code.
 */
export type Challenge = {
  /**
   * The state that was sent to the redirect URI.
   */
  state: string
  /**
   * The verifier that was sent to the redirect URI.
   */
  verifier?: string
}

/**
 * Configure the client.
 */
export interface ClientInput {
  /**
   * The client ID. This is just a string to identify your app.
   *
   * If you have a web app and a mobile app, you want to use different client IDs both.
   *
   * @example
   * ```ts
   * {
   *   clientID: "my-client"
   * }
   * ```
   */
  clientID: string
  /**
   * The URL of your OpenAuth server.
   *
   * @example
   * ```ts
   * {
   *   issuer: "https://auth.myserver.com"
   * }
   * ```
   */
  issuer?: string
  /**
   * Optionally, override the internally used fetch function.
   *
   * This is useful if you are using a polyfilled fetch function in your application and you
   * want the client to use it too.
   */
  fetch?: FetchLike
  /**
   * How long, in milliseconds, the issuer's discovery document and JWKS are
   * cached before they are fetched again. The cache is shared by every client
   * in the same process or isolate, keyed by issuer, so creating a client per
   * request does not re-fetch them. A token signed with a key that is not in
   * the cached JWKS, or whose signature the cached key rejects, triggers one
   * early re-fetch (key rotation), at most once every 30 seconds.
   *
   * @default 600000 (10 minutes)
   */
  cacheTTL?: number
  /**
   * The client secret of a confidential client. When set, the authorization
   * code exchange and refresh requests authenticate with HTTP Basic
   * (`client_id:client_secret`). Only for server-side clients: never ship a
   * secret to a browser or an app.
   */
  clientSecret?: string
}

export interface AuthorizeOptions {
  /**
   * Enable the PKCE flow. This is for SPA apps.
   *
   * ```ts
   * {
   *   pkce: true
   * }
   * ```
   *
   * @default false
   */
  pkce?: boolean
  /**
   * The provider you want to use for the OAuth flow.
   *
   * ```ts
   * {
   *   provider: "google"
   * }
   * ```
   *
   * If no provider is specified, the user is directed to a page where they can select from the
   * list of configured providers.
   *
   * If there's only one provider configured, the user will be redirected to that.
   */
  provider?: string
}

export interface AuthorizeResult {
  /**
   * The challenge that you can use to verify the code. This is for the PKCE flow for SPA apps.
   *
   * This is an object that you _stringify_ and store it in session storage.
   *
   * ```ts
   * sessionStorage.setItem("challenge", JSON.stringify(challenge))
   * ```
   */
  challenge: Challenge
  /**
   * The URL to redirect the user to. This starts the OAuth flow.
   *
   * For example, for SPA apps.
   *
   * ```ts
   * location.href = url
   * ```
   */
  url: string
}

/**
 * Returned when the exchange is successful.
 */
export interface ExchangeSuccess {
  /**
   * This is always `false` when the exchange is successful.
   */
  err: false
  /**
   * The access and refresh tokens.
   */
  tokens: Tokens
}

/**
 * Returned when the exchange fails.
 */
export interface ExchangeError {
  /**
   * The type of error that occurred. You can handle this by checking the type.
   *
   * @example
   * ```ts
   * import { InvalidAuthorizationCodeError } from "@openauthjs/openauth/error"
   *
   * console.log(err instanceof InvalidAuthorizationCodeError)
   *```
   */
  err: InvalidAuthorizationCodeError
}

export interface RefreshOptions {
  /**
   * Optionally, pass in the access token.
   */
  access?: string
}

/**
 * Returned when the refresh is successful.
 */
export interface RefreshSuccess {
  /**
   * This is always `false` when the refresh is successful.
   */
  err: false
  /**
   * Returns the refreshed tokens only if they've been refreshed.
   *
   * If they are still valid, this will be `undefined`.
   */
  tokens?: Tokens
}

/**
 * Returned when the refresh fails.
 */
export interface RefreshError {
  /**
   * The type of error that occurred. You can handle this by checking the type.
   *
   * @example
   * ```ts
   * import { InvalidRefreshTokenError } from "@openauthjs/openauth/error"
   *
   * console.log(err instanceof InvalidRefreshTokenError)
   *```
   */
  err: InvalidRefreshTokenError | InvalidAccessTokenError
}

export interface VerifyOptions {
  /**
   * Optionally, pass in the refresh token.
   *
   * If passed in, this will automatically refresh the access token if it has expired.
   */
  refresh?: string
  /**
   * @internal
   */
  issuer?: string
  /**
   * @internal
   */
  audience?: string
  /**
   * Optionally, override the internally used fetch function.
   *
   * This is useful if you are using a polyfilled fetch function in your application and you
   * want the client to use it too.
   */
  fetch?: FetchLike
}

export interface VerifyResult<T extends SubjectSchema> {
  /**
   * This is always `undefined` when the verify is successful.
   */
  err?: undefined
  /**
   * Returns the refreshed tokens only if they’ve been refreshed.
   *
   * If they are still valid, this will be undefined.
   */
  tokens?: Tokens
  /**
   * @internal
   */
  aud: string
  /**
   * The decoded subjects from the access token.
   *
   * Has the same shape as the subjects you defined when creating the issuer.
   */
  subject: {
    [type in keyof T]: { type: type; properties: v1.InferOutput<T[type]> }
  }[keyof T]
}

/**
 * Returned when the verify call fails.
 */
export interface VerifyError {
  /**
   * The type of error that occurred. You can handle this by checking the type.
   *
   * @example
   * ```ts
   * import { InvalidRefreshTokenError } from "@openauthjs/openauth/error"
   *
   * console.log(err instanceof InvalidRefreshTokenError)
   *```
   */
  err: InvalidRefreshTokenError | InvalidAccessTokenError
}

/**
 * Returned by `clientCredentials`, `device`, `revoke` and `userinfo` when they fail.
 */
export interface RequestFailure {
  /**
   * What went wrong. `err.error` is the OAuth error code.
   */
  err: AuthRequestError
}

export interface ClientCredentialsOptions {
  /**
   * The scopes to ask for. The server refuses scopes the client isn't registered with.
   */
  scopes?: string[]
}

/**
 * Returned when the client credentials call is successful.
 */
export interface ClientCredentialsSuccess {
  err: false
  token: {
    /**
     * The access token. There's no refresh token; ask for a new one when it expires.
     */
    access: string
    /**
     * The number of seconds until the token expires.
     */
    expiresIn: number
    /**
     * The scopes the server granted.
     */
    scopes: string[]
  }
}

/**
 * A device authorization the user still has to approve.
 */
export interface DeviceAuthorization {
  /**
   * The secret the device polls with. Never show it.
   */
  deviceCode: string
  /**
   * The code the user types, e.g. `BCDF-GHJK`.
   */
  userCode: string
  /**
   * Where the user types the code. Show it next to the code.
   */
  verificationURI: string
  /**
   * The same page with the code filled in, for a QR code.
   */
  verificationURIComplete?: string
  /**
   * When the codes expire, in milliseconds since the epoch.
   */
  expiresAt: number
  /**
   * The least number of seconds between polls.
   */
  interval: number
}

export interface DevicePollOptions {
  /**
   * Stop waiting, for example when the user leaves the sign-in screen.
   */
  signal?: AbortSignal
}

/**
 * An instance of the OpenAuth client contains the following methods.
 */
export interface Client {
  /**
   * Start the autorization flow. For example, in SSR sites.
   *
   * ```ts
   * const { url } = await client.authorize(<redirect_uri>, "code")
   * ```
   *
   * This takes a redirect URI and the type of flow you want to use. The redirect URI is the
   * location where the user will be redirected to after the flow is complete.
   *
   * Supports both the _code_ and _token_ flows. We recommend using the _code_ flow as it's more
   * secure.
   *
   * :::tip
   * This returns a URL to redirect the user to. This starts the OAuth flow.
   * :::
   *
   * This returns a URL to the auth server. You can redirect the user to the URL to start the
   * OAuth flow.
   *
   * For SPA apps, we recommend using the PKCE flow.
   *
   * ```ts {4}
   * const { challenge, url } = await client.authorize(
   *   <redirect_uri>,
   *   "code",
   *   { pkce: true }
   * )
   * ```
   *
   * This returns a redirect URL and a challenge that you need to use later to verify the code.
   */
  authorize(
    redirectURI: string,
    response: "code" | "token",
    opts?: AuthorizeOptions,
  ): Promise<AuthorizeResult>
  /**
   * Exchange the code for access and refresh tokens.
   *
   * ```ts
   * const exchanged = await client.exchange(<code>, <redirect_uri>)
   * ```
   *
   * You call this after the user has been redirected back to your app after the OAuth flow.
   *
   * :::tip
   * For SSR sites, the code is returned in the query parameter.
   * :::
   *
   * So the code comes from the query parameter in the redirect URI. The redirect URI here is
   * the one that you passed in to the `authorize` call when starting the flow.
   *
   * :::tip
   * For SPA sites, the code is returned through the URL hash.
   * :::
   *
   * If you used the PKCE flow for an SPA app, the code is returned as a part of the redirect URL
   * hash.
   *
   * ```ts {4}
   * const exchanged = await client.exchange(
   *   <code>,
   *   <redirect_uri>,
   *   <challenge.verifier>
   * )
   * ```
   *
   * You also need to pass in the previously stored challenge verifier.
   *
   * This method returns the access and refresh tokens. Or if it fails, it returns an error that
   * you can handle depending on the error.
   *
   * ```ts
   * import { InvalidAuthorizationCodeError } from "@openauthjs/openauth/error"
   *
   * if (exchanged.err) {
   *   if (exchanged.err instanceof InvalidAuthorizationCodeError) {
   *     // handle invalid code error
   *   }
   *   else {
   *     // handle other errors
   *   }
   * }
   *
   * const { access, refresh } = exchanged.tokens
   * ```
   */
  exchange(
    code: string,
    redirectURI: string,
    verifier?: string,
  ): Promise<ExchangeSuccess | ExchangeError>
  /**
   * Refreshes the tokens if they have expired. This is used in an SPA app to maintain the
   * session, without logging the user out.
   *
   * ```ts
   * const next = await client.refresh(<refresh_token>)
   * ```
   *
   * Can optionally take the access token as well. If passed in, this will skip the refresh
   * if the access token is still valid.
   *
   * ```ts
   * const next = await client.refresh(<refresh_token>, { access: <access_token> })
   * ```
   *
   * This returns the refreshed tokens only if they've been refreshed.
   *
   * ```ts
   * if (!next.err) {
   *   // tokens are still valid
   * }
   * if (next.tokens) {
   *   const { access, refresh } = next.tokens
   * }
   * ```
   *
   * Or if it fails, it returns an error that you can handle depending on the error.
   *
   * ```ts
   * import { InvalidRefreshTokenError } from "@openauthjs/openauth/error"
   *
   * if (next.err) {
   *   if (next.err instanceof InvalidRefreshTokenError) {
   *     // handle invalid refresh token error
   *   }
   *   else {
   *     // handle other errors
   *   }
   * }
   * ```
   */
  refresh(
    refresh: string,
    opts?: RefreshOptions,
  ): Promise<RefreshSuccess | RefreshError>
  /**
   * Verify the token in the incoming request.
   *
   * This is typically used for SSR sites where the token is stored in an HTTP only cookie. And
   * is passed to the server on every request.
   *
   * ```ts
   * const verified = await client.verify(<subjects>, <token>)
   * ```
   *
   * This takes the subjects that you had previously defined when creating the issuer.
   *
   * :::tip
   * If the refresh token is passed in, it'll automatically refresh the access token.
   * :::
   *
   * This can optionally take the refresh token as well. If passed in, it'll automatically
   * refresh the access token if it has expired.
   *
   * ```ts
   * const verified = await client.verify(<subjects>, <token>, { refresh: <refresh_token> })
   * ```
   *
   * This returns the decoded subjects from the access token. And the tokens if they've been
   * refreshed.
   *
   * ```ts
   * // based on the subjects you defined earlier
   * console.log(verified.subject.properties.userID)
   *
   * if (verified.tokens) {
   *   const { access, refresh } = verified.tokens
   * }
   * ```
   *
   * Or if it fails, it returns an error that you can handle depending on the error.
   *
   * ```ts
   * import { InvalidRefreshTokenError } from "@openauthjs/openauth/error"
   *
   * if (verified.err) {
   *   if (verified.err instanceof InvalidRefreshTokenError) {
   *     // handle invalid refresh token error
   *   }
   *   else {
   *     // handle other errors
   *   }
   * }
   * ```
   */
  verify<T extends SubjectSchema>(
    subjects: T,
    token: string,
    options?: VerifyOptions,
  ): Promise<VerifyResult<T> | VerifyError>
  /**
   * Get an access token for the client itself, with no user: one server calling another.
   * Needs a `clientSecret`.
   *
   * ```ts
   * const granted = await client.clientCredentials({ scopes: ["users:read"] })
   *
   * if (granted.err) {
   *   console.log(granted.err.error) // "invalid_client", "invalid_scope", ...
   * } else {
   *   const { access, expiresIn } = granted.token
   * }
   * ```
   *
   * Keep the token until it's about to expire rather than asking for one per request.
   */
  clientCredentials(
    opts?: ClientCredentialsOptions,
  ): Promise<ClientCredentialsSuccess | RequestFailure>
  /**
   * Sign in on a device with no browser or keyboard, like a TV.
   */
  device: {
    /**
     * Get a code for the user to type on their phone or computer.
     *
     * ```ts
     * const started = await client.device.start()
     * if (started.err) return
     *
     * show(started.device.userCode, started.device.verificationURI)
     * ```
     */
    start(opts?: {
      scopes?: string[]
    }): Promise<{ err: false; device: DeviceAuthorization } | RequestFailure>
    /**
     * Wait until the user approves, then get the tokens.
     *
     * ```ts
     * const approved = await client.device.poll(started.device)
     *
     * if (approved.err) {
     *   console.log(approved.err.error) // "access_denied", "expired_token", ...
     * } else {
     *   const { access, refresh } = approved.tokens
     * }
     * ```
     *
     * This polls no faster than the server allows, slows down when told to, and keeps
     * going through network failures until the code expires.
     */
    poll(
      device: DeviceAuthorization,
      opts?: DevicePollOptions,
    ): Promise<ExchangeSuccess | RequestFailure>
  }
  /**
   * End a sign-in by revoking its refresh token.
   *
   * ```ts
   * await client.revoke(<refresh_token>)
   * ```
   *
   * The server answers the same for a token it doesn't know, so revoking twice is fine.
   */
  revoke(
    token: string,
    opts?: { hint?: "refresh_token" | "access_token" },
  ): Promise<{ err: false } | RequestFailure>
  /**
   * Ask the server who an access token belongs to.
   *
   * ```ts
   * const info = await client.userinfo(subjects.user, <access_token>)
   *
   * if (!info.err) console.log(info.properties.userID)
   * ```
   *
   * To check a token on every request use `verify`, which needs no call to the server.
   */
  userinfo<T extends v1.StandardSchema>(
    subject: T,
    access: string,
  ): Promise<{ err: false; properties: v1.InferOutput<T> } | RequestFailure>
}

type JWKSGetKey = ReturnType<typeof createLocalJWKSet>

interface CacheEntry<T> {
  value?: T
  fetchedAt: number
  expiresAt: number
  inflight?: Promise<T>
}

const DEFAULT_CACHE_TTL = 10 * 60 * 1000
/** Minimum gap between JWKS re-fetches forced by a token the cached keys reject. */
const JWKS_FORCED_REFETCH_GAP = 30 * 1000

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
/** How much longer to wait between polls when told to slow down (RFC 8628 §3.5). */
const DEVICE_SLOW_DOWN = 5

/** Resolves after `ms`, or at once when `signal` is aborted. */
function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener("abort", done, { once: true })
  })
}

const isString = (v: unknown): v is string => typeof v === "string" && v !== ""
const isSeconds = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0

/**
 * Discovery documents and JWKS, shared by every client in this process or
 * isolate and keyed by issuer. Servers that build a client per request (the
 * common pattern) would otherwise fetch both on every `verify`.
 */
const discoveryCache = new Map<string, CacheEntry<WellKnown>>()
const jwksCache = new Map<string, CacheEntry<JWKSGetKey>>()

/**
 * Clear the shared discovery and JWKS cache. Mostly useful in tests.
 */
export function clearClientCache() {
  discoveryCache.clear()
  jwksCache.clear()
}

/**
 * Return the cached value for `key`, fetching it when it is missing or older
 * than its TTL (or when `force` is set). Concurrent callers share one fetch.
 * A failed refresh falls back to the previous value when there is one.
 */
async function cached<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  ttl: number,
  load: () => Promise<T>,
  force = false,
): Promise<T> {
  const now = Date.now()
  const entry = cache.get(key)
  if (entry?.inflight) return entry.inflight
  if (entry?.value !== undefined && !force && now < entry.expiresAt)
    return entry.value
  const inflight = load().then(
    (value) => {
      cache.set(key, {
        value,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + ttl,
      })
      return value
    },
    (err) => {
      const prev = cache.get(key)
      if (prev?.value !== undefined) {
        // Serve the stale value; retry after a short back-off, not every call.
        cache.set(key, {
          value: prev.value,
          fetchedAt: prev.fetchedAt,
          expiresAt: Date.now() + Math.min(ttl, JWKS_FORCED_REFETCH_GAP),
        })
        return prev.value
      }
      cache.delete(key)
      throw err
    },
  )
  cache.set(key, {
    value: entry?.value,
    fetchedAt: entry?.fetchedAt ?? 0,
    expiresAt: entry?.expiresAt ?? 0,
    inflight,
  })
  return inflight
}

async function fetchJSON(f: FetchLike, url: string) {
  const response = await f(url)
  if (!response.ok)
    throw new Error(
      `Failed to fetch ${url}: ${(response as { status?: number }).status}`,
    )
  return response.json()
}

/**
 * Create an OpenAuth client.
 *
 * @param input - Configure the client.
 */
export function createClient(input: ClientInput): Client {
  const issuer = input.issuer || process.env.OPENAUTH_ISSUER
  if (!issuer) throw new Error("No issuer")
  const f: FetchLike = input.fetch ?? fetch
  const ttl = input.cacheTTL ?? DEFAULT_CACHE_TTL
  // The issuer reads Basic credentials verbatim (no form-decoding), so the
  // pair is sent as is.
  const tokenHeaders: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    ...(input.clientSecret
      ? {
          Authorization:
            "Basic " + btoa(`${input.clientID}:${input.clientSecret}`),
        }
      : {}),
  }

  async function getIssuer() {
    return cached(discoveryCache, issuer!, ttl, () =>
      fetchJSON(f, `${issuer}/.well-known/oauth-authorization-server`),
    ) as Promise<WellKnown>
  }

  async function getJWKS(force = false) {
    return cached(
      jwksCache,
      issuer!,
      ttl,
      async () => {
        const wk = await getIssuer()
        const keyset = (await fetchJSON(f, wk.jwks_uri)) as JSONWebKeySet
        return createLocalJWKSet(keyset)
      },
      force,
    )
  }

  /**
   * Re-fetch the JWKS early when a token's key is not (or no longer) the one
   * we cached. At most once per JWKS_FORCED_REFETCH_GAP, so bad tokens cannot
   * turn into a fetch per request.
   */
  async function refetchJWKSForUnknownKey() {
    const entry = jwksCache.get(issuer!)
    const elapsed = entry ? Date.now() - entry.fetchedAt : Infinity
    // elapsed < 0: the clock moved back (tests, VM resume); do not trust it.
    if (elapsed >= 0 && elapsed < JWKS_FORCED_REFETCH_GAP) return undefined
    return getJWKS(true)
  }

  /** Send a request; every way it can fail comes back as an `AuthRequestError`. */
  async function send(
    path: string,
    init: {
      method: string
      headers: Record<string, string>
      body?: string
      signal?: AbortSignal
    },
  ): Promise<{ err: false; json: Record<string, unknown> } | RequestFailure> {
    let response: ResponseLike
    try {
      response = await f(issuer + path, init)
    } catch (cause) {
      return {
        err: new AuthRequestError(
          "network_error",
          "The auth server could not be reached",
          undefined,
          { cause },
        ),
      }
    }
    const status = (response as { status?: number }).status
    // An error page or an empty body is not JSON; the status still says enough
    const body = await response.json().catch(() => undefined)
    const json = (
      body && typeof body === "object" && !Array.isArray(body) ? body : {}
    ) as Record<string, unknown>
    if (response.ok) return { err: false, json }
    return {
      err: new AuthRequestError(
        isString(json.error) ? json.error : "invalid_response",
        isString(json.error_description) ? json.error_description : undefined,
        status,
      ),
    }
  }

  const post = (
    path: string,
    form: Record<string, string>,
    signal?: AbortSignal,
  ) =>
    send(path, {
      method: "POST",
      headers: tokenHeaders,
      body: new URLSearchParams(form).toString(),
      ...(signal ? { signal } : {}),
    })

  const malformed = (what: string): RequestFailure => ({
    err: new AuthRequestError("invalid_response", what),
  })

  function tokensFrom(
    json: Record<string, unknown>,
  ): ExchangeSuccess | RequestFailure {
    if (
      !isString(json.access_token) ||
      !isString(json.refresh_token) ||
      !isSeconds(json.expires_in)
    )
      return malformed("The token response is incomplete")
    return {
      err: false,
      tokens: {
        access: json.access_token,
        refresh: json.refresh_token,
        expiresIn: json.expires_in,
      },
    }
  }

  const device: Client["device"] = {
    async start(opts) {
      const asked = Date.now()
      const res = await post("/device_authorization", {
        client_id: input.clientID,
        ...(opts?.scopes?.length ? { scope: opts.scopes.join(" ") } : {}),
      })
      if (res.err) return res
      const { json } = res
      if (
        !isString(json.device_code) ||
        !isString(json.user_code) ||
        !isString(json.verification_uri) ||
        !isSeconds(json.expires_in)
      )
        return malformed("The device authorization response is incomplete")
      return {
        err: false,
        device: {
          deviceCode: json.device_code,
          userCode: json.user_code,
          verificationURI: json.verification_uri,
          ...(isString(json.verification_uri_complete)
            ? { verificationURIComplete: json.verification_uri_complete }
            : {}),
          expiresAt: asked + json.expires_in * 1000,
          // RFC 8628 §3.2: 5 when the server doesn't say
          interval: isSeconds(json.interval) ? json.interval : 5,
        },
      }
    },
    async poll(authorization, opts) {
      const signal = opts?.signal
      const aborted = (): RequestFailure => ({
        err: new AuthRequestError("aborted"),
      })
      // At least a second apart, whatever the server says
      let interval = Math.max(1, authorization.interval)
      while (true) {
        if (signal?.aborted) return aborted()
        const left = authorization.expiresAt - Date.now()
        if (left <= 0)
          return {
            err: new AuthRequestError(
              "expired_token",
              "The device code has expired",
            ),
          }
        // The last wait ends with the code, so a late approval still counts
        await wait(Math.min(interval * 1000, left), signal)
        if (signal?.aborted) return aborted()
        const res = await post(
          "/token",
          {
            grant_type: DEVICE_CODE_GRANT,
            device_code: authorization.deviceCode,
            client_id: input.clientID,
          },
          signal,
        )
        if (!res.err) return tokensFrom(res.json)
        if (signal?.aborted) return aborted()
        const { error, status } = res.err
        if (error === "authorization_pending") continue
        if (error === "slow_down") {
          interval += DEVICE_SLOW_DOWN
          continue
        }
        // Lost connection or a server in trouble: the user may be approving
        // right now, so keep the code alive and back off (RFC 8628 §3.5)
        if (
          error === "network_error" ||
          status === 429 ||
          (status ?? 0) >= 500
        ) {
          interval = Math.min(interval * 2, 60)
          continue
        }
        return res
      }
    },
  }

  const result = {
    device,
    async clientCredentials(
      opts?: ClientCredentialsOptions,
    ): Promise<ClientCredentialsSuccess | RequestFailure> {
      const res = await post("/token", {
        grant_type: "client_credentials",
        ...(opts?.scopes?.length ? { scope: opts.scopes.join(" ") } : {}),
      })
      if (res.err) return res
      const { json } = res
      if (!isString(json.access_token) || !isSeconds(json.expires_in))
        return malformed("The token response is incomplete")
      return {
        err: false,
        token: {
          access: json.access_token,
          expiresIn: json.expires_in,
          scopes: isString(json.scope) ? json.scope.split(" ") : [],
        },
      }
    },
    async revoke(
      token: string,
      opts?: { hint?: "refresh_token" | "access_token" },
    ): Promise<{ err: false } | RequestFailure> {
      const res = await post("/token/revoke", {
        token,
        client_id: input.clientID,
        ...(opts?.hint ? { token_type_hint: opts.hint } : {}),
      })
      return res.err ? res : { err: false }
    },
    async userinfo<T extends v1.StandardSchema>(
      subject: T,
      access: string,
    ): Promise<{ err: false; properties: v1.InferOutput<T> } | RequestFailure> {
      const res = await send("/userinfo", {
        method: "GET",
        headers: { Authorization: `Bearer ${access}` },
      })
      if (res.err) return res
      // Issuers before 1.0.63 answer a bad token with 200 and an error body
      if (res.json.error === "invalid_token")
        return { err: new AuthRequestError("invalid_token") }
      const validated = await subject["~standard"].validate(res.json)
      if (validated.issues)
        return malformed("The user info doesn't fit the subject")
      return { err: false, properties: validated.value as v1.InferOutput<T> }
    },
    async authorize(
      redirectURI: string,
      response: "code" | "token",
      opts?: AuthorizeOptions,
    ) {
      const result = new URL(issuer + "/authorize")
      const challenge: Challenge = {
        state: crypto.randomUUID(),
      }
      result.searchParams.set("client_id", input.clientID)
      result.searchParams.set("redirect_uri", redirectURI)
      result.searchParams.set("response_type", response)
      result.searchParams.set("state", challenge.state)
      if (opts?.provider) result.searchParams.set("provider", opts.provider)
      if (opts?.pkce && response === "code") {
        const pkce = await generatePKCE()
        result.searchParams.set("code_challenge_method", "S256")
        result.searchParams.set("code_challenge", pkce.challenge)
        challenge.verifier = pkce.verifier
      }
      return {
        challenge,
        url: result.toString(),
      }
    },
    /**
     * @deprecated use `authorize` instead, it will do pkce by default unless disabled with `opts.pkce = false`
     */
    async pkce(
      redirectURI: string,
      opts?: {
        provider?: string
      },
    ) {
      const result = new URL(issuer + "/authorize")
      if (opts?.provider) result.searchParams.set("provider", opts.provider)
      result.searchParams.set("client_id", input.clientID)
      result.searchParams.set("redirect_uri", redirectURI)
      result.searchParams.set("response_type", "code")
      const pkce = await generatePKCE()
      result.searchParams.set("code_challenge_method", "S256")
      result.searchParams.set("code_challenge", pkce.challenge)
      return [pkce.verifier, result.toString()]
    },
    async exchange(
      code: string,
      redirectURI: string,
      verifier?: string,
    ): Promise<ExchangeSuccess | ExchangeError> {
      const tokens = await f(issuer + "/token", {
        method: "POST",
        headers: tokenHeaders,
        body: new URLSearchParams({
          code,
          redirect_uri: redirectURI,
          grant_type: "authorization_code",
          client_id: input.clientID,
          code_verifier: verifier || "",
        }).toString(),
      })
      const json = (await tokens.json()) as any
      if (!tokens.ok) {
        return {
          err: new InvalidAuthorizationCodeError(),
        }
      }
      return {
        err: false,
        tokens: {
          access: json.access_token as string,
          refresh: json.refresh_token as string,
          expiresIn: json.expires_in as number,
        },
      }
    },
    async refresh(
      refresh: string,
      opts?: RefreshOptions,
    ): Promise<RefreshSuccess | RefreshError> {
      if (opts && opts.access) {
        const decoded = decodeJwt(opts.access)
        if (!decoded) {
          return {
            err: new InvalidAccessTokenError(),
          }
        }
        // allow 30s window for expiration
        if ((decoded.exp || 0) > Date.now() / 1000 + 30) {
          return {
            err: false,
          }
        }
      }
      const tokens = await f(issuer + "/token", {
        method: "POST",
        headers: tokenHeaders,
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refresh,
        }).toString(),
      })
      const json = (await tokens.json()) as any
      if (!tokens.ok) {
        return {
          err: new InvalidRefreshTokenError(),
        }
      }
      return {
        err: false,
        tokens: {
          access: json.access_token as string,
          refresh: json.refresh_token as string,
          expiresIn: json.expires_in as number,
        },
      }
    },
    async verify<T extends SubjectSchema>(
      subjects: T,
      token: string,
      options?: VerifyOptions,
    ): Promise<VerifyResult<T> | VerifyError> {
      const jwks = await getJWKS()
      try {
        type Claims = {
          mode: "access"
          type: keyof T
          properties: v1.InferInput<T[keyof T]>
        }
        let result: Awaited<ReturnType<typeof jwtVerify<Claims>>>
        try {
          result = await jwtVerify<Claims>(token, jwks, { issuer })
        } catch (e) {
          // A key we do not have, or (keys here share one fixed kid) a
          // signature our cached key rejects: the server may have rotated.
          if (
            !(e instanceof errors.JWKSNoMatchingKey) &&
            !(e instanceof errors.JWSSignatureVerificationFailed)
          )
            throw e
          const fresh = await refetchJWKSForUnknownKey()
          if (!fresh) throw e
          result = await jwtVerify<Claims>(token, fresh, { issuer })
        }
        const validated = await subjects[result.payload.type][
          "~standard"
        ].validate(result.payload.properties)
        if (!validated.issues && result.payload.mode === "access")
          return {
            aud: result.payload.aud as string,
            subject: {
              type: result.payload.type,
              properties: validated.value,
            } as any,
          }
        return {
          err: new InvalidSubjectError(),
        }
      } catch (e) {
        if (e instanceof errors.JWTExpired && options?.refresh) {
          const refreshed = await this.refresh(options.refresh)
          if (refreshed.err) return refreshed
          const verified = await result.verify(
            subjects,
            refreshed.tokens!.access,
            {
              refresh: refreshed.tokens!.refresh,
              issuer,
              fetch: options?.fetch,
            },
          )
          if (verified.err) return verified
          verified.tokens = refreshed.tokens
          return verified
        }
        return {
          err: new InvalidAccessTokenError(),
        }
      }
    },
  }
  return result
}
