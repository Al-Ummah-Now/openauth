/**
 * `accessTokenClaims`: extra top-level claims on access tokens, computed at
 * sign-in and at each refresh, stored nowhere; and `extraClaimsSupported` in
 * OpenID discovery.
 */
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { decodeJwt } from "jose"
import { object, string } from "valibot"
import { issuer } from "../src/issuer.js"
import { createClient } from "../src/client.js"
import { createMultiTenantIssuer } from "../src/enterprise/issuer.js"
import { SessionServiceImpl } from "../src/session/service.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { TenantServiceImpl } from "../src/tenant/service.js"
import type { AccessTokenClaims } from "../src/access-token-claims.js"
import type { Provider } from "../src/provider/provider.js"

const ISSUER = "https://auth.example.com"
const subjects = createSubjects({ user: object({ userID: string() }) })
const errors = spyOn(console, "error").mockImplementation(mock())
afterEach(() => errors.mockClear())

function makeIssuer(accessTokenClaims?: AccessTokenClaims) {
  const storage = MemoryStorage()
  const auth = issuer({
    storage,
    subjects,
    accessTokenClaims,
    allow: async () => true,
    ttl: { access: 60, refresh: 6000, refreshReuse: 0 },
    providers: {
      dummy: {
        type: "dummy",
        init(route, ctx) {
          route.get("/authorize", (c) => ctx.success(c, { email: "a@b.c" }))
        },
        client: async () => ({ email: "a@b.c" }),
      } satisfies Provider<{ email: string }>,
    },
    success: async (ctx) => ctx.subject("user", { userID: "123" }),
  })
  return { auth, storage }
}

async function signIn({ auth }: ReturnType<typeof makeIssuer>) {
  const client = createClient({
    issuer: ISSUER,
    clientID: "app",
    fetch: (a, b) => Promise.resolve(auth.request(a, b)),
  })
  const { challenge, url } = await client.authorize(
    "https://app.example.com/cb",
    "code",
    { pkce: true },
  )
  let res = await auth.request(url)
  res = await auth.request(res.headers.get("location")!, {
    headers: { cookie: res.headers.get("set-cookie")! },
  })
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!
  const exchanged = await client.exchange(
    code,
    "https://app.example.com/cb",
    challenge.verifier,
  )
  if (exchanged.err) throw exchanged.err
  return { client, tokens: exchanged.tokens }
}

describe("accessTokenClaims", () => {
  test("adds top-level claims, computed again at each refresh", async () => {
    let value = "one"
    const inputs: unknown[] = []
    const made = makeIssuer(async (input) => {
      inputs.push(input)
      return { extra: value, flag: true, count: 2 }
    })
    const { client, tokens } = await signIn(made)
    const first = decodeJwt(tokens.access)
    expect([first.extra, first.flag, first.count]).toEqual(["one", true, 2])
    expect(inputs[0]).toEqual({
      type: "user",
      properties: { userID: "123" },
      subject: first.sub,
      clientID: "app",
    })
    value = "two"
    const refreshed = await client.refresh(tokens.refresh)
    if (refreshed.err) throw refreshed.err
    const second = decodeJwt(refreshed.tokens!.access)
    expect(second.extra).toBe("two")
    // Not part of the subject, so the subject id is the same
    expect(second.sub).toBe(first.sub)
    expect(second.properties).toEqual({ userID: "123" })
  })

  test("is stored nowhere", async () => {
    const made = makeIssuer(async () => ({ extra: "stored-nowhere" }))
    const { tokens } = await signIn(made)
    const all: string[] = []
    for await (const [, value] of made.storage.scan(["oauth:refresh"]))
      all.push(JSON.stringify(value))
    expect(all.length).toBeGreaterThan(0)
    expect(all.join()).not.toContain("stored-nowhere")
    const info = await made.auth.request(`${ISSUER}/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.access}` },
    })
    expect(await info.text()).not.toContain("stored-nowhere")
  })

  test("never sets a standard claim, and drops values that aren't plain", async () => {
    const { tokens } = await signIn(
      makeIssuer(
        async () =>
          ({
            iss: "https://evil.example",
            sub: "user:other",
            aud: "other",
            exp: 1,
            type: "admin",
            mode: "refresh",
            properties: "x",
            auth_time: 1,
            amr: "passkey",
            sid: "x",
            client_id: "m2m",
            scope: "all",
            object: { a: 1 },
            none: null,
            nan: Number.NaN,
            kept: "yes",
          }) as any,
      ),
    )
    const claims = decodeJwt(tokens.access)
    expect(claims.iss).toBe(ISSUER)
    expect(claims.aud).toBe("app")
    expect(claims.type).toBe("user")
    expect(claims.mode).toBe("access")
    expect(claims.properties).toEqual({ userID: "123" })
    expect(claims.auth_time).toBeGreaterThan(1)
    for (const name of ["client_id", "scope", "object", "none", "nan"])
      expect(claims[name]).toBeUndefined()
    expect(claims.kept).toBe("yes")
  })

  test("a hook that throws adds none, the sign-in works, and its error isn't logged", async () => {
    const { tokens } = await signIn(
      makeIssuer(async () => {
        throw new Error("1990-01-02")
      }),
    )
    expect(decodeJwt(tokens.access).aud).toBe("app")
    expect(JSON.stringify(errors.mock.calls)).toContain("accessTokenClaims")
    expect(JSON.stringify(errors.mock.calls)).not.toContain("1990-01-02")
  })

  test("without a hook, and with one that has nothing, nothing is added", async () => {
    const plain = decodeJwt((await signIn(makeIssuer())).tokens.access)
    const empty = decodeJwt(
      (await signIn(makeIssuer(async () => undefined))).tokens.access,
    )
    expect(Object.keys(empty).sort()).toEqual(Object.keys(plain).sort())
  })
})

describe("extraClaimsSupported", () => {
  async function document(extraClaimsSupported?: () => Promise<string[]>) {
    const storage = MemoryStorage()
    const tenantService = new TenantServiceImpl(storage)
    await tenantService.createTenant({ id: "default", name: "Default" })
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService: new SessionServiceImpl(storage),
      storage,
      sessionSecret: new Uint8Array(32).fill(7),
      subjects,
      issuer: ISSUER,
      tenantResolver: {
        customDomains: new Map([["auth.example.com", "default"]]),
      },
      providers: {
        dummy: {
          type: "dummy",
          init(route: any, ctx: any) {
            route.get("/authorize", (c: any) =>
              ctx.success(c, { email: "a@b.c" }),
            )
          },
        },
      },
      extraClaimsSupported,
      onSuccess: async (ctx: any) => ctx.subject("user", { userID: "1" }),
    } as any)
    const res = await app.request(
      `${ISSUER}/.well-known/openid-configuration`,
      { headers: { host: "auth.example.com" } },
    )
    return (await res.json()) as { claims_supported: string[] }
  }

  test("follows the hook for each document; an error lists none", async () => {
    const base = (await document()).claims_supported
    expect(base).not.toContain("extra")
    expect((await document(async () => ["extra"])).claims_supported).toEqual([
      ...base,
      "extra",
    ])
    expect(
      (
        await document(async () => {
          throw new Error("down")
        })
      ).claims_supported,
    ).toEqual(base)
  })
})
