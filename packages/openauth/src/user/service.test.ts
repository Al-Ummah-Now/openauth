import { describe, test, expect, beforeEach, mock } from "bun:test"
import { UserServiceImpl } from "./service.js"
import { UserError } from "./errors.js"
import type { StorageAdapter } from "../storage/storage.js"
import type { D1UserAdapter } from "./d1-adapter.js"
import type { User, UserIdentity } from "./types.js"
import { USER_STORAGE_KEYS } from "./types.js"

// Mock implementations
function createMockStorage(): StorageAdapter {
  const store = new Map<string, any>()

  return {
    get: mock(async (key: string[]) => {
      const stringKey = key.join("::")
      return store.get(stringKey)
    }),
    set: mock(async (key: string[], value: any) => {
      const stringKey = key.join("::")
      store.set(stringKey, value)
    }),
    remove: mock(async (key: string[]) => {
      const stringKey = key.join("::")
      store.delete(stringKey)
    }),
    scan: mock(async function* (prefix: string[]) {
      const prefixStr = prefix.join("::")
      for (const [key, value] of store.entries()) {
        if (key.startsWith(prefixStr)) {
          yield [key.split("::"), value]
        }
      }
    }),
  }
}

function createMockD1Adapter(): D1UserAdapter {
  return {
    createUser: mock(async () => {}),
    getUser: mock(async () => null),
    updateUser: mock(async () => {}),
    updateUserStatus: mock(async () => {}),
    softDeleteUser: mock(async () => {}),
    updateLastLogin: mock(async () => {}),
    listUsers: mock(async () => ({
      users: [],
      next_cursor: null,
      has_more: false,
      total_count: 0,
    })),
    revokeAllUserSessions: mock(async () => ({ deletedCount: 0 })),
    createIdentity: mock(async () => {}),
    getIdentity: mock(async () => null),
    getUserIdentities: mock(async () => []),
    deleteIdentity: mock(async () => {}),
  } as any
}

