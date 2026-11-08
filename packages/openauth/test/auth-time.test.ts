/**
 * OIDC `auth_time` on access tokens: the time the user last authenticated,
 * kept across refreshes, so resource servers can require a recent sign-in for
 * sensitive actions (account deletion). Access tokens also carry `iat`.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test"
import { decodeJwt } from "jose"
import { object, string } from "valibot"
import { issuer } from "../src/issuer.js"
import { createClient } from "../src/client.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import type { Provider } from "../src/provider/provider.js"

const subjects = createSubjects({ user: object({ userID: string() }) })

function makeIssuer() {
  return issuer({
    storage: MemoryStorage(),
    subjects,
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
}

async function signIn(auth: ReturnType<typeof makeIssuer>) {
  const client = createClient({
    issuer: "https://auth.example.com",
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

const T0 = new Date("2026-01-01T00:00:00Z")

beforeEach(() => setSystemTime(T0))
afterEach(() => setSystemTime())

describe("auth_time", () => {
  test("is the sign-in time, with iat, on the first access token", async () => {
    const { tokens } = await signIn(makeIssuer())
    const claims = decodeJwt(tokens.access)
    expect(claims.auth_time).toBe(T0.getTime() / 1000)
    expect(claims.iat).toBe(T0.getTime() / 1000)
  })

  test("survives refreshes: a refreshed token reports the original sign-in", async () => {
    const auth = makeIssuer()
    const { client, tokens } = await signIn(auth)
    setSystemTime(new Date(T0.getTime() + 3_600_000))
    const refreshed = await client.refresh(tokens.refresh)
    if (refreshed.err) throw refreshed.err
    const claims = decodeJwt(refreshed.tokens!.access)
    expect(claims.auth_time).toBe(T0.getTime() / 1000)
    expect(claims.iat).toBe(T0.getTime() / 1000 + 3600)
  })

  test("client credentials tokens have no auth_time (no user signed in)", async () => {
    const auth = makeIssuer()
    const res = await auth.request("https://auth.example.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        provider: "dummy",
        client_id: "x",
        client_secret: "y",
      }),
    })
    const body = (await res.json()) as { access_token: string }
    expect(decodeJwt(body.access_token).auth_time).toBeUndefined()
  })
})
