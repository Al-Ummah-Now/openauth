/**
 * Signing-key rotation (AlUmmahNowAuth#13):
 * 1. a new key is added pending: published in JWKS, not signing yet;
 * 2. from its activation time it signs; the previous key's tokens still verify;
 * 3. the previous key is retired: gone from JWKS, its tokens refused, its
 *    private key dropped. The key in use can never be retired.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test"
import { decodeProtectedHeader } from "jose"
import { object, string } from "valibot"
import { issuer } from "../src/issuer.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { Storage, type StorageAdapter } from "../src/storage/storage.js"
import type { Provider } from "../src/provider/provider.js"
import {
  addPendingSigningKey,
  clearKeyCache,
  listSigningKeys,
  retireSigningKey,
} from "../src/keys.js"

const subjects = createSubjects({ user: object({ userID: string() }) })
const T0 = new Date("2026-01-01T00:00:00Z").getTime()
const HOUR = 60 * 60 * 1000

let storage: StorageAdapter
let auth: ReturnType<typeof issuer>

function build() {
  return issuer({
    storage,
    subjects,
    allow: async () => true,
    ttl: { access: 3 * 60 * 60, refresh: 6 * 60 * 60 },
    providers: {
      dummy: {
        type: "dummy",
        init() {},
        client: async () => ({ email: "foo@bar.com" }),
      } satisfies Provider<{ email: string }>,
    },
    success: async (ctx) => ctx.subject("user", { userID: "123" }),
  })
}

async function token(): Promise<string> {
  const res = await auth.request("https://auth.example.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      provider: "dummy",
      client_id: "myuser",
      client_secret: "mypass",
    }).toString(),
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as { access_token: string }).access_token
}

const kidOf = (jwt: string) => decodeProtectedHeader(jwt).kid
const jwksKids = async () =>
  (
    (await (
      await auth.request("https://auth.example.com/.well-known/jwks.json")
    ).json()) as { keys: { kid: string }[] }
  ).keys.map((k) => k.kid)
const userinfo = (jwt: string) =>
  auth.request("https://auth.example.com/userinfo", {
    headers: { Authorization: `Bearer ${jwt}` },
  })

beforeEach(() => {
  setSystemTime(new Date(T0))
  clearKeyCache()
  storage = MemoryStorage()
  auth = build()
})

afterEach(() => {
  setSystemTime()
  clearKeyCache()
})

describe("signing-key rotation", () => {
  test("pending key is published first, signs from its activation, old key retires", async () => {
    const before = await token()
    const oldKid = kidOf(before)
    expect(await jwksKids()).toEqual([oldKid])

    const pending = await addPendingSigningKey(storage, T0 + HOUR)
    expect(pending).not.toBeNull()
    // Published at once, but the old key still signs
    expect(await jwksKids()).toEqual(
      expect.arrayContaining([oldKid, pending!.id]),
    )
    expect(kidOf(await token())).toBe(oldKid)
    // One rotation at a time
    expect(await addPendingSigningKey(storage, T0 + 2 * HOUR)).toBeNull()
    // The key in use cannot be retired, nor can a key while it is the only live one
    expect(await retireSigningKey(storage, oldKid!)).toBe(false)

    setSystemTime(new Date(T0 + HOUR + 1))
    const after = await token()
    expect(kidOf(after)).toBe(pending!.id)
    // Overlap: both keys' tokens verify
    expect((await userinfo(after)).status).toBe(200)
    expect((await userinfo(before)).status).toBe(200)
    // Now the new key signs, so the new key cannot be retired but the old one can
    expect(await retireSigningKey(storage, pending!.id)).toBe(false)
    expect(await retireSigningKey(storage, oldKid!)).toBe(true)
    expect(await retireSigningKey(storage, oldKid!)).toBe(false)

    expect(await jwksKids()).toEqual([pending!.id])
    // Refused like any token that fails verification
    expect((await userinfo(before)).status).toBe(400)
    expect((await userinfo(after)).status).toBe(200)
    const listed = await listSigningKeys(storage)
    expect(listed.find((k) => k.id === oldKid)?.expired).toBe(T0 + HOUR + 1)
    expect(listed.find((k) => k.id === pending!.id)?.activates).toBe(T0 + HOUR)
    // Key material of the retired key is gone everywhere
    const index = (await Storage.atomic(storage).get(["keys:signing"])) as {
      keys: { id: string; privateKey: string }[]
    }
    expect(index.keys.find((k) => k.id === oldKid)?.privateKey).toBe("")
    expect(await Storage.get(storage, ["signing:key", oldKid!])).toBeUndefined()
    // The issuer keeps working after a reload (retired key skipped quietly)
    clearKeyCache()
    expect(kidOf(await token())).toBe(pending!.id)
  })

  test("listSigningKeys carries no key material", async () => {
    await token()
    const listed = await listSigningKeys(storage)
    expect(listed).toHaveLength(1)
    expect(Object.keys(listed[0]).sort()).toEqual(["alg", "created", "id"])
  })

  test("an unknown kid is refused", async () => {
    await token()
    expect(await retireSigningKey(storage, "nope")).toBe(false)
  })
})
