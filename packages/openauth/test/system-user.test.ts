import { describe, expect, test, mock } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import {
  SYSTEM_USER_ID,
  SYSTEM_USER_IDS,
  isSystemMetadata,
  isSystemUser,
  isSystemUserId,
} from "../src/user/system.js"
import { RBACServiceImpl } from "../src/rbac/service.js"
import { RBACError } from "../src/contracts/types.js"
import type { RBACAdapter } from "../src/rbac/d1-adapter.js"
import type { StorageAdapter } from "../src/storage/storage.js"

describe("system accounts", () => {
  test("the seeded system user is the canonical system account", () => {
    expect(SYSTEM_USER_ID).toBe("user_system")
    expect(SYSTEM_USER_IDS).toEqual(["user_system"])
    expect(isSystemUserId("user_system")).toBe(true)
    expect(isSystemUserId("usr_123")).toBe(false)
    expect(isSystemUserId(undefined)).toBe(false)
  })

  test("metadata.type system is recognised as an object or as stored JSON", () => {
    expect(isSystemMetadata({ type: "system" })).toBe(true)
    expect(isSystemMetadata('{"type": "system", "description": "x"}')).toBe(
      true,
    )
    expect(isSystemMetadata({ type: "person" })).toBe(false)
    expect(isSystemMetadata("not json")).toBe(false)
    expect(isSystemMetadata(null)).toBe(false)
    expect(isSystemUser({ id: "usr_1", metadata: { type: "system" } })).toBe(
      true,
    )
    expect(isSystemUser({ id: "user_system", metadata: null })).toBe(true)
    expect(isSystemUser({ id: "usr_1", metadata: "{}" })).toBe(false)
    expect(isSystemUser(null)).toBe(false)
  })

  test("a role is never granted to a system account", async () => {
    const assign = mock(async () => ({}))
    const adapter = {
      getRole: mock(async () => ({ id: "role_member", is_system_role: false })),
      getUserRoles: mock(async () => []),
      assignRoleToUser: assign,
    } as unknown as RBACAdapter
    const service = new RBACServiceImpl(adapter, {} as StorageAdapter)
    const attempt = service.assignRoleToUser({
      userId: "user_system",
      roleId: "role_member",
      tenantId: "default",
      assignedBy: "usr_admin",
    })
    await expect(attempt).rejects.toBeInstanceOf(RBACError)
    await expect(attempt).rejects.toMatchObject({
      code: "system_account_role_denied",
    })
    expect(assign).not.toHaveBeenCalled()
  })

  test("the seed creates the system user without any role", () => {
    const seed = readFileSync(
      join(import.meta.dir, "../src/migrations/002_seed.sql"),
      "utf-8",
    )
    const code = seed
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
    const statements = code.split(";")
    const roleGrants = statements.filter((s) =>
      /INSERT\s+(OR\s+IGNORE\s+)?INTO\s+rbac_user_roles/i.test(s),
    )
    for (const grant of roleGrants) expect(grant).not.toContain("user_system")
    const user = statements.find(
      (s) => /INTO\s+users/i.test(s) && s.includes("'user_system'"),
    )
    expect(user).toBeDefined()
    expect(user).toContain('"type": "system"')
  })
})
