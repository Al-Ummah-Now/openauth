/**
 * Native passkey sign-in: native apps run the WebAuthn ceremony with the
 * platform API (ASAuthorization on Apple, Credential Manager on Android,
 * webauthn.dll on Windows) instead of a browser, then get an ordinary
 * authorization code they exchange at `/token` with PKCE.
 *
 * - `POST /native/passkey/options` `{ client_id, code_challenge, code_challenge_method: "S256" }`
 *   → `{ challenge_id, publicKey }` (request options, discoverable, UV required, 2 min).
 *   The challenge is single use and bound to the client and the code challenge.
 * - `POST /native/passkey/verify` `{ challenge_id, client_id, credential }`
 *   → `{ code }`, bound to the client, its native redirect and the code challenge.
 *
 * The sign-in goes through the issuer's normal success pipeline (the app's
 * `success` callback, RBAC, `amr: ["passkey"]`, `auth_time`), so tokens are
 * identical to a browser passkey sign-in. No browser session is created.
 *
 * Errors are JSON `{ error, error_description }`. Every sign-in failure is the
 * same generic `401 invalid_credential` (no user enumeration).
 *
 * @packageDocumentation
 */
import type { Context, Hono } from "hono"
import type { AuthenticationResponseJSON } from "@simplewebauthn/server"
import {
  authenticationOptions,
  verifyAuthentication,
  type PasskeyCredential,
} from "./passkey.js"
import { Storage, type StorageAdapter } from "./storage/storage.js"

export interface NativePasskeyOptions {
  /** RP id for this request (the same as the web's, e.g. `alummahnow.net`). */
  rpID: (req: Request) => string
  /**
   * Origins accepted in `clientDataJSON` for native ceremonies: the web
   * origins, `https://<rpID>` (Apple, Windows) and
   * `android:apk-key-hash:<b64url sha256>` per Android signing certificate.
   */
  origins: (req: Request) => string[] | Promise<string[]>
  store: {
    /** The stored passkey for a credential id, or undefined. */
    get: (credentialID: string) => Promise<PasskeyCredential | undefined>
    /** Records a successful sign-in (new counter, last used). */
    touch: (credentialID: string, counter: number) => Promise<void>
  }
  /**
   * The native client and the redirect its codes are bound to (the app sends
   * the same `redirect_uri` at `/token`), or undefined when the client may not
   * use native passkey sign-in.
   */
  client: (
    clientID: string,
    req: Request,
  ) => Promise<{ redirectURI: string } | undefined>
  /**
   * Counts one request; false refuses it with `429 rate_limited`. Called for
   * both routes before any other work.
   */
  rateLimit?: (input: {
    route: "options" | "verify"
    clientID: string
    req: Request
  }) => Promise<boolean>
  /** Seconds sent in `Retry-After` on a 429. @default 60 */
  retryAfter?: number
  /** Challenge lifetime in seconds (also the ceremony timeout). @default 120 */
  challengeTTL?: number
  /** Provider name the sign-in reports to `success`. @default "passkey" */
  provider?: string
  /** Called with the reason whenever a sign-in is refused (logging). */
  onFailure?: (reason: string, req: Request) => void
  /**
   * Called for unexpected errors (the app reports them). A returned string is
   * the report's reference: sent as `X-Error-Ref`.
   */
  onError?: (error: unknown, req: Request) => string | void
}

/** What the issuer gives the routes to finish a sign-in. */
export interface NativePasskeyDeps {
  storage: StorageAdapter
  /**
   * Runs the issuer's success pipeline for this native authorization and
   * returns its response (a redirect carrying `code` on success).
   */
  complete: (
    c: Context,
    authorization: NativeAuthorization,
    value: { userID: string; credentialID: string },
    provider: string,
  ) => Promise<Response>
}

/** The authorization a native sign-in completes (always `code` + PKCE S256). */
export interface NativeAuthorization {
  response_type: "code"
  client_id: string
  redirect_uri: string
  state: string
  pkce: { challenge: string; method: "S256" }
}

interface ChallengeRecord {
  challenge: string
  clientID: string
  codeChallenge: string
  /** The issuer host (tenants resolve by host): verify must come to the same one. */
  host: string
  expires: number
}

/** RFC 7636: S256 challenges are base64url (43 chars for SHA-256). */
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/
const ID = /^[A-Za-z0-9_-]{16,128}$/

