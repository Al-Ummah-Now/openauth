/**
 * `requireClientAuthentication`: listed confidential clients prove themselves
 * with their secret on the authorization_code and refresh_token grants, PKCE
 * or not (AlUmmahNowAuth#211).
 */
import { beforeEach, describe, expect, mock, test } from "bun:test"
import { object, string } from "valibot"
import { issuer } from "../src/issuer.js"
import { createClient } from "../src/client.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { hashClientSecret } from "../src/client/secret-generator.js"

const HOST = "https://auth.example.com"
const REDIRECT = "https://client.example.com/callback"
const subjects = createSubjects({ user: object({ userID: string() }) })

function mockD1(rows: Record<string, any>) {
  return {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        run: mock(async () => ({ success: true, meta: { changes: 1 } })),
        first: mock(async () =>
          sql.includes("FROM oauth_clients WHERE id = ?")
            ? (rows[params[0]] ?? null)
            : null,
        ),
        all: mock(async () => ({ results: [] })),
      }),
    }),
  }
}

function row(id: string, hash: string | null) {
  return {
    id,
    tenant_id: "default",
    name: id,
    client_secret_hash: hash,
    grant_types: JSON.stringify(["authorization_code", "refresh_token"]),
    scopes: JSON.stringify([]),
    redirect_uris: JSON.stringify([REDIRECT]),
    metadata: JSON.stringify({}),
    enabled: 1,
    created_at: 0,
    updated_at: 0,
  }
}

let db: ReturnType<typeof mockD1>
beforeEach(async () => {
  db = mockD1({
    conf: row("conf", await hashClientSecret("s3cret")),
    spa: row("spa", null),
  })
})

function makeIssuer(rule?: any) {
  return issuer({
    storage: MemoryStorage(),
    subjects,
    clientDb: db,
    allow: async () => true,
    ...(rule ? { requireClientAuthentication: rule } : {}),
    providers: {
      dummy: {
        type: "dummy",
        init(route: any, ctx: any) {
          route.get("/authorize", async (c: any) =>
            ctx.success(c, { email: "a@b.c" }),
          )
        },
      } as any,
    },
    success: async (ctx: any) => ctx.subject("user", { userID: "u1" }),
  } as any)
}
type Auth = ReturnType<typeof makeIssuer>

const clientFor = (auth: Auth, clientID: string, clientSecret?: string) =>
  createClient({
    issuer: HOST,
    clientID,
    clientSecret,
    fetch: (a, b) => Promise.resolve(auth.request(a, b)),
  })

async function code(auth: Auth, clientID: string) {
  const { challenge, url } = await clientFor(auth, clientID).authorize(
    REDIRECT,
    "code",
    { pkce: true },
  )
  let res = await auth.request(url)
  res = await auth.request(res.headers.get("location")!, {
    headers: { cookie: res.headers.get("set-cookie")! },
  })
  return {
    code: new URL(res.headers.get("location")!).searchParams.get("code")!,
    verifier: challenge.verifier,
  }
}

function token(
  body: Record<string, string>,
  headers: Record<string, string> = {},
) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(body).toString(),
  }
}

describe("authorization_code", () => {
  test("a listed client needs its secret even with PKCE", async () => {
    const auth = makeIssuer(["conf"])
    const c = await code(auth, "conf")
    const res = await auth.request(
      `${HOST}/token`,
      token({
        grant_type: "authorization_code",
        code: c.code,
        redirect_uri: REDIRECT,
        client_id: "conf",
        code_verifier: c.verifier,
      }),
    )
    expect(res.status).toBe(401)
    expect(((await res.json()) as any).error).toBe("invalid_client")
    // The failed attempt did not use the code up: the real client still can
    const ok = await clientFor(auth, "conf", "s3cret").exchange(
      c.code,
      REDIRECT,
      c.verifier,
    )
    expect(ok.err).toBe(false)
  })

  test("a wrong secret, or another client's, is refused", async () => {
    const auth = makeIssuer(["conf"])
    const c = await code(auth, "conf")
    const wrong = await clientFor(auth, "conf", "guess").exchange(
      c.code,
      REDIRECT,
      c.verifier,
    )
    expect(wrong.err).toBeTruthy()
    const other = await auth.request(
      `${HOST}/token`,
      token(
        {
          grant_type: "authorization_code",
          code: c.code,
          redirect_uri: REDIRECT,
          code_verifier: c.verifier,
        },
        { Authorization: `Basic ${btoa("spa:s3cret")}` },
      ),
    )
    // Refused before client authentication: the code is not this client's
    expect(other.status).toBe(403)
  })

  test("unlisted clients keep PKCE-only exchange", async () => {
    const auth = makeIssuer(["conf"])
    const c = await code(auth, "spa")
    const ok = await clientFor(auth, "spa").exchange(
      c.code,
      REDIRECT,
      c.verifier,
    )
    expect(ok.err).toBe(false)
  })

  test("the rule can be a function", async () => {
    const auth = makeIssuer((id: string) => id === "conf")
    const c = await code(auth, "conf")
    const res = await clientFor(auth, "conf").exchange(
      c.code,
      REDIRECT,
      c.verifier,
    )
    expect(res.err).toBeTruthy()
  })
})

