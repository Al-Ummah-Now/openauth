/**
 * Native passkey sign-in (AUTH-PASSKEYS "Native apps"): /native/passkey/options
 * and /verify on the enterprise issuer, and the code they issue at /token.
 */
import { beforeEach, describe, expect, test } from "bun:test"
import { decodeJwt } from "jose"
import { object, string } from "valibot"
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers"
import { createMultiTenantIssuer } from "../src/enterprise/issuer.js"
import { TenantServiceImpl } from "../src/tenant/service.js"
import { SessionServiceImpl } from "../src/session/service.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { Storage, type StorageAdapter } from "../src/storage/storage.js"
import { nativeChallengeKey } from "../src/native-passkey.js"
import type { PasskeyCredential } from "../src/passkey.js"

const HOST = "auth.example.com"
const ISSUER = `https://${HOST}`
const RP_ID = "example.com"
const RP_ORIGIN = `https://${RP_ID}`
const APK_ORIGIN =
  "android:apk-key-hash:Whs9K1dumi3wvxvj8YxAIBP5XAnq7nz3MRDEL7Vp3cA"
const STUDIO = {
  id: "studio-native",
  redirect: "alummahnow-studio://auth/callback",
}
const ADMIN = {
  id: "admin-native",
  redirect: "alummahnow-admin://auth/callback",
}
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk-native-verifier"

async function s256(verifier: string) {
  const d = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  )
  return isoBase64URL.fromBuffer(new Uint8Array(d))
}

class SoftAuthenticator {
  counter = 0
  id = isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(16)))
  private keys!: CryptoKeyPair
  publicKey = ""
  async init() {
    this.keys = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair
    const jwk = await crypto.subtle.exportKey("jwk", this.keys.publicKey)
    const cose = new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, isoBase64URL.toBuffer(jwk.x!)],
      [-3, isoBase64URL.toBuffer(jwk.y!)],
    ])
    this.publicKey = isoBase64URL.fromBuffer(isoCBOR.encode(cose as any))
    return this
  }
  async assert(
    challenge: string,
    opts: { origin?: string; rpID?: string; userHandle?: string } = {},
  ) {
    this.counter++
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        type: "webauthn.get",
        challenge,
        origin: opts.origin ?? RP_ORIGIN,
      }),
    )
    const rpHash = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(opts.rpID ?? RP_ID),
      ),
    )
    const authData = new Uint8Array(37)
    authData.set(rpHash, 0)
    authData[32] = 0x05
    new DataView(authData.buffer).setUint32(33, this.counter)
    const clientHash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", clientDataJSON),
    )
    const signed = new Uint8Array(authData.length + clientHash.length)
    signed.set(authData)
    signed.set(clientHash, authData.length)
    const raw = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        this.keys.privateKey,
        signed,
      ),
    )
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        authenticatorData: isoBase64URL.fromBuffer(authData),
        signature: isoBase64URL.fromBuffer(derSignature(raw)),
        userHandle: isoBase64URL.fromBuffer(
          new TextEncoder().encode(opts.userHandle ?? "user-1"),
        ),
      },
    }
  }
}
function derInt(bytes: Uint8Array) {
  let i = 0
  while (i < bytes.length - 1 && bytes[i] === 0) i++
  let v = bytes.slice(i)
  if (v[0] & 0x80) v = new Uint8Array([0, ...v])
  return new Uint8Array([0x02, v.length, ...v])
}
function derSignature(raw: Uint8Array) {
  const r = derInt(raw.slice(0, 32))
  const s = derInt(raw.slice(32))
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s])
}

let storage: StorageAdapter
let creds: Map<string, PasskeyCredential>
let successValues: any[]
let refusedUsers: Set<string>
let limitAllows: boolean
let failures: string[]
let sessionsCreated: number

