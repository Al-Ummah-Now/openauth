/**
 * Native app clients (RFC 8252): per-client PKCE, private-use URI schemes and
 * loopback redirects with a run-time port, through the enterprise issuer with
 * the client registry on.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test"
import { object, string } from "valibot"
import { createMultiTenantIssuer } from "../src/enterprise/issuer.js"
import { TenantServiceImpl } from "../src/tenant/service.js"
import { SessionServiceImpl } from "../src/session/service.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import type { StorageAdapter } from "../src/storage/storage.js"
import { PasswordProvider } from "../src/provider/password.js"
import { PasswordUI } from "../src/ui/password.js"
import {
  clientRequiresPkce,
  isAllowedRedirectScheme,
  redirectUriMatches,
} from "../src/client/native.js"

const HOST = "auth.example.com"
const SCHEME = "alummahnow://auth/callback"
const LOOPBACK = "http://127.0.0.1/auth/callback"
const UNIVERSAL = "https://videos.example.com/app/auth/callback"
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

function mockD1(rows: any[]) {
  const clients = new Map(rows.map((r) => [r.id, r]))
  return {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        first: mock(async () =>
          sql.includes("FROM oauth_clients WHERE id = ?")
            ? clients.get(params[0]) || null
            : null,
        ),
        run: mock(async () => ({ success: true, meta: { changes: 0 } })),
        all: mock(async () => ({ results: [] })),
      }),
    }),
  }
}

function row(
  id: string,
  uris: string[],
  metadata: object,
  secret: string | null = null,
) {
  return {
    id,
    tenant_id: "default",
    name: id,
    client_secret_hash: secret,
    grant_types: JSON.stringify(["authorization_code", "refresh_token"]),
    scopes: "[]",
    redirect_uris: JSON.stringify(uris),
    metadata: JSON.stringify(metadata),
    enabled: 1,
    created_at: 0,
    updated_at: 0,
  }
}

const db = mockD1([
  row("viewer-mobile", [SCHEME, UNIVERSAL], {
    type: "native",
    pkce: "required",
  }),
  row("viewer-desktop", [SCHEME, LOOPBACK], { type: "native" }),
  row("legacy-web", ["https://videos.example.com/api/callback"], {
    type: "public",
  }),
  row("evil-registered", ["javascript://x/%0aalert(1)"], { type: "native" }),
])

let storage: StorageAdapter
beforeEach(() => {
  storage = MemoryStorage()
})

async function app(registry: boolean = true) {
  const tenantService = new TenantServiceImpl(storage)
  await tenantService.createTenant({ id: "default", name: "Default" })
  return createMultiTenantIssuer({
    tenantService,
    sessionService: new SessionServiceImpl(storage),
    storage,
    sessionSecret: new Uint8Array(32).fill(5),
    subjects: createSubjects({ user: object({ email: string() }) }),
    tenantResolver: { customDomains: new Map([[HOST, "default"]]) },
    clientDb: db as any,
    clientRegistry: registry ? { mode: "enforce" } : undefined,
    restart: { fallbackUrl: "https://videos.example.com/" },
    providers: {
      password: PasswordProvider(
        PasswordUI({ sendCode: async () => undefined }),
      ),
    },
    onSuccess: async (ctx, v) =>
      ctx.subject("user", { email: (v as any).email } as any),
  }).app
}

function authorize(
  a: Awaited<ReturnType<typeof app>>,
  clientId: string,
  redirect: string,
  pkce = true,
) {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    state: "s",
    redirect_uri: redirect,
  })
  if (pkce) {
    q.set("code_challenge", CHALLENGE)
    q.set("code_challenge_method", "S256")
  }
  return a.request(`https://${HOST}/authorize?${q}`, {
    headers: { host: HOST },
  })
}

const signInForm = (res: Response) => {
  expect(res.status).toBe(302)
  expect(res.headers.get("location")).toContain("/password/authorize")
}

describe("native clients through /authorize", () => {
  test("a registered custom scheme with PKCE gets the sign-in form", async () => {
    signInForm(await authorize(await app(), "viewer-mobile", SCHEME))
  })

  test("a registered universal link with PKCE gets the sign-in form", async () => {
    signInForm(await authorize(await app(), "viewer-mobile", UNIVERSAL))
  })

  test("a native client without PKCE is sent back with invalid_request", async () => {
    const res = await authorize(await app(), "viewer-mobile", SCHEME, false)
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get("location")!)
    expect(`${location.protocol}//${location.host}${location.pathname}`).toBe(
      SCHEME,
    )
    expect(location.searchParams.get("error")).toBe("invalid_request")
    expect(location.searchParams.get("state")).toBe("s")
  })

  test("plain PKCE is refused", async () => {
    const q = new URLSearchParams({
      client_id: "viewer-mobile",
      response_type: "code",
      state: "s",
      redirect_uri: SCHEME,
      code_challenge: "abc",
      code_challenge_method: "plain",
    })
    const res = await (
      await app()
    ).request(`https://${HOST}/authorize?${q}`, { headers: { host: HOST } })
    expect(
      new URL(res.headers.get("location")!).searchParams.get("error"),
    ).toBe("invalid_request")
  })

  test("an unregistered custom scheme is refused", async () => {
    const res = await authorize(
      await app(),
      "viewer-mobile",
      "alummahnow://evil/callback",
    )
    expect(res.status).toBe(400)
    expect(res.headers.get("location")).toBeNull()
  })

  test("a custom scheme registered for another client is refused", async () => {
    const res = await authorize(await app(), "legacy-web", SCHEME)
    expect(res.status).toBe(400)
    expect(res.headers.get("location")).toBeNull()
  })

  test("custom schemes need the client registry", async () => {
    const res = await authorize(await app(false), "viewer-mobile", SCHEME)
    expect(res.status).toBe(400)
    expect(res.headers.get("location")).toBeNull()
  })

  test("a registered javascript: URI is still refused", async () => {
    const res = await authorize(
      await app(),
      "evil-registered",
      "javascript://x/%0aalert(1)",
    )
    expect(res.status).toBe(400)
    expect(res.headers.get("location")).toBeNull()
  })

  test("desktop loopback: any port, same host and path", async () => {
    const a = await app()
    signInForm(
      await authorize(
        a,
        "viewer-desktop",
        "http://127.0.0.1:53124/auth/callback",
      ),
    )
    const other = await authorize(
      a,
      "viewer-desktop",
      "http://127.0.0.1:53124/other",
    )
    expect(other.status).toBe(400)
  })

  test("existing secret-less web clients are unaffected (no PKCE required)", async () => {
    signInForm(
      await authorize(
        await app(),
        "legacy-web",
        "https://videos.example.com/api/callback",
        false,
      ),
    )
  })
})

describe("clientRequiresPkce", () => {
  test("native or pkce=required clients always", () => {
    expect(
      clientRequiresPkce({
        client_secret_hash: "",
        metadata: { type: "native" },
      }),
    ).toBe(true)
    expect(
      clientRequiresPkce({
        client_secret_hash: "h",
        metadata: { pkce: "required" },
      }),
    ).toBe(true)
  })
  test("public clients only under requireForPublicClients", () => {
    const spa = {
      client_secret_hash: null as any,
      metadata: { type: "public" },
    }
    expect(clientRequiresPkce(spa)).toBe(false)
    expect(clientRequiresPkce(spa, { requireForPublicClients: true })).toBe(
      true,
    )
    expect(
      clientRequiresPkce(
        { client_secret_hash: "h", metadata: {} },
        { requireForPublicClients: true },
      ),
    ).toBe(false)
    expect(clientRequiresPkce(null, { requireForPublicClients: true })).toBe(
      false,
    )
  })
})

describe("redirect URI rules", () => {
  test("exact match, loopback port variance only", () => {
    const reg = [SCHEME, LOOPBACK, "http://[::1]/cb"]
    expect(redirectUriMatches(reg, SCHEME)).toBe(true)
    expect(redirectUriMatches(reg, `${SCHEME}?x=1`)).toBe(false)
    expect(redirectUriMatches(reg, "http://127.0.0.1:8080/auth/callback")).toBe(
      true,
    )
    expect(redirectUriMatches(reg, "http://[::1]:9000/cb")).toBe(true)
    expect(
      redirectUriMatches(reg, "http://127.0.0.1:8080/auth/callback?x=1"),
    ).toBe(false)
    expect(redirectUriMatches(reg, "http://localhost:8080/auth/callback")).toBe(
      false,
    )
    expect(
      redirectUriMatches(reg, "https://127.0.0.1:8080/auth/callback"),
    ).toBe(false)
    expect(
      redirectUriMatches(reg, "http://user@127.0.0.1:8080/auth/callback"),
    ).toBe(false)
  })
  test("safe schemes", () => {
    for (const ok of [
      SCHEME,
      "com.example.app:/oauth2redirect",
      "https://a.example/cb",
      LOOPBACK,
      "http://localhost:3000/cb",
    ])
      expect(isAllowedRedirectScheme(ok)).toBe(true)
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "http://evil.example/cb",
      "vbscript:x",
      "not a url",
    ])
      expect(isAllowedRedirectScheme(bad)).toBe(false)
  })
})
