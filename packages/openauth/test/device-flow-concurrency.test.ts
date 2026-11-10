/**
 * OA-4: polls never overwrite an approval, and an approved (or denied) device
 * code is handed out exactly once, across processes with stale KV caches.
 */
import { describe, expect, mock, test } from "bun:test"
import { object, string } from "valibot"
import { issuer } from "../src/issuer.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { Storage, type StorageAdapter } from "../src/storage/storage.js"
import { DEVICE_CODE_GRANT, hashDeviceCode } from "../src/device.js"
import { EventualKV, SharedAtomicStore } from "./support/consistency-fakes.js"

const HOST = "https://auth.example.com"
const subjects = createSubjects({ user: object({ userID: string() }) })

const clientRow = {
  id: "tv",
  tenant_id: "default",
  name: "TV",
  client_secret_hash: null,
  grant_types: JSON.stringify([DEVICE_CODE_GRANT, "refresh_token"]),
  scopes: "[]",
  redirect_uris: "[]",
  metadata: JSON.stringify({ type: "native" }),
  enabled: 1,
  created_at: 0,
  updated_at: 0,
}
const db = {
  prepare: (sql: string) => ({
    bind: (...params: any[]) => ({
      run: mock(async () => ({ success: true, meta: { changes: 1 } })),
      first: mock(async () =>
        sql.includes("FROM oauth_clients WHERE id = ?") && params[0] === "tv"
          ? clientRow
          : null,
      ),
      all: mock(async () => ({ results: [] })),
    }),
  }),
}