async function createApp() {
  const tenantService = new TenantServiceImpl(storage)
  await tenantService.createTenant({ id: "default", name: "Default" })
  const sessionService = new SessionServiceImpl(storage)
  const create = sessionService.createBrowserSession.bind(sessionService)
  sessionService.createBrowserSession = async (
    ...args: Parameters<typeof create>
  ) => {
    sessionsCreated++
    return create(...args)
  }
  const { app } = createMultiTenantIssuer({
    tenantService,
    sessionService,
    storage,
    sessionSecret: new Uint8Array(32).fill(4),
    subjects: createSubjects({ user: object({ email: string() }) }),
    tenantResolver: { customDomains: new Map([[HOST, "default"]]) },
    issuer: ISSUER,
    providers: {
      dummy: { type: "dummy", init() {} },
    },
    nativePasskey: {
      rpID: () => RP_ID,
      origins: () => [ISSUER, RP_ORIGIN, APK_ORIGIN],
      store: {
        get: async (id) => creds.get(id),
        touch: async (id, counter) => {
          creds.get(id)!.counter = counter
        },
      },
      client: async (id) =>
        id === STUDIO.id
          ? { redirectURI: STUDIO.redirect }
          : id === ADMIN.id
            ? { redirectURI: ADMIN.redirect }
            : undefined,
      rateLimit: async () => limitAllows,
      onFailure: (reason) => failures.push(reason),
    },
    onSuccess: async (ctx, value) => {
      successValues.push(value)
      const userID = (value as any).userID
      if (refusedUsers.has(userID))
        return new Response("<p>suspended</p>", {
          status: 403,
          headers: { "content-type": "text/html" },
        })
      return ctx.subject("user", {
        email: "pk@example.com",
        id: userID,
        roles: ["Member"],
      } as any)
    },
  })
  return app
}

