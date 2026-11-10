/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628) for TVs, cars and consoles.
 *
 * - `POST /device_authorization`: the device gets a `device_code` (secret, kept
 *   on the device) and a short `user_code` it shows with the verification URI
 *   (and a QR code of `verification_uri_complete`).
 * - `GET /activate`: the user enters the code on a phone or computer, confirms
 *   the sign-in (RFC 8628 §5.4: against remote phishing), and is sent through
 *   the normal `/authorize` sign-in for the device's client with the issuer's
 *   own `/activate/callback` as redirect URI and a server-held PKCE verifier.
 *   Sign-in, single sign-on, account picker and claim enrichment therefore run
 *   unchanged. The callback redeems that code and parks the grant on the
 *   device record.
 * - `POST /token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`:
 *   the device polls; it gets `authorization_pending`, `slow_down` (interval
 *   grows by 5 s), `access_denied`, `expired_token`, or the tokens (once).
 *
 * Only clients registered (clientDb) with the device_code grant may use it.
 * Codes expire after `expiresIn` (default 600 s). Code lookups on /activate
 * and device authorization requests are rate limited.
 */
import type { Context, Hono } from "hono"
import { getCookie, setCookie } from "hono/cookie"
import type { StorageAdapter } from "./storage/storage.js"
import { Storage } from "./storage/storage.js"
import type { ClientD1Adapter } from "./client/client-d1-adapter.js"
import { generatePKCE, validatePKCE } from "./pkce.js"
import {
  type AuthorizationCodePayload,
  type CodeGrant,
  consumeAuthorizationCode,
  redeemAuthorizationCode,
} from "./authorization-code.js"
import { DevicePage } from "./ui/device.js"
import { restartLocale } from "./ui/restart.js"
import { renderOptions } from "./ui/render.js"

export const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
/** Consonants only (no vowels: no words; no 0/O, 1/I lookalikes), per RFC 8628 §6.1. */
export const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ"
export const USER_CODE_LENGTH = 8
export const DEVICE_CALLBACK_PATH = "/activate/callback"
const CSRF_COOKIE = "__device_csrf"
const HANDLE_COOKIE = "__device_handle"

export interface DeviceFlowOptions {
  /** Where users enter the code. Default: `<issuer>/activate`. */
  verificationUri?: string
  /** Lifetime of device and user codes, seconds. Default 600 (10 minutes). */
  expiresIn?: number
  /** Minimum polling interval, seconds. Default 5. */
  interval?: number
  /** Wrong-or-right code lookups per IP per minute on /activate. Default 10. */
  lookupsPerMinute?: number
  /** Device authorization requests per client and IP per minute. Default 10. */
  requestsPerMinute?: number
  /**
   * Failed code lookups per network (IPv4 /24, IPv6 /48) per minute, so one
   * network can't spread guesses across many addresses. Default 30. There is
   * deliberately no global limit: a global counter would let anyone lock every
   * user out. The 34-bit code space and 10-minute lifetime make distributed
   * guessing impractical (RFC 8628 §5.1).
   */
  failedLookupsPerNetworkPerMinute?: number
  /**
   * Header with the caller's IP, set by a trusted proxy. Default
   * `cf-connecting-ip` (Cloudflare sets it and clients can't override it).
   */
  ipHeader?: string
}

export interface DeviceGrant {
  type: string
  properties: any
  subject: string
  clientID: string
  ttl: { access: number; refresh: number }
  /** When the approving user authenticated (ms) */
  authTime?: number
  /** Refresh-token family started by the code the approval redeemed */
  family?: string
}

export interface DeviceRecord {
  clientID: string
  clientName: string
  userCode: string
  scope?: string
  status: "pending" | "approved" | "denied"
  /** Initial polling interval (seconds); the current one is in {@link PollState}. */
  interval: number
  expiresAt: number
  /** Only on records written before poll state moved to its own key. */
  lastPollAt?: number
  grant?: DeviceGrant
}

