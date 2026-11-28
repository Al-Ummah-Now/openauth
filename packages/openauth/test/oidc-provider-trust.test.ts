import { expect, test } from "bun:test"
import { object, string } from "valibot"
import { issuer } from "../src/issuer.js"
import { OidcProvider } from "../src/provider/oidc.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { createSubjects } from "../src/subject.js"

test("OIDC fetches use approved origins and reject redirects", async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; redirect?: RequestRedirect }> = []
  const idp = "https://idp.example.com"
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), redirect: init?.redirect })
    return Response.json({
      authorization_endpoint: `${idp}/authorize`,
      jwks_uri: "https://unapproved.example.com/keys",
    })
  }) as typeof fetch
  try {
    const root = "https://auth.example.com"
    const app = issuer({
      issuer: root,
      subjects: createSubjects({ user: object({ id: string() }) }),
      storage: MemoryStorage(),
      allow: async () => true,
      providers: { oidc: OidcProvider({ issuer: idp, clientID: "client" }) },
      success: (ctx) => ctx.subject("user", { id: "person" }),
    })
    const cookieJar = new Map<string, string>()
    const receive = (response: Response) => {
      for (const value of response.headers.getSetCookie()) {
        const line = value.split(";")[0]!
        const eq = line.indexOf("=")
        cookieJar.set(line.slice(0, eq), line.slice(eq + 1))
      }
    }
    const headers = () => ({
      cookie: [...cookieJar].map(([k, v]) => `${k}=${v}`).join("; "),
    })
    const params = new URLSearchParams({
      redirect_uri: "https://app.example.com/callback",
      client_id: "app",
      response_type: "code",
      provider: "oidc",
    })
    const started = await app.request(`${root}/authorize?${params}`)
    receive(started)
    const toProvider = new URL(started.headers.get("location")!, root)
    const provider = await app.request(toProvider, { headers: headers() })
    receive(provider)
    const state = new URL(provider.headers.get("location")!).searchParams.get(
      "state",
    )!
    const callback = new URL("/oidc/callback", root)
    callback.search = toProvider.search
    await app.request(callback, {
      method: "POST",
      headers: headers(),
      body: new URLSearchParams({ state, id_token: "unverified" }),
    })
    expect(calls).toEqual([
      { url: `${idp}/.well-known/openid-configuration`, redirect: "error" },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})