export const nativeChallengeKey = (id: string) => ["oauth:native-passkey", id]

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function b64urlToText(value: string): string | undefined {
  try {
    let s = value.replace(/-/g, "+").replace(/_/g, "/")
    while (s.length % 4) s += "="
    const bin = atob(s)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

const NO_STORE = { "Cache-Control": "no-store" }

export function registerNativePasskey(
  app: Hono<any>,
  deps: NativePasskeyDeps,
  options: NativePasskeyOptions,
) {
  const ttl = options.challengeTTL ?? 120
  const provider = options.provider ?? "passkey"
  const atomic = () => Storage.atomic(deps.storage)

  function error(
    c: Context,
    status: 400 | 401 | 429 | 500,
    code: string,
    description: string,
    headers: Record<string, string> = {},
  ) {
    return c.json({ error: code, error_description: description }, status, {
      ...NO_STORE,
      ...headers,
    })
  }
  const refused = (c: Context, reason: string) => {
    options.onFailure?.(reason, c.req.raw)
    return error(c, 401, "invalid_credential", "The passkey was not accepted.")
  }
  const limited = (c: Context) =>
    error(c, 429, "rate_limited", "Too many requests. Try again later.", {
      "Retry-After": String(options.retryAfter ?? 60),
    })

  async function body(c: Context): Promise<Record<string, unknown> | null> {
    try {
      const value = await c.req.json()
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }

  async function guarded(c: Context, run: () => Promise<Response>) {
    try {
      return await run()
    } catch (err) {
      const ref = options.onError?.(err, c.req.raw)
      return error(
        c,
        500,
        "server_error",
        "Something went wrong.",
        typeof ref === "string" ? { "X-Error-Ref": ref } : {},
      )
    }
  }

  app.post("/native/passkey/options", (c) =>
    guarded(c, async () => {
      const input = await body(c)
      const clientID = input?.client_id
      const codeChallenge = input?.code_challenge
      if (typeof clientID !== "string" || !clientID)
        return error(c, 400, "invalid_request", "client_id is required.")
      if (options.rateLimit) {
        if (
          !(await options.rateLimit({
            route: "options",
            clientID,
            req: c.req.raw,
          }))
        )
          return limited(c)
      }
      if (input?.code_challenge_method !== "S256")
        return error(
          c,
          400,
          "invalid_request",
          "code_challenge_method must be S256.",
        )
      if (
        typeof codeChallenge !== "string" ||
        !CODE_CHALLENGE.test(codeChallenge)
      )
        return error(
          c,
          400,
          "invalid_request",
          "code_challenge is missing or malformed.",
        )
      if (!(await options.client(clientID, c.req.raw)))
        return error(
          c,
          400,
          "invalid_client",
          "This app cannot sign in with a passkey here.",
        )

      const publicKey = await authenticationOptions({
        rpID: options.rpID(c.req.raw),
        timeout: ttl * 1000,
      })
      const challengeID = randomId()
      await atomic().set(
        nativeChallengeKey(challengeID),
        {
          challenge: publicKey.challenge,
          clientID,
          codeChallenge,
          host: new URL(c.req.url).host,
          expires: Date.now() + ttl * 1000,
        } satisfies ChallengeRecord,
        new Date(Date.now() + ttl * 1000),
      )
      return c.json({ challenge_id: challengeID, publicKey }, 200, NO_STORE)
    }),
  )

  app.post("/native/passkey/verify", (c) =>
    guarded(c, async () => {
      const input = await body(c)
      const clientID = input?.client_id
      const challengeID = input?.challenge_id
      const credential = input?.credential as
        AuthenticationResponseJSON | undefined
      if (typeof clientID !== "string" || !clientID)
        return error(c, 400, "invalid_request", "client_id is required.")
      if (options.rateLimit) {
        if (
          !(await options.rateLimit({
            route: "verify",
            clientID,
            req: c.req.raw,
          }))
        )
          return limited(c)
      }
      if (typeof challengeID !== "string" || !ID.test(challengeID))
        return error(
          c,
          400,
          "invalid_request",
          "challenge_id is missing or malformed.",
        )
      if (
        !credential ||
        typeof credential !== "object" ||
        typeof credential.id !== "string" ||
        !credential.id ||
        credential.type !== "public-key" ||
        !credential.response ||
        typeof credential.response !== "object"
      )
        return error(
          c,
          400,
          "invalid_request",
          "credential is missing or malformed.",
        )
      const client = await options.client(clientID, c.req.raw)
      if (!client)
        return error(
          c,
          400,
          "invalid_client",
          "This app cannot sign in with a passkey here.",
        )

      // Single use: whoever takes the challenge first is the only one to see it
      const state = (await atomic().take(nativeChallengeKey(challengeID))) as
        ChallengeRecord | undefined
      if (!state) return refused(c, "no_challenge")
      if (Date.now() > state.expires) return refused(c, "expired_challenge")
      if (state.clientID !== clientID) return refused(c, "wrong_client")
      if (state.host !== new URL(c.req.url).host)
        return refused(c, "wrong_host")

      const stored = await options.store.get(credential.id)
      if (!stored) return refused(c, "unknown_credential")
      // Discoverable credentials name their account: it must be the owner
      const handle = credential.response.userHandle
      if (handle !== undefined && handle !== null && handle !== "") {
        if (
          typeof handle !== "string" ||
          b64urlToText(handle) !== stored.userID
        )
          return refused(c, "wrong_user_handle")
      }
      let counter: number
      try {
        ;({ counter } = await verifyAuthentication({
          response: credential,
          challenge: state.challenge,
          rpID: options.rpID(c.req.raw),
          origins: await options.origins(c.req.raw),
          credential: stored,
        }))
      } catch (err) {
        return refused(
          c,
          "verify_failed:" + (err instanceof Error ? err.message : "error"),
        )
      }
      await options.store.touch(stored.id, counter)

      const response = await deps.complete(
        c,
        {
          response_type: "code",
          client_id: clientID,
          redirect_uri: client.redirectURI,
          state: "",
          pkce: { challenge: state.codeChallenge, method: "S256" },
        },
        { userID: stored.userID, credentialID: stored.id },
        provider,
      )
      const code = codeFrom(response, client.redirectURI)
      // Anything but a redirect with a code: the app refused the account
      // (suspended, deleted). Same generic answer as a bad passkey.
      if (!code) return refused(c, "account_refused")
      return c.json({ code }, 200, NO_STORE)
    }),
  )
}

function codeFrom(response: Response, redirectURI: string): string | undefined {
  if (response.status < 300 || response.status >= 400) return undefined
  const location = response.headers.get("Location")
  if (!location) return undefined
  try {
    const url = new URL(location)
    const expected = new URL(redirectURI)
    if (
      url.protocol !== expected.protocol ||
      url.host !== expected.host ||
      url.pathname !== expected.pathname
    )
      return undefined
    if (url.searchParams.get("error")) return undefined
    return url.searchParams.get("code") ?? undefined
  } catch {
    return undefined
  }
}