/**
 * Polling bookkeeping, kept under its own key so a poll never rewrites the
 * device record (a poll that read `pending` must not overwrite an approval).
 */
export interface PollState {
  lastPollAt: number
  interval: number
}

interface HandleRecord {
  deviceKey: string
  verifier: string
  locale: string
}

interface DeviceFlowDeps {
  storage: StorageAdapter
  clients: ClientD1Adapter
  issuer: (c: Context) => string
  generateTokens: (
    c: Context,
    grant: DeviceGrant,
  ) => Promise<{ access: string; refresh: string; expiresIn: number }>
  /** Revoke what a replayed authorization code was exchanged for. */
  revokeCodeGrant: (grant: CodeGrant) => Promise<void>
}

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/** Uniform random user code (rejection sampling, no modulo bias). */
export function generateUserCode(length = USER_CODE_LENGTH): string {
  const n = USER_CODE_ALPHABET.length
  const limit = 256 - (256 % n)
  let out = ""
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2))
    for (const b of bytes) {
      if (b < limit && out.length < length) out += USER_CODE_ALPHABET[b % n]
    }
  }
  return out
}

/** What the user typed → stored form: upper case, separators and spaces removed. */
export function normalizeUserCode(
  input: string | undefined | null,
): string | null {
  if (!input) return null
  const code = input.toUpperCase().replace(/[\s-]/g, "")
  if (code.length !== USER_CODE_LENGTH) return null
  for (const ch of code) if (!USER_CODE_ALPHABET.includes(ch)) return null
  return code
}

function base64url(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** Device codes are stored by hash: a storage read never reveals a usable code. */
export async function hashDeviceCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(code),
  )
  return base64url(new Uint8Array(digest))
}

// ---------------------------------------------------------------------------
// Rate limiting (fixed one-minute windows in storage; approximate is fine)
// ---------------------------------------------------------------------------

export async function hitRateLimit(
  storage: StorageAdapter,
  bucket: string,
  id: string,
  limit: number,
  now = Date.now(),
): Promise<boolean> {
  const key = ["oauth:device_rl", bucket, id, String(Math.floor(now / 60_000))]
  const count = ((await Storage.get<number>(storage, key)) ?? 0) + 1
  await Storage.set(storage, key, count, 120)
  return count > limit
}

async function peekRateLimit(
  storage: StorageAdapter,
  bucket: string,
  id: string,
  limit: number,
  now = Date.now(),
): Promise<boolean> {
  const key = ["oauth:device_rl", bucket, id, String(Math.floor(now / 60_000))]
  return ((await Storage.get<number>(storage, key)) ?? 0) >= limit
}

/**
 * The network an address belongs to: IPv4 /24, IPv6 /48, else the value itself.
 * IPv6 is fully normalized (expanded, lowercase, no leading zeros) so different
 * spellings of one network share a bucket; IPv4-mapped/embedded forms count as
 * their IPv4 address.
 */
export function networkOf(raw: string): string {
  const ip = raw.trim().toLowerCase().replace(/%.*$/, "")
  const v4 = (s: string) => {
    const parts = s.split(".")
    if (
      parts.length !== 4 ||
      !parts.every((p) => /^\d{1,3}$/.test(p) && +p < 256)
    )
      return null
    return parts.slice(0, 3).map(Number).join(".") + ".0/24"
  }
  const asV4 = v4(ip)
  if (asV4) return asV4
  if (!ip.includes(":")) return ip
  // Trailing dotted IPv4 (::ffff:1.2.3.4, ::1.2.3.4) is that IPv4 address
  const embedded = ip.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (embedded) {
    const net = v4(embedded[1])
    if (net) return net
  }
  const halves = ip.split("::")
  if (halves.length > 2) return ip
  const left = halves[0] ? halves[0].split(":") : []
  const right = halves[1] ? halves[1].split(":") : []
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0
  const groups = [...left, ...Array(Math.max(0, fill)).fill("0"), ...right]
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g)))
    return ip
  const n = groups.map((g) => parseInt(g, 16))
  // IPv4-mapped written in hex (::ffff:102:304)
  if (n.slice(0, 5).every((x) => x === 0) && n[5] === 0xffff)
    return `${n[6] >> 8}.${n[6] & 255}.${n[7] >> 8}.0/24`
  return (
    n
      .slice(0, 3)
      .map((x) => x.toString(16))
      .join(":") + "::/48"
  )
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function deviceDiscovery(iss: string, options: DeviceFlowOptions) {
  return {
    device_authorization_endpoint: `${iss}/device_authorization`,
    verification_uri: options.verificationUri ?? `${iss}/activate`,
  }
}