type App = Awaited<ReturnType<typeof createApp>>
function post(
  app: App,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(`${ISSUER}${path}`, {
    method: "POST",
    headers: { host: HOST, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}
async function options(app: App, client = STUDIO, verifier = VERIFIER) {
  const res = await post(app, "/native/passkey/options", {
    client_id: client.id,
    code_challenge: await s256(verifier),
    code_challenge_method: "S256",
  })
  expect(res.status).toBe(200)
  return (await res.json()) as { challenge_id: string; publicKey: any }
}
async function addAuthenticator(userID = "user-1") {
  const a = await new SoftAuthenticator().init()
  creds.set(a.id, { id: a.id, userID, publicKey: a.publicKey, counter: 0 })
  return a
}
async function exchange(
  app: App,
  code: string,
  client = STUDIO,
  verifier = VERIFIER,
) {
  return app.request(`${ISSUER}/token`, {
    method: "POST",
    headers: {
      host: HOST,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: client.id,
      code_verifier: verifier,
      redirect_uri: client.redirect,
    }).toString(),
  })
}

beforeEach(() => {
  storage = MemoryStorage()
  creds = new Map()
  successValues = []
  refusedUsers = new Set()
  limitAllows = true
  failures = []
  sessionsCreated = 0
})

describe("native passkey options", () => {
  test("discoverable request options with UV required, 2 minutes, and a challenge id", async () => {
    const app = await createApp()
    const body = await options(app)
    expect(body.challenge_id).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.publicKey.rpId).toBe(RP_ID)
    expect(body.publicKey.allowCredentials).toEqual([])
    expect(body.publicKey.userVerification).toBe("required")
    expect(body.publicKey.timeout).toBe(120000)
    expect(body.publicKey.challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    const stored = await Storage.atomic(storage).get(
      nativeChallengeKey(body.challenge_id),
    )
    expect(stored.clientID).toBe(STUDIO.id)
    expect(stored.codeChallenge).toBe(await s256(VERIFIER))
  })

  test("invalid_request for a bad body, plain PKCE or a malformed code challenge", async () => {
    const app = await createApp()
    for (const body of [
      "not json",
      {},
      {
        client_id: STUDIO.id,
        code_challenge: await s256(VERIFIER),
        code_challenge_method: "plain",
      },
      {
        client_id: STUDIO.id,
        code_challenge: "short",
        code_challenge_method: "S256",
      },
    ]) {
      const res = await post(app, "/native/passkey/options", body)
      expect(res.status).toBe(400)
      expect(((await res.json()) as any).error).toBe("invalid_request")
      expect(res.headers.get("cache-control")).toBe("no-store")
    }
  })

  test("invalid_client for a client that may not use native passkeys", async () => {
    const app = await createApp()
    const res = await post(app, "/native/passkey/options", {
      client_id: "viewer",
      code_challenge: await s256(VERIFIER),
      code_challenge_method: "S256",
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "invalid_client",
      error_description: expect.any(String),
    })
  })

  test("rate limited: 429 with Retry-After", async () => {
    const app = await createApp()
    limitAllows = false
    const res = await post(app, "/native/passkey/options", {
      client_id: STUDIO.id,
      code_challenge: await s256(VERIFIER),
      code_challenge_method: "S256",
    })
    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("60")
    expect(((await res.json()) as any).error).toBe("rate_limited")
  })
})

describe("native passkey verify", () => {
  test("a good assertion gives a code that /token exchanges with PKCE for passkey tokens", async () => {
    const app = await createApp()
    const a = await addAuthenticator()
    const { challenge_id, publicKey } = await options(app)
    const res = await post(app, "/native/passkey/verify", {
      challenge_id,
      client_id: STUDIO.id,
      credential: await a.assert(publicKey.challenge),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("set-cookie")).toBeNull()
    const { code } = (await res.json()) as { code: string }
    expect(code).toBeTruthy()
    expect(creds.get(a.id)!.counter).toBe(1)
    expect(successValues[0]).toMatchObject({
      provider: "passkey",
      userID: "user-1",
      credentialID: a.id,
      amr: ["passkey"],
    })
    expect(sessionsCreated).toBe(0)

    const payload = await Storage.atomic(storage).get(["oauth:code", code])
    expect(payload.clientID).toBe(STUDIO.id)
    expect(payload.redirectURI).toBe(STUDIO.redirect)
    expect(payload.pkce).toEqual({
      challenge: await s256(VERIFIER),
      method: "S256",
    })

    const token = await exchange(app, code)
    expect(token.status).toBe(200)
    const tokens = (await token.json()) as any
    const claims = decodeJwt(tokens.access_token)
    expect(claims.amr).toEqual(["passkey"])
    expect(typeof claims.auth_time).toBe("number")
    expect(tokens.refresh_token).toBeTruthy()
  })

  test("the code needs the right verifier and is single use", async () => {
    const app = await createApp()
    const a = await addAuthenticator()
    const { challenge_id, publicKey } = await options(app)
    const { code } = (await (
      await post(app, "/native/passkey/verify", {
        challenge_id,
        client_id: STUDIO.id,
        credential: await a.assert(publicKey.challenge),
      })
    ).json()) as { code: string }
    expect((await exchange(app, code, STUDIO, VERIFIER + "x")).status).toBe(400)
    expect((await exchange(app, code)).status).toBe(200)
    expect((await exchange(app, code)).status).toBe(400)
  })

  test("an Android apk-key-hash origin is accepted", async () => {
    const app = await createApp()
    const a = await addAuthenticator()
    const { challenge_id, publicKey } = await options(app)
    const res = await post(app, "/native/passkey/verify", {
      challenge_id,
      client_id: STUDIO.id,
      credential: await a.assert(publicKey.challenge, { origin: APK_ORIGIN }),
    })
    expect(res.status).toBe(200)
  })

  test("a replayed challenge is refused (single use)", async () => {
    const app = await createApp()
    const a = await addAuthenticator()
    const { challenge_id, publicKey } = await options(app)
    const first = await post(app, "/native/passkey/verify", {
      challenge_id,
      client_id: STUDIO.id,
      credential: await a.assert(publicKey.challenge),
    })
    expect(first.status).toBe(200)
    const again = await post(app, "/native/passkey/verify", {
      challenge_id,
      client_id: STUDIO.id,
      credential: await a.assert(publicKey.challenge),
    })
    expect(again.status).toBe(401)
    expect(((await again.json()) as any).error).toBe("invalid_credential")
    expect(failures).toContain("no_challenge")
  })

  test("another client's challenge is refused and used up", async () => {
    const app = await createApp()
    const a = await addAuthenticator()
    const { challenge_id, publicKey } = await options(app, STUDIO)
    const res = await post(app, "/native/passkey/verify", {
      challenge_id,
      client_id: ADMIN.id,
      credential: await a.assert(publicKey.challenge),
    })
    expect(res.status).toBe(401)
    expect(failures).toContain("wrong_client")
    const retry = await post(app, "/native/passkey/verify", {
      challenge_id,
      client_id: STUDIO.id,
      credential: await a.assert(publicKey.challenge),
    })
    expect(retry.status).toBe(401)
  })

  test("a wrong origin or RP id is refused", async () => {
    const app = await createApp()
    const a = await addAuthenticator()
    for (const opts of [
      { origin: "https://evil.example.net" },
      { origin: "android:apk-key-hash:AAAA" },
      { rpID: "evil.example.net" },
    ]) {
      const { challenge_id, publicKey } = await options(app)
      const res = await post(app, "/native/passkey/verify", {
        challenge_id,
        client_id: STUDIO.id,
        credential: await a.assert(publicKey.challenge, opts),
      })
      expect(res.status).toBe(401)
      expect(((await res.json()) as any).error).toBe("invalid_credential")
    }
    expect(successValues).toHaveLength(0)
  })

  test("a challenge is only good on the host (tenant) that issued it", async () => {
    const app = await createApp()
    const a = await addAuthenticator()
    const { challenge_id, publicKey } = await options(app)
    const key = nativeChallengeKey(challenge_id)
    const record = await Storage.atomic(storage).get(key)
    expect(record.host).toBe(HOST)
    await Storage.atomic(storage).set(key, {
      ...record,
      host: "auth.other-tenant.example",
    })
    const res = await post(app, "/native/passkey/verify", {
      challenge_id,
      client_id: STUDIO.id,
      credential: await a.assert(publicKey.challenge),
    })
    expect(res.status).toBe(401)
    expect(failures).toContain("wrong_host")
    expect(successValues).toHaveLength(0)
  })

  test("an expired challenge is refused", async () => {
    const app = await createApp()
    const a = await addAuthenticator()
    const { challenge_id, publicKey } = await options(app)
    const key = nativeChallengeKey(challenge_id)
    const record = await Storage.atomic(storage).get(key)
    await Storage.atomic(storage).set(key, {
      ...record,
      expires: Date.now() - 1,
    })
    const res = await post(app, "/native/passkey/verify", {
      challenge_id,
      client_id: STUDIO.id,
      credential: await a.assert(publicKey.challenge),
    })
    expect(res.status).toBe(401)
    expect(failures).toContain("expired_challenge")
  })

  test("unknown credential, wrong user handle and a refused account all read the same", async () => {
    const app = await createApp()
    const a = await addAuthenticator()
    const stranger = await new SoftAuthenticator().init()
    const bodies: any[] = []
    {
      const { challenge_id, publicKey } = await options(app)
      bodies.push(
        await post(app, "/native/passkey/verify", {
          challenge_id,
          client_id: STUDIO.id,
          credential: await stranger.assert(publicKey.challenge),
        }),
      )
    }
    {
      const { challenge_id, publicKey } = await options(app)
      bodies.push(
        await post(app, "/native/passkey/verify", {
          challenge_id,
          client_id: STUDIO.id,
          credential: await a.assert(publicKey.challenge, {
            userHandle: "user-2",
          }),
        }),
      )
    }
    refusedUsers.add("user-1")
    {
      const { challenge_id, publicKey } = await options(app)
      bodies.push(
        await post(app, "/native/passkey/verify", {
          challenge_id,
          client_id: STUDIO.id,
          credential: await a.assert(publicKey.challenge),
        }),
      )
    }
    const answers = await Promise.all(
      bodies.map(async (r) => [r.status, await r.json()]),
    )
    expect(new Set(answers.map((x) => JSON.stringify(x))).size).toBe(1)
    expect(answers[0][0]).toBe(401)
    expect(failures).toEqual([
      "unknown_credential",
      "wrong_user_handle",
      "account_refused",
    ])
  })

  test("verify is rate limited and checks the body", async () => {
    const app = await createApp()
    const bad = await post(app, "/native/passkey/verify", {
      challenge_id: "x",
      client_id: STUDIO.id,
      credential: {},
    })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as any).error).toBe("invalid_request")
    const unknownClient = await post(app, "/native/passkey/verify", {
      challenge_id: "a".repeat(43),
      client_id: "viewer",
      credential: { id: "x", type: "public-key", response: {} },
    })
    expect(unknownClient.status).toBe(400)
    expect(((await unknownClient.json()) as any).error).toBe("invalid_client")
    limitAllows = false
    const limited = await post(app, "/native/passkey/verify", {
      challenge_id: "a".repeat(43),
      client_id: STUDIO.id,
      credential: {},
    })
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toBe("60")
  })

  test("a browser's authorization cookie never changes where a native code goes", async () => {
    const app = await createApp()
    const a = await addAuthenticator()
    const { challenge_id, publicKey } = await options(app)
    const res = await post(
      app,
      "/native/passkey/verify",
      {
        challenge_id,
        client_id: STUDIO.id,
        credential: await a.assert(publicKey.challenge),
      },
      { cookie: "authorization=garbage" },
    )
    expect(res.status).toBe(200)
    const { code } = (await res.json()) as { code: string }
    expect(
      (await Storage.atomic(storage).get(["oauth:code", code])).redirectURI,
    ).toBe(STUDIO.redirect)
  })
})