function makeIssuer(storage: StorageAdapter) {
  return issuer({
    storage,
    subjects,
    allow: async () => true,
    clientDb: db as any,
    device: { lookupsPerMinute: 10_000, requestsPerMinute: 10_000 },
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

// Each test uses its own IP so the per-IP limits never interfere
let ipSeq = 0
const ip = () => `10.${(++ipSeq >> 8) & 255}.${ipSeq & 255}.1`

function post(
  auth: Auth,
  path: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
) {
  return auth.request(`${HOST}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": "1.2.3.4",
      ...headers,
    },
    body: new URLSearchParams(body).toString(),
  })
}
const get = (auth: Auth, url: string, headers: Record<string, string> = {}) =>
  auth.request(url.startsWith("http") ? url : `${HOST}${url}`, {
    headers: { "cf-connecting-ip": "1.2.3.4", ...headers },
  })

async function startDevice(auth: Auth) {
  const res = await post(
    auth,
    "/device_authorization",
    { client_id: "tv" },
    {
      "cf-connecting-ip": ip(),
    },
  )
  expect(res.status).toBe(200)
  return (await res.json()) as { device_code: string; user_code: string }
}

async function poll(auth: Auth, deviceCode: string) {
  const res = await post(auth, "/token", {
    grant_type: DEVICE_CODE_GRANT,
    device_code: deviceCode,
    client_id: "tv",
  })
  return { status: res.status, body: (await res.json()) as any }
}

const cookieNamed = (res: Response, name: string) =>
  (res.headers.get("set-cookie") ?? "")
    .split(/,\s*(?=[^;=]+=)/)
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1)

/** Confirm the code and sign in; returns the callback request, not yet sent. */
async function prepareApproval(
  auth: Auth,
  userCode: string,
  action = "approve",
) {
  const page = await get(auth, `/activate?user_code=${userCode}`)
  const html = await page.text()
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]
  const cookie = page.headers.get("set-cookie")!.split(";")[0]
  const res = await post(
    auth,
    "/activate",
    { user_code: userCode, csrf, action },
    { cookie },
  )
  if (action !== "approve") return { denyResponse: res }
  const handle = cookieNamed(res, "__device_handle")!
  let r = await get(auth, res.headers.get("location")!)
  const cookies = r.headers.get("set-cookie") ?? ""
  while (
    r.status === 302 &&
    !r.headers.get("location")!.includes("/activate/callback")
  )
    r = await get(auth, r.headers.get("location")!, { cookie: cookies })
  const callback = r.headers.get("location")!
  return { send: () => get(auth, callback, { cookie: handle }) }
}

describe("polls never overwrite the approval", () => {
  test("PoP B polled (cached 'pending'), A approves, B polls again: the approval survives", async () => {
    const kv = new EventualKV()
    const d1 = new SharedAtomicStore()
    const a = makeIssuer(kv.pop(d1.adapter()))
    const b = makeIssuer(kv.pop(d1.adapter()))
    const d = await startDevice(a)
    expect((await poll(b, d.device_code)).body.error).toBe(
      "authorization_pending",
    )
    const approval = await prepareApproval(a, d.user_code)
    expect((await approval.send!()).status).toBe(200)
    // B's cached copy says pending; the old code wrote {pending, lastPollAt} back here
    const ok = await poll(b, d.device_code)
    expect(ok.status).toBe(200)
    expect(ok.body.access_token).toBeString()
    expect((await poll(a, d.device_code)).body.error).toBe("expired_token")
  })

  test("the same sequence without an atomic store loses the approval (the old defect)", async () => {
    const kv = new EventualKV()
    const a = makeIssuer(kv.pop())
    const b = makeIssuer(kv.pop())
    const d = await startDevice(a)
    await poll(b, d.device_code)
    const approval = await prepareApproval(a, d.user_code)
    await approval.send!()
    await new Promise((r) => setTimeout(r, 5))
    await poll(b, d.device_code)
    // B wrote back its stale pending copy; nobody ever gets the tokens
    expect((await poll(b, d.device_code)).status).toBe(400)
  })

  test("approval lands while 60 polls run in parallel on 6 PoPs: the TV gets its tokens", async () => {
    const kv = new EventualKV()
    const d1 = new SharedAtomicStore()
    const pops = Array.from({ length: 6 }, () =>
      makeIssuer(kv.pop(d1.adapter())),
    )
    const d = await startDevice(pops[0])
    await Promise.all(pops.map((p) => poll(p, d.device_code))) // all cache 'pending'
    const approval = await prepareApproval(pops[0], d.user_code)
    const [cb, ...polls] = await Promise.all([
      approval.send!(),
      ...Array.from({ length: 60 }, (_, i) => poll(pops[i % 6], d.device_code)),
    ])
    expect(cb.status).toBe(200)
    const before = polls.filter((p) => p.status === 200).length
    // Polls that ran before the approval said pending/slow_down; one after it wins
    const after = before
      ? []
      : [await poll(pops[3], d.device_code)].filter((p) => p.status === 200)
    expect(before + after.length).toBe(1)
  })
})

describe("handed out exactly once", () => {
  test("100 parallel polls of an approved code on 5 PoPs: exactly one gets tokens", async () => {
    const kv = new EventualKV()
    const d1 = new SharedAtomicStore()
    const pops = Array.from({ length: 5 }, () =>
      makeIssuer(kv.pop(d1.adapter())),
    )
    const d = await startDevice(pops[0])
    await (
      await prepareApproval(pops[0], d.user_code)
    ).send!()
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => poll(pops[i % 5], d.device_code)),
    )
    expect(results.filter((r) => r.status === 200).length).toBe(1)
    for (const r of results.filter((r) => r.status !== 200))
      expect(r.body.error).toBe("expired_token")
  })

  test("100 parallel polls in one process (memory store): exactly one", async () => {
    const auth = makeIssuer(MemoryStorage())
    const d = await startDevice(auth)
    await (
      await prepareApproval(auth, d.user_code)
    ).send!()
    const results = await Promise.all(
      Array.from({ length: 100 }, () => poll(auth, d.device_code)),
    )
    expect(results.filter((r) => r.status === 200).length).toBe(1)
  })

  test("approve and deny racing: one outcome wins, the other is refused", async () => {
    const auth = makeIssuer(MemoryStorage())
    const d = await startDevice(auth)
    const approval = await prepareApproval(auth, d.user_code)
    // Deny on another browser after the approval started but before it finished
    const deny = await prepareApproval(auth, d.user_code, "deny")
    const cb = await approval.send!()
    expect(deny.denyResponse!.status).toBe(200)
    expect(cb.status).toBe(400) // the record was already denied
    expect((await poll(auth, d.device_code)).body.error).toBe("access_denied")
  })
})

describe("compatibility", () => {
  test("a device record written by the previous version (plain store) keeps working", async () => {
    const kv = new EventualKV()
    const d1 = new SharedAtomicStore()
    const storage = kv.pop(d1.adapter())
    const auth = makeIssuer(storage)
    const d = await startDevice(auth)
    const hash = await hashDeviceCode(d.device_code)
    const record = await d1.adapter().take(["oauth:device", hash])
    await Storage.set(
      storage,
      ["oauth:device", hash],
      { ...record, lastPollAt: 1 },
      600,
    )
    expect((await poll(auth, d.device_code)).body.error).toBe(
      "authorization_pending",
    )
    await (
      await prepareApproval(auth, d.user_code)
    ).send!()
    await new Promise((r) => setTimeout(r, 5))
    expect((await poll(auth, d.device_code)).status).toBe(200)
    expect(await Storage.get(storage, ["oauth:device", hash])).toBeFalsy()
  })
})