const oauthError = (
  c: Context,
  error: string,
  description: string,
  status = 400,
) =>
  c.json({ error, error_description: description }, status as any, {
    "Cache-Control": "no-store",
  })

export function registerDeviceFlow(
  app: Hono<any>,
  deps: DeviceFlowDeps,
  options: DeviceFlowOptions = {},
) {
  const expiresIn = options.expiresIn ?? 600
  const interval = options.interval ?? 5
  const lookups = options.lookupsPerMinute ?? 10
  const requests = options.requestsPerMinute ?? 10
  const failedLookups = options.failedLookupsPerNetworkPerMinute ?? 30
  const ipHeader = options.ipHeader ?? "cf-connecting-ip"
  const clientIp = (c: Context) => c.req.header(ipHeader) || "unknown"
  const { storage } = deps

  /** A code lookup: per-IP limit, plus the failed-lookup limit of the IP's network. */
  async function lookupLimited(c: Context): Promise<boolean> {
    const ip = clientIp(c)
    if (
      await peekRateLimit(storage, "lookup_fail", networkOf(ip), failedLookups)
    )
      return true
    return hitRateLimit(storage, "lookup", ip, lookups)
  }
  const lookupFailed = (c: Context) =>
    hitRateLimit(storage, "lookup_fail", networkOf(clientIp(c)), failedLookups)

  const deviceKey = (hash: string) => ["oauth:device", hash]
  const pollKey = (hash: string) => ["oauth:device_poll", hash]
  const handleKey = (handle: string) => ["oauth:device_handle", handle]
  const userKey = (code: string) => ["oauth:device_user", code]
  // Device records, poll state and handles live in the atomic store: status
  // changes are compare-and-set (pending -> approved | denied, once) and the
  // grant is handed out by one atomic take. Only the user-code index stays in
  // the plain store; whatever it points to is checked against the record.
  const atomic = Storage.atomic(storage)
  const until = (r: DeviceRecord) => new Date(Date.now() + remaining(r) * 1000)

  /** The device record, moving one written by an older version into the atomic store. */
  async function loadRecord(hash: string): Promise<DeviceRecord | undefined> {
    const record = await atomic.get(deviceKey(hash))
    if (record || !Storage.isAtomic(storage)) return record ?? undefined
    const legacy = await Storage.get<DeviceRecord>(storage, deviceKey(hash))
    if (!legacy) return undefined
    const { lastPollAt: _, ...rest } = legacy
    await atomic.add(deviceKey(hash), rest, until(legacy))
    await Storage.remove(storage, deviceKey(hash))
    return (await atomic.get(deviceKey(hash))) ?? undefined
  }

  /** Move a pending record to its final state. False if it already moved. */
  const settle = (hash: string, record: DeviceRecord, next: DeviceRecord) =>
    atomic.replace(deviceKey(hash), record, next, until(record))

  /** Read and remove a sign-in handle (single use). */
  async function takeHandle(handle: string): Promise<HandleRecord | undefined> {
    const h = await atomic.take(handleKey(handle))
    if (h || !Storage.isAtomic(storage)) return h ?? undefined
    const legacy = await Storage.get<HandleRecord>(storage, handleKey(handle))
    if (legacy) await Storage.remove(storage, handleKey(handle))
    return legacy ?? undefined
  }
  // Storage TTL for a record's remaining life. Cloudflare KV needs >= 60 s; the
  // record's own expiresAt is always checked, so a longer TTL is harmless.
  const remaining = (r: DeviceRecord) =>
    Math.max(60, Math.ceil((r.expiresAt - Date.now()) / 1000))
  const page = (
    c: Context,
    input: Parameters<typeof DevicePage>[1],
    status?: number,
    headers?: Record<string, string>,
  ) =>
    DevicePage(restartLocale(c.req.raw), input, {
      theme: renderOptions(c).theme,
      status,
      headers,
    })

  async function recordForUserCode(
    code: string,
  ): Promise<{ hash: string; record: DeviceRecord } | null> {
    const hash = await Storage.get<string>(storage, userKey(code))
    if (!hash) return null
    const record = await loadRecord(hash)
    if (
      !record ||
      record.expiresAt <= Date.now() ||
      record.status !== "pending"
    )
      return null
    return { hash, record }
  }

  // RFC 8628 §3.1 / §3.2
  app.post("/device_authorization", async (c) => {
    const form = await c.req.formData().catch(() => null)
    const clientId = form?.get("client_id")?.toString()
    if (!clientId) return oauthError(c, "invalid_request", "Missing client_id")
    const client = await deps.clients.getClientById(clientId).catch(() => null)
    if (
      !client ||
      !client.enabled ||
      !client.grant_types.includes(DEVICE_CODE_GRANT)
    ) {
      return oauthError(
        c,
        "unauthorized_client",
        "Client is not allowed to use the device authorization grant",
      )
    }
    if (
      await hitRateLimit(
        storage,
        "authorize",
        `${clientId}:${clientIp(c)}`,
        requests,
      )
    ) {
      return oauthError(
        c,
        "slow_down",
        "Too many device authorization requests",
        429,
      )
    }
    const scope = form?.get("scope")?.toString() || undefined
    const deviceCode = randomToken(32)
    const hash = await hashDeviceCode(deviceCode)
    // Retry on the (unlikely) collision of a live user code
    let userCode = generateUserCode()
    for (
      let i = 0;
      i < 3 && (await Storage.get(storage, userKey(userCode)));
      i++
    )
      userCode = generateUserCode()
    const record: DeviceRecord = {
      clientID: clientId,
      clientName: client.name,
      userCode,
      scope,
      status: "pending",
      interval,
      expiresAt: Date.now() + expiresIn * 1000,
    }
    await atomic.set(deviceKey(hash), record, until(record))
    await Storage.set(storage, userKey(userCode), hash, expiresIn)
    const verificationUri =
      options.verificationUri ?? `${deps.issuer(c)}/activate`
    const displayed = `${userCode.slice(0, 4)}-${userCode.slice(4)}`
    const complete = new URL(verificationUri)
    complete.searchParams.set("user_code", displayed)
    return c.json(
      {
        device_code: deviceCode,
        user_code: displayed,
        verification_uri: verificationUri,
        verification_uri_complete: complete.toString(),
        expires_in: expiresIn,
        interval,
      },
      200,
      { "Cache-Control": "no-store" },
    )
  })

  // Enter the code (or arrive from the QR code with ?user_code=)
  app.get("/activate", async (c) => {
    const typed = c.req.query("user_code")
    if (typed === undefined) return page(c, { page: "enter" })
    if (await lookupLimited(c)) {
      return page(
        c,
        { page: "enter", error: "rate_limited", userCode: typed },
        429,
      )
    }
    const code = normalizeUserCode(typed)
    const found = code ? await recordForUserCode(code) : null
    if (!code || !found) {
      await lookupFailed(c)
      return page(c, { page: "enter", error: "invalid", userCode: typed }, 400)
    }
    const csrf = randomToken(16)
    const res = page(c, {
      page: "confirm",
      userCode: code,
      appName: found.record.clientName,
      csrf,
    })
    // The token is bound to the code shown on this page
    const cookie = `${CSRF_COOKIE}=${csrf}.${code}; Path=/activate; Max-Age=${remaining(found.record)}; HttpOnly; Secure; SameSite=Lax`
    res.headers.append("Set-Cookie", cookie)
    return res
  })

  // Approve or deny (double-submit CSRF token bound to the confirmed code)
  app.post("/activate", async (c) => {
    const form = await c.req.formData().catch(() => null)
    const csrf = form?.get("csrf")?.toString()
    const code = normalizeUserCode(form?.get("user_code")?.toString())
    const cookie = getCookie(c, CSRF_COOKIE)
    if (!csrf || !code || !cookie || cookie !== `${csrf}.${code}`)
      return page(c, { page: "failed" }, 400)
    if (await lookupLimited(c))
      return page(c, { page: "enter", error: "rate_limited" }, 429)
    const found = await recordForUserCode(code)
    if (!found) {
      await lookupFailed(c)
      return page(c, { page: "failed" }, 400)
    }
    setCookie(c, CSRF_COOKIE, "", { path: "/activate", maxAge: 0 })
    const ttl = remaining(found.record)

    if (form?.get("action")?.toString() !== "approve") {
      if (
        !(await settle(found.hash, found.record, {
          ...found.record,
          status: "denied",
        }))
      )
        return page(c, { page: "failed" }, 400)
      await Storage.remove(storage, userKey(code))
      return page(c, { page: "denied" })
    }

    const pkce = await generatePKCE()
    const handle = randomToken(24)
    const locale = restartLocale(c.req.raw)
    await atomic.set(
      handleKey(handle),
      {
        deviceKey: found.hash,
        verifier: pkce.verifier,
        locale,
      } satisfies HandleRecord,
      new Date(Date.now() + ttl * 1000),
    )
    const iss = deps.issuer(c)
    const authorize = new URL(`${iss}/authorize`)
    authorize.searchParams.set("client_id", found.record.clientID)
    authorize.searchParams.set("redirect_uri", `${iss}${DEVICE_CALLBACK_PATH}`)
    authorize.searchParams.set("response_type", "code")
    authorize.searchParams.set("state", handle)
    authorize.searchParams.set("code_challenge", pkce.challenge)
    authorize.searchParams.set("code_challenge_method", "S256")
    if (found.record.scope)
      authorize.searchParams.set("scope", found.record.scope)
    authorize.searchParams.set("lang", locale)
    // Bind the sign-in to this browser: the callback only accepts the handle
    // from the browser that confirmed the code, so a captured authorize link
    // can't be finished by someone else (device-flow phishing).
    setCookie(c, HANDLE_COOKIE, handle, {
      path: "/activate",
      maxAge: ttl,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    })
    return c.redirect(authorize.toString(), 302)
  })

  // The sign-in finished: redeem the code for the device
  app.get(DEVICE_CALLBACK_PATH, async (c) => {
    const handle = c.req.query("state")
    const code = c.req.query("code")
    const bound = getCookie(c, HANDLE_COOKIE)
    if (!handle || !bound || bound !== handle)
      return page(c, { page: "failed" }, 400)
    setCookie(c, HANDLE_COOKIE, "", { path: "/activate", maxAge: 0 })
    const h = await takeHandle(handle)
    if (!h) return page(c, { page: "failed" }, 400)
    const record = await loadRecord(h.deviceKey)
    if (
      !record ||
      record.expiresAt <= Date.now() ||
      record.status !== "pending"
    )
      return page(c, { page: "failed" }, 400)
    if (!code) {
      // The user cancelled the sign-in (error=access_denied) or it failed
      if (c.req.query("error") === "access_denied") {
        if (
          !(await settle(h.deviceKey, record, { ...record, status: "denied" }))
        )
          return page(c, { page: "failed" }, 400)
        await Storage.remove(storage, userKey(record.userCode))
        return page(c, { page: "denied" })
      }
      return page(c, { page: "failed" }, 400)
    }
    const redeemed = await redeemAuthorizationCode(storage, code)
    if (redeemed.replayed) {
      await deps.revokeCodeGrant(redeemed.replayed)
      return page(c, { page: "failed" }, 400)
    }
    const payload = redeemed.payload as
      (AuthorizationCodePayload & DeviceGrant) | undefined
    if (
      !payload ||
      payload.clientID !== record.clientID ||
      payload.redirectURI !== `${deps.issuer(c)}${DEVICE_CALLBACK_PATH}` ||
      !payload.pkce ||
      !(await validatePKCE(
        h.verifier,
        payload.pkce.challenge,
        payload.pkce.method,
      ))
    ) {
      return page(c, { page: "failed" }, 400)
    }
    const family = crypto.randomUUID()
    if (
      !(await consumeAuthorizationCode(storage, code, redeemed, {
        family,
        subject: payload.subject,
        clientID: payload.clientID,
      }))
    )
      return page(c, { page: "failed" }, 400)
    const grant: DeviceGrant = {
      type: payload.type,
      properties: payload.properties,
      subject: payload.subject,
      clientID: payload.clientID,
      ttl: payload.ttl,
      authTime: payload.authTime,
      family,
    }
    if (
      !(await settle(h.deviceKey, record, {
        ...record,
        status: "approved",
        grant,
      }))
    )
      return page(c, { page: "failed" }, 400)
    await Storage.remove(storage, userKey(record.userCode))
    return page(c, { page: "done" })
  })

  /** `/token` with the device_code grant (RFC 8628 §3.4, §3.5). */
  return async function deviceToken(
    c: Context,
    form: FormData,
  ): Promise<Response> {
    const deviceCode = form.get("device_code")?.toString()
    const clientId = form.get("client_id")?.toString()
    if (!deviceCode || !clientId)
      return oauthError(
        c,
        "invalid_request",
        "Missing device_code or client_id",
      )
    const hash = await hashDeviceCode(deviceCode)
    const record = await loadRecord(hash)
    if (!record || record.expiresAt <= Date.now())
      return oauthError(c, "expired_token", "The device code has expired")
    if (record.clientID !== clientId)
      return oauthError(
        c,
        "invalid_grant",
        "The device code was not issued to this client",
      )

    if (record.status !== "pending") {
      // Final state: hand it out once. Of concurrent polls exactly one takes
      // the record; the others find it gone.
      const taken = (await atomic.take(deviceKey(hash))) as
        DeviceRecord | undefined
      await atomic.remove(pollKey(hash))
      if (!taken)
        return oauthError(c, "expired_token", "The device code has expired")
      if (taken.status === "denied")
        return oauthError(c, "access_denied", "The user denied the request")
      if (taken.status === "approved" && taken.grant) {
        const tokens = await deps.generateTokens(c, taken.grant)
        return c.json(
          {
            access_token: tokens.access,
            token_type: "bearer",
            expires_in: tokens.expiresIn,
            refresh_token: tokens.refresh,
          },
          200,
          { "Cache-Control": "no-store" },
        )
      }
      return oauthError(c, "expired_token", "The device code has expired")
    }

    // Pending: only the poll state is written, never the device record
    const now = Date.now()
    const poll = (await atomic.get(pollKey(hash))) as PollState | undefined
    const last = poll?.lastPollAt ?? record.lastPollAt
    const current = poll?.interval ?? record.interval
    if (last && now - last < current * 1000) {
      const slower = current + 5
      await atomic.set(
        pollKey(hash),
        { lastPollAt: now, interval: slower } satisfies PollState,
        until(record),
      )
      return c.json(
        {
          error: "slow_down",
          error_description: "Polling too fast",
          interval: slower,
        },
        400,
        { "Cache-Control": "no-store" },
      )
    }
    await atomic.set(
      pollKey(hash),
      { lastPollAt: now, interval: current } satisfies PollState,
      until(record),
    )
    return oauthError(
      c,
      "authorization_pending",
      "The user has not approved the request yet",
    )
  }
}
