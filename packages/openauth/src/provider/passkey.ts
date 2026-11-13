/**
 * Sign in with a passkey (WebAuthn, discoverable credentials).
 *
 * An *embedded* provider: it has no page of its own and is never on the
 * provider-select page. Another provider's sign-in page (the password page,
 * `PasswordUI({ passkey: ... })`) runs the browser ceremony and posts here.
 *
 * ```ts
 * PasskeyProvider({
 *   rpID: (req) => rpIdForHost(new URL(req.url).host),
 *   origins: (req) => [new URL(req.url).origin],
 *   store: {
 *     get: (id) => db.passkey(id),
 *     touch: (id, counter) => db.touchPasskey(id, counter),
 *   },
 * })
 * ```
 *
 * Routes (inside a sign-in flow, so the flow params are on the URL):
 * - `POST /passkey/options` → JSON `PublicKeyCredentialRequestOptionsJSON`
 * - `POST /passkey/verify`  → form field `credential` (assertion JSON);
 *   success completes the flow with `{ userID, credentialID }` and
 *   `amr: ["passkey"]`, failure redirects to `failurePath` with
 *   `passkey_error=1`.
 *
 * @packageDocumentation
 */
import type { Provider } from "./provider.js"
import {
  authenticationOptions,
  verifyAuthentication,
  type PasskeyCredential,
} from "../passkey.js"
import { withFlowParams } from "../flow.js"

export interface PasskeyProviderConfig {
  /** RP id for this request (e.g. `alummahnow.net`). */
  rpID: (req: Request) => string
  /** Origins a ceremony may come from (the sign-in page's origin). */
  origins: (req: Request) => string[]
  store: {
    /** The stored passkey for a credential id, or undefined. */
    get: (credentialID: string) => Promise<PasskeyCredential | undefined>
    /** Records a successful sign-in (new counter, last used). */
    touch: (credentialID: string, counter: number) => Promise<void>
  }
  /**
   * Where a failed sign-in goes back to (the page that offered the passkey),
   * with the flow params and `passkey_error=1`.
   * @default "/password/authorize"
   */
  failurePath?: string
  /** Called with the reason whenever a sign-in is refused (logging). */
  onFailure?: (reason: string, req: Request) => void
}

/** Properties a passkey sign-in reports to `success`. */
export interface PasskeySuccess {
  userID: string
  credentialID: string
}

interface ChallengeState {
  challenge: string
  expires: number
}

const CHALLENGE_TTL = 5 * 60

export function PasskeyProvider(
  config: PasskeyProviderConfig,
): Provider<PasskeySuccess> {
  const failurePath = config.failurePath ?? "/password/authorize"
  return {
    type: "passkey",
    embedded: true,
    init(routes, ctx) {
      function fail(c: any, reason: string) {
        config.onFailure?.(reason, c.req.raw)
        const target = withFlowParams(failurePath, c.req.url)
        const url = new URL(target, c.req.url)
        url.searchParams.set("passkey_error", "1")
        return c.redirect(url.pathname + url.search, 303)
      }

      routes.post("/options", async (c) => {
        const options = await authenticationOptions({
          rpID: config.rpID(c.req.raw),
        })
        await ctx.set<ChallengeState>(c, "challenge", CHALLENGE_TTL, {
          challenge: options.challenge,
          expires: Date.now() + CHALLENGE_TTL * 1000,
        })
        return c.json(options, 200, { "Cache-Control": "no-store" })
      })

      routes.post("/verify", async (c) => {
        const state = await ctx.get<ChallengeState>(c, "challenge")
        // Single use: a replayed assertion finds no challenge
        await ctx.unset(c, "challenge")
        if (!state?.challenge || Date.now() > state.expires)
          return fail(c, "no_challenge")
        const form = await c.req.formData()
        const raw = form.get("credential")?.toString()
        if (!raw) return fail(c, "no_credential")
        let response: any
        try {
          response = JSON.parse(raw)
        } catch {
          return fail(c, "bad_credential")
        }
        if (!response || typeof response.id !== "string")
          return fail(c, "bad_credential")
        const stored = await config.store.get(response.id)
        if (!stored) return fail(c, "unknown_credential")
        let counter: number
        try {
          ;({ counter } = await verifyAuthentication({
            response,
            challenge: state.challenge,
            rpID: config.rpID(c.req.raw),
            origins: config.origins(c.req.raw),
            credential: stored,
          }))
        } catch (err) {
          return fail(
            c,
            "verify_failed:" + (err instanceof Error ? err.message : "error"),
          )
        }
        await config.store.touch(stored.id, counter)
        return ctx.success(
          c,
          { userID: stored.userID, credentialID: stored.id },
          { amr: ["passkey"] },
        )
      })
    },
  }
}
