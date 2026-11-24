/**
 * The issuer the Python and Go examples are tested against: in memory, on a free
 * port, gone when the process ends. Prints its URL, then serves.
 *
 *   bun examples/test/issuer.ts
 */
import { object, string } from "valibot"
import { hashClientSecret } from "../../packages/openauth/src/client/secret-generator"
import { issuer } from "../../packages/openauth/src/issuer"
import {
  addPendingSigningKey,
  clearKeyCache,
} from "../../packages/openauth/src/keys"
import { MemoryStorage } from "../../packages/openauth/src/storage/memory"
import { createSubjects } from "../../packages/openauth/src/subject"

const row = (
  id: string,
  secretHash: string | null,
  grants: string[],
  scopes: string[] = [],
) => ({
  id,
  tenant_id: "default",
  name: id,
  client_secret_hash: secretHash,
  grant_types: JSON.stringify(grants),
  scopes: JSON.stringify(scopes),
  redirect_uris: JSON.stringify(["http://localhost:9999/callback"]),
  metadata: "{}",
  enabled: 1,
  created_at: 0,
  updated_at: 0,
})
const clients: Record<string, unknown> = {
  "example-web": row("example-web", null, [
    "authorization_code",
    "refresh_token",
  ]),
  "example-server": row(
    "example-server",
    await hashClientSecret("example-secret"),
    ["client_credentials"],
    ["users:read"],
  ),
}

const storage = MemoryStorage()
let app: ReturnType<typeof issuer>
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const { pathname } = new URL(req.url)
    // Tests only: a second key, signing from now on
    if (req.method === "POST" && pathname === "/test/rotate") {
      await addPendingSigningKey(storage, Date.now())
      clearKeyCache()
      return new Response(null, { status: 204 })
    }
    return app.fetch(req)
  },
})
const url = `http://127.0.0.1:${server.port}`
app = issuer({
  issuer: url,
  storage,
  subjects: createSubjects({
    user: object({ id: string(), email: string() }),
  }),
  clientDb: {
    prepare: () => ({
      bind: (id: string) => ({
        first: async () => clients[id] ?? null,
        run: async () => ({ success: true, meta: { changes: 1 } }),
        all: async () => ({ results: [] }),
      }),
    }),
  } as any,
  pkce: { requireForPublicClients: true, requireForCodeExchange: true },
  ttl: { access: 60 },
  allow: async (input) =>
    input.redirectURI === "http://localhost:9999/callback",
  providers: {
    // Signs the same person in at once: these tests are about the client
    instant: {
      type: "instant",
      init(route, ctx) {
        route.get("/authorize", (c) =>
          ctx.success(c, { email: "person@example.com" }),
        )
      },
    },
  },
  success: (ctx, value) =>
    ctx.subject("user", { id: "usr_1", email: (value as any).email }),
})
console.log(url)