describe("UserService", () => {
  let storage: StorageAdapter
  let d1Adapter: D1UserAdapter
  let service: UserServiceImpl
  const tenantId = "tenant_123"

  beforeEach(() => {
    storage = createMockStorage()
    d1Adapter = createMockD1Adapter()
    service = new UserServiceImpl({ storage, d1Adapter })
  })

  describe("createUser()", () => {
    test("creates user with proper fields", async () => {
      const params = {
        email: "test@example.com",
        name: "Test User",
        metadata: { role: "admin" },
      }

      const user = await service.createUser(tenantId, params)

      expect(user.id).toMatch(/^usr_[a-f0-9]{32}$/)
      expect(user.tenant_id).toBe(tenantId)
      expect(user.email).toBe("test@example.com")
      expect(user.name).toBe("Test User")
      expect(user.metadata).toEqual({ role: "admin" })
      expect(user.status).toBe("active")
      expect(user.created_at).toBeGreaterThan(0)
      expect(user.updated_at).toBe(user.created_at)
      expect(user.last_login_at).toBeNull()
      expect(user.deleted_at).toBeNull()

      // Verify storage calls
      expect(storage.set).toHaveBeenCalledTimes(2)
      expect(d1Adapter.createUser).toHaveBeenCalledWith(user)
    })

    test("normalizes email to lowercase", async () => {
      const user = await service.createUser(tenantId, {
        email: "Test@EXAMPLE.COM",
      })

      expect(user.email).toBe("test@example.com")
    })

    test("trims email whitespace", async () => {
      const user = await service.createUser(tenantId, {
        email: "  test@example.com  ",
      })

      expect(user.email).toBe("test@example.com")
    })

    test("sets name to null when not provided", async () => {
      const user = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      expect(user.name).toBeNull()
    })

    test("trims name when provided", async () => {
      const user = await service.createUser(tenantId, {
        email: "test@example.com",
        name: "  Test User  ",
      })

      expect(user.name).toBe("Test User")
    })

    test("sets metadata to null when not provided", async () => {
      const user = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      expect(user.metadata).toBeNull()
    })

    test("throws error when email already exists", async () => {
      await service.createUser(tenantId, {
        email: "test@example.com",
      })

      await expect(
        service.createUser(tenantId, {
          email: "test@example.com",
        })
      ).rejects.toThrow(UserError)

      try {
        await service.createUser(tenantId, {
          email: "test@example.com",
        })
      } catch (error) {
        expect(error).toBeInstanceOf(UserError)
        expect((error as UserError).code).toBe("email_already_exists")
        expect((error as UserError).message).toContain("test@example.com")
      }
    })

    test("creates email lookup index", async () => {
      const user = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      const emailKey = USER_STORAGE_KEYS.email(tenantId, "test@example.com")
      const lookup = await storage.get(emailKey)
      expect(lookup).toEqual({ userId: user.id })
    })
  })

  describe("getUser()", () => {
    test("returns user by ID", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
        name: "Test User",
      })

      const user = await service.getUser(tenantId, created.id)

      expect(user).toEqual(created)
    })

    test("returns null for non-existent user", async () => {
      const user = await service.getUser(tenantId, "usr_nonexistent")

      expect(user).toBeNull()
    })

    test("returns null for deleted user", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      await service.deleteUser(tenantId, created.id)

      const user = await service.getUser(tenantId, created.id)
      expect(user).toBeNull()
    })
  })

  describe("getUserByEmail()", () => {
    test("returns user by email", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      const user = await service.getUserByEmail(tenantId, "test@example.com")

      expect(user).toEqual(created)
    })

    test("normalizes email for lookup", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      const user = await service.getUserByEmail(tenantId, "TEST@EXAMPLE.COM")

      expect(user).toEqual(created)
    })

    test("trims email for lookup", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      const user = await service.getUserByEmail(tenantId, "  test@example.com  ")

      expect(user).toEqual(created)
    })

    test("returns null for non-existent email", async () => {
      const user = await service.getUserByEmail(tenantId, "nonexistent@example.com")

      expect(user).toBeNull()
    })

    test("returns null for deleted user's email", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      await service.deleteUser(tenantId, created.id)

      const user = await service.getUserByEmail(tenantId, "test@example.com")
      expect(user).toBeNull()
    })
  })

  describe("updateUser()", () => {
    test("updates user fields", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
        name: "Old Name",
      })

      const updated = await service.updateUser(tenantId, created.id, {
        name: "New Name",
        metadata: { role: "user" },
      })

      expect(updated.name).toBe("New Name")
      expect(updated.metadata).toEqual({ role: "user" })
      expect(updated.email).toBe("test@example.com")
      expect(updated.updated_at).toBeGreaterThanOrEqual(created.updated_at)
      expect(d1Adapter.updateUser).toHaveBeenCalledWith(updated)
    })

    test("updates email and updates lookup index", async () => {
      const created = await service.createUser(tenantId, {
        email: "old@example.com",
      })

      const updated = await service.updateUser(tenantId, created.id, {
        email: "new@example.com",
      })

      expect(updated.email).toBe("new@example.com")

      // Old email should not resolve
      const oldLookup = await service.getUserByEmail(tenantId, "old@example.com")
      expect(oldLookup).toBeNull()

      // New email should resolve
      const newLookup = await service.getUserByEmail(tenantId, "new@example.com")
      expect(newLookup?.id).toBe(created.id)
    })

    test("normalizes updated email", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      const updated = await service.updateUser(tenantId, created.id, {
        email: "  NEW@EXAMPLE.COM  ",
      })

      expect(updated.email).toBe("new@example.com")
    })

    test("allows updating email to same value", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      const updated = await service.updateUser(tenantId, created.id, {
        email: "test@example.com",
      })

      expect(updated.email).toBe("test@example.com")
    })

    test("throws error when user not found", async () => {
      await expect(
        service.updateUser(tenantId, "usr_nonexistent", {
          name: "New Name",
        })
      ).rejects.toThrow(UserError)

      try {
        await service.updateUser(tenantId, "usr_nonexistent", {
          name: "New Name",
        })
      } catch (error) {
        expect((error as UserError).code).toBe("user_not_found")
      }
    })

    test("throws error when updating deleted user", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      await service.deleteUser(tenantId, created.id)

      await expect(
        service.updateUser(tenantId, created.id, {
          name: "New Name",
        })
      ).rejects.toThrow(UserError)

      try {
        await service.updateUser(tenantId, created.id, {
          name: "New Name",
        })
      } catch (error) {
        expect((error as UserError).code).toBe("user_not_found")
      }
    })

    test("throws error when email conflicts with another user", async () => {
      const user1 = await service.createUser(tenantId, {
        email: "user1@example.com",
      })

      await service.createUser(tenantId, {
        email: "user2@example.com",
      })

      await expect(
        service.updateUser(tenantId, user1.id, {
          email: "user2@example.com",
        })
      ).rejects.toThrow(UserError)

      try {
        await service.updateUser(tenantId, user1.id, {
          email: "user2@example.com",
        })
      } catch (error) {
        expect((error as UserError).code).toBe("email_already_exists")
      }
    })

    test("preserves unchanged fields", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
        name: "Original Name",
        metadata: { role: "admin" },
      })

      const updated = await service.updateUser(tenantId, created.id, {
        name: "New Name",
      })

      expect(updated.email).toBe(created.email)
      expect(updated.metadata).toEqual(created.metadata)
    })
  })

  describe("deleteUser()", () => {
    test("soft deletes user (sets deleted_at)", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      await service.deleteUser(tenantId, created.id)

      // User should not be retrievable via getUser
      const user = await service.getUser(tenantId, created.id)
      expect(user).toBeNull()

      // But storage should still have the record with deleted_at set
      const userKey = USER_STORAGE_KEYS.user(tenantId, created.id)
      const storedUser = await storage.get(userKey) as User
      expect(storedUser.deleted_at).toBeGreaterThan(0)
      expect(storedUser.status).toBe("deleted")
      expect(d1Adapter.softDeleteUser).toHaveBeenCalledWith(
        tenantId,
        created.id,
        storedUser.deleted_at
      )
    })

    test("removes email lookup on delete", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      await service.deleteUser(tenantId, created.id)

      const user = await service.getUserByEmail(tenantId, "test@example.com")
      expect(user).toBeNull()
    })

    test("revokes all user sessions via D1 adapter", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      await service.deleteUser(tenantId, created.id)

      expect(d1Adapter.revokeAllUserSessions).toHaveBeenCalledWith(tenantId, created.id)
    })

    test("throws error when user not found", async () => {
      await expect(
        service.deleteUser(tenantId, "usr_nonexistent")
      ).rejects.toThrow(UserError)

      try {
        await service.deleteUser(tenantId, "usr_nonexistent")
      } catch (error) {
        expect((error as UserError).code).toBe("user_not_found")
      }
    })

    test("throws error when deleting already deleted user", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      await service.deleteUser(tenantId, created.id)

      await expect(
        service.deleteUser(tenantId, created.id)
      ).rejects.toThrow(UserError)
    })
  })

  describe("suspendUser()", () => {
    test("sets status to suspended", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      const result = await service.suspendUser(tenantId, created.id)

      expect(result.user.status).toBe("suspended")
      expect(result.user.updated_at).toBeGreaterThanOrEqual(created.updated_at)
      expect(d1Adapter.updateUserStatus).toHaveBeenCalledWith(
        tenantId,
        created.id,
        "suspended"
      )
    })

    test("revokes all user sessions", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      d1Adapter.revokeAllUserSessions = mock(async () => ({ deletedCount: 3 })) as any

      const result = await service.suspendUser(tenantId, created.id)

      expect(result.revoked_sessions).toBe(3)
      expect(d1Adapter.revokeAllUserSessions).toHaveBeenCalledWith(tenantId, created.id)
    })

    test("returns early if user already suspended", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      await service.suspendUser(tenantId, created.id)

      // Reset mocks
      d1Adapter.updateUserStatus = mock(async () => {}) as any
      d1Adapter.revokeAllUserSessions = mock(async () => ({ deletedCount: 0 })) as any

      const result = await service.suspendUser(tenantId, created.id)

      expect(result.user.status).toBe("suspended")
      expect(result.revoked_sessions).toBe(0)
      expect(d1Adapter.updateUserStatus).not.toHaveBeenCalled()
    })

    test("throws error when user not found", async () => {
      await expect(
        service.suspendUser(tenantId, "usr_nonexistent")
      ).rejects.toThrow(UserError)

      try {
        await service.suspendUser(tenantId, "usr_nonexistent")
      } catch (error) {
        expect((error as UserError).code).toBe("user_not_found")
      }
    })

    test("throws error when suspending deleted user", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      await service.deleteUser(tenantId, created.id)

      await expect(
        service.suspendUser(tenantId, created.id)
      ).rejects.toThrow(UserError)

      try {
        await service.suspendUser(tenantId, created.id)
      } catch (error) {
        expect((error as UserError).code).toBe("user_not_found")
      }
    })
  })

  describe("unsuspendUser()", () => {
    test("sets status to active", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      await service.suspendUser(tenantId, created.id)

      const result = await service.unsuspendUser(tenantId, created.id)

      expect(result.status).toBe("active")
      expect(d1Adapter.updateUserStatus).toHaveBeenCalledWith(
        tenantId,
        created.id,
        "active"
      )
    })

    test("throws error when user not found", async () => {
      await expect(
        service.unsuspendUser(tenantId, "usr_nonexistent")
      ).rejects.toThrow(UserError)

      try {
        await service.unsuspendUser(tenantId, "usr_nonexistent")
      } catch (error) {
        expect((error as UserError).code).toBe("user_not_found")
      }
    })

    test("throws error when user is not suspended", async () => {
      const created = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      await expect(
        service.unsuspendUser(tenantId, created.id)
      ).rejects.toThrow(UserError)

      try {
        await service.unsuspendUser(tenantId, created.id)
      } catch (error) {
        expect((error as UserError).code).toBe("user_not_found")
        expect((error as UserError).message).toContain("not suspended")
      }
    })
  })

  describe("linkIdentity() / unlinkIdentity()", () => {
    test("links identity to user", async () => {
      const user = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      const identity = await service.linkIdentity(tenantId, user.id, {
        provider: "google",
        provider_user_id: "google_123",
        provider_data: { name: "Test User" },
      })

      expect(identity.id).toMatch(/^idt_[a-f0-9]{32}$/)
      expect(identity.user_id).toBe(user.id)
      expect(identity.tenant_id).toBe(tenantId)
      expect(identity.provider).toBe("google")
      expect(identity.provider_user_id).toBe("google_123")
      expect(identity.provider_data).toEqual({ name: "Test User" })
      expect(identity.created_at).toBeGreaterThan(0)

      expect(d1Adapter.createIdentity).toHaveBeenCalledWith(identity)
    })

    test("creates identity lookup in storage", async () => {
      const user = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      const identity = await service.linkIdentity(tenantId, user.id, {
        provider: "google",
        provider_user_id: "google_123",
        provider_data: {},
      })

      const identityKey = USER_STORAGE_KEYS.identity(tenantId, "google", "google_123")
      const storedIdentity = await storage.get(identityKey)
      expect(storedIdentity).toEqual(identity)
    })

    test("throws error when user not found", async () => {
      await expect(
        service.linkIdentity(tenantId, "usr_nonexistent", {
          provider: "google",
          provider_user_id: "google_123",
          provider_data: {},
        })
      ).rejects.toThrow(UserError)

      try {
        await service.linkIdentity(tenantId, "usr_nonexistent", {
          provider: "google",
          provider_user_id: "google_123",
          provider_data: {},
        })
      } catch (error) {
        expect((error as UserError).code).toBe("user_not_found")
      }
    })

    test("throws error when identity already linked", async () => {
      const user = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      await service.linkIdentity(tenantId, user.id, {
        provider: "google",
        provider_user_id: "google_123",
        provider_data: {},
      })

      await expect(
        service.linkIdentity(tenantId, user.id, {
          provider: "google",
          provider_user_id: "google_123",
          provider_data: {},
        })
      ).rejects.toThrow(UserError)

      try {
        await service.linkIdentity(tenantId, user.id, {
          provider: "google",
          provider_user_id: "google_123",
          provider_data: {},
        })
      } catch (error) {
        expect((error as UserError).code).toBe("identity_already_linked")
      }
    })

    test("unlinks identity from user", async () => {
      const user = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      const identity = await service.linkIdentity(tenantId, user.id, {
        provider: "google",
        provider_user_id: "google_123",
        provider_data: {},
      })

      // Mock getIdentity to return the identity
      d1Adapter.getIdentity = mock(async () => identity) as any

      await service.unlinkIdentity(tenantId, user.id, identity.id)

      expect(d1Adapter.deleteIdentity).toHaveBeenCalledWith(tenantId, identity.id)

      // Verify storage key was removed
      const identityKey = USER_STORAGE_KEYS.identity(tenantId, "google", "google_123")
      const storedIdentity = await storage.get(identityKey)
      expect(storedIdentity).toBeUndefined()
    })

    test("throws error when unlinking non-existent identity", async () => {
      const user = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      d1Adapter.getIdentity = mock(async () => null) as any

      await expect(
        service.unlinkIdentity(tenantId, user.id, "idt_nonexistent")
      ).rejects.toThrow(UserError)

      try {
        await service.unlinkIdentity(tenantId, user.id, "idt_nonexistent")
      } catch (error) {
        expect((error as UserError).code).toBe("identity_not_found")
      }
    })

    test("throws error when identity belongs to different user", async () => {
      const user1 = await service.createUser(tenantId, {
        email: "user1@example.com",
      })

      const user2 = await service.createUser(tenantId, {
        email: "user2@example.com",
      })

      const identity = await service.linkIdentity(tenantId, user1.id, {
        provider: "google",
        provider_user_id: "google_123",
        provider_data: {},
      })

      d1Adapter.getIdentity = mock(async () => identity) as any

      await expect(
        service.unlinkIdentity(tenantId, user2.id, identity.id)
      ).rejects.toThrow(UserError)

      try {
        await service.unlinkIdentity(tenantId, user2.id, identity.id)
      } catch (error) {
        expect((error as UserError).code).toBe("identity_not_found")
      }
    })
  })

  describe("getUserIdentities()", () => {
    test("returns user identities from D1 adapter", async () => {
      const user = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      const mockIdentities: UserIdentity[] = [
        {
          id: "idt_1",
          user_id: user.id,
          tenant_id: tenantId,
          provider: "google",
          provider_user_id: "google_123",
          provider_data: {},
          created_at: Date.now(),
        },
        {
          id: "idt_2",
          user_id: user.id,
          tenant_id: tenantId,
          provider: "github",
          provider_user_id: "github_456",
          provider_data: {},
          created_at: Date.now(),
        },
      ]

      d1Adapter.getUserIdentities = mock(async () => mockIdentities) as any

      const identities = await service.getUserIdentities(tenantId, user.id)

      expect(identities).toEqual(mockIdentities)
      expect(d1Adapter.getUserIdentities).toHaveBeenCalledWith(tenantId, user.id)
    })

    test("returns empty array when no D1 adapter", async () => {
      const serviceWithoutD1 = new UserServiceImpl({ storage })
      const user = await serviceWithoutD1.createUser(tenantId, {
        email: "test@example.com",
      })

      const identities = await serviceWithoutD1.getUserIdentities(tenantId, user.id)

      expect(identities).toEqual([])
    })
  })

  describe("getUserWithIdentities()", () => {
    test("returns user with identities", async () => {
      const user = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      const mockIdentities: UserIdentity[] = [
        {
          id: "idt_1",
          user_id: user.id,
          tenant_id: tenantId,
          provider: "google",
          provider_user_id: "google_123",
          provider_data: {},
          created_at: Date.now(),
        },
      ]

      d1Adapter.getUserIdentities = mock(async () => mockIdentities) as any

      const result = await service.getUserWithIdentities(tenantId, user.id)

      expect(result).toEqual({
        ...user,
        identities: mockIdentities,
      })
    })

    test("returns null when user not found", async () => {
      const result = await service.getUserWithIdentities(tenantId, "usr_nonexistent")

      expect(result).toBeNull()
    })
  })

  describe("revokeUserSessions()", () => {
    test("revokes all user sessions via D1 adapter", async () => {
      const user = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      d1Adapter.revokeAllUserSessions = mock(async () => ({ deletedCount: 5 })) as any

      const result = await service.revokeUserSessions(tenantId, user.id)

      expect(result.revoked_count).toBe(5)
      expect(d1Adapter.revokeAllUserSessions).toHaveBeenCalledWith(tenantId, user.id)
    })

    test("throws error when user not found", async () => {
      await expect(
        service.revokeUserSessions(tenantId, "usr_nonexistent")
      ).rejects.toThrow(UserError)
    })
  })

  describe("updateLastLogin()", () => {
    test("updates last_login_at timestamp", async () => {
      const user = await service.createUser(tenantId, {
        email: "test@example.com",
      })

      expect(user.last_login_at).toBeNull()

      await service.updateLastLogin(tenantId, user.id)

      const updated = await service.getUser(tenantId, user.id)
      expect(updated?.last_login_at).toBeGreaterThan(0)
      expect(d1Adapter.updateLastLogin).toHaveBeenCalledWith(tenantId, user.id)
    })

    test("does nothing when user not found", async () => {
      await service.updateLastLogin(tenantId, "usr_nonexistent")
      // Should not throw
    })
  })

  describe("listUsers()", () => {
    test("delegates to D1 adapter when available", async () => {
      const mockResponse = {
        users: [],
        next_cursor: null,
        has_more: false,
        total_count: 0,
      }

      d1Adapter.listUsers = mock(async () => mockResponse) as any

      const params = { limit: 10, status: "active" as const }
      const result = await service.listUsers(tenantId, params)

      expect(result).toEqual(mockResponse)
      expect(d1Adapter.listUsers).toHaveBeenCalledWith(tenantId, params)
    })

    test("returns empty response when no D1 adapter", async () => {
      const serviceWithoutD1 = new UserServiceImpl({ storage })

      const result = await serviceWithoutD1.listUsers(tenantId)

      expect(result).toEqual({
        users: [],
        next_cursor: null,
        has_more: false,
      })
    })
  })
})