describe("refresh_token", () => {
  async function signedIn(auth: Auth) {
    const c = await code(auth, "conf")
    const ex = await clientFor(auth, "conf", "s3cret").exchange(
      c.code,
      REDIRECT,
      c.verifier,
    )
    if (ex.err) throw ex.err
    return ex.tokens.refresh
  }

  test("a listed client's refresh token is useless without the secret", async () => {
    const auth = makeIssuer(["conf"])
    const refresh = await signedIn(auth)
    const bare = await auth.request(
      `${HOST}/token`,
      token({ grant_type: "refresh_token", refresh_token: refresh }),
    )
    expect(bare.status).toBe(401)
    const wrong = await clientFor(auth, "conf", "guess").refresh(refresh)
    expect(wrong.err).toBeTruthy()
    // Not spent by the refused attempts
    const ok = await clientFor(auth, "conf", "s3cret").refresh(refresh)
    expect(ok.err).toBe(false)
  })

  test("the secret in the form works too", async () => {
    const auth = makeIssuer(["conf"])
    const refresh = await signedIn(auth)
    const res = await auth.request(
      `${HOST}/token`,
      token({
        grant_type: "refresh_token",
        refresh_token: refresh,
        client_id: "conf",
        client_secret: "s3cret",
      }),
    )
    expect(res.status).toBe(200)
  })

  test("without the rule a refresh needs no secret (unchanged)", async () => {
    const auth = makeIssuer()
    const refresh = await signedIn(auth)
    const ok = await clientFor(auth, "conf").refresh(refresh)
    expect(ok.err).toBe(false)
  })
})

describe("multi-tenant issuer", () => {
  test("passes the rule to the token endpoint", async () => {
    const { createMultiTenantIssuer } =
      await import("../src/enterprise/issuer.js")
    const { TenantServiceImpl } = await import("../src/tenant/service.js")
    const { SessionServiceImpl } = await import("../src/session/service.js")
    const { storeRefreshToken, refreshKey } =
      await import("../src/refresh-token.js")
    const enterprise = async (rule?: string[]) => {
      const storage = MemoryStorage()
      const tenantService = new TenantServiceImpl(storage)
      await tenantService.createTenant({ id: "default", name: "Default" })
      await storeRefreshToken(
        storage,
        refreshKey("user:u1", "tok"),
        {
          type: "user",
          properties: { userID: "u1", tenantId: "default" },
          clientID: "conf",
          subject: "user:u1",
          ttl: { access: 900, refresh: 86400 },
          nextToken: "",
        },
        86400,
      )
      return createMultiTenantIssuer({
        tenantService,
        sessionService: new SessionServiceImpl(storage),
        storage,
        sessionSecret: new Uint8Array(32).fill(3),
        subjects,
        tenantResolver: {
          customDomains: new Map([["auth.example.com", "default"]]),
        },
        clientDb: db as any,
        ...(rule ? { requireClientAuthentication: rule } : {}),
        providers: { dummy: { type: "dummy", init() {} } },
        onSuccess: async (ctx: any) => ctx.subject("user", { userID: "u1" }),
      } as any).app
    }
    const post = (app: any, headers: Record<string, string> = {}) =>
      app.request(`${HOST}/token`, {
        ...token(
          { grant_type: "refresh_token", refresh_token: "user:u1:tok" },
          headers,
        ),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          host: "auth.example.com",
          ...headers,
        },
      })
    const strict = await enterprise(["conf"])
    const bare = await post(strict)
    expect(bare.status).toBe(401)
    expect(((await bare.json()) as any).error).toBe("invalid_client")
    expect(
      (await post(strict, { Authorization: `Basic ${btoa("conf:s3cret")}` }))
        .status,
    ).toBe(200)
    expect((await post(await enterprise())).status).toBe(200)
  })
})
