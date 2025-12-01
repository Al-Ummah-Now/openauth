import {
  expect,
  test,
  describe,
  beforeEach,
  afterEach,
  setSystemTime,
} from "bun:test"
import { MemoryStorage } from "../src/storage/memory.js"
import { TenantServiceImpl } from "../src/tenant/service.js"
import { TenantStorageImpl } from "../src/tenant/storage.js"
import { TenantError } from "../src/contracts/types.js"
import type {
  Tenant,
  TenantBranding,
  TenantSettings,
} from "../src/contracts/types.js"

describe("TenantServiceImpl", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let service: TenantServiceImpl

  beforeEach(() => {
    storage = MemoryStorage()
    service = new TenantServiceImpl(storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))
  })

  afterEach(() => {
    setSystemTime()
  })

  describe("createTenant", () => {
    test("creates tenant with all fields", async () => {
      const branding: TenantBranding = {
        theme: { primary: "#007bff" },
        logoLight: "https://example.com/logo-light.png",
      }
      const settings: TenantSettings = {
        allowPublicRegistration: true,
        sessionLifetime: 3600,
      }

      const tenant = await service.createTenant({
        id: "tenant-123",
        name: "Acme Corp",
        domain: "auth.acme.com",
        branding,
        settings,
      })

      expect(tenant.id).toBe("tenant-123")
      expect(tenant.name).toBe("Acme Corp")
      expect(tenant.domain).toBe("auth.acme.com")
      expect(tenant.status).toBe("active")
      expect(tenant.branding).toEqual(branding)
      expect(tenant.settings).toEqual(settings)
      expect(tenant.created_at).toBe(Date.parse("2024-01-01T00:00:00Z"))
      expect(tenant.updated_at).toBe(Date.parse("2024-01-01T00:00:00Z"))
    })

    test("creates tenant without optional fields", async () => {
      const tenant = await service.createTenant({
        id: "tenant-minimal",
        name: "Minimal Corp",
      })

      expect(tenant.id).toBe("tenant-minimal")
      expect(tenant.name).toBe("Minimal Corp")
      expect(tenant.domain).toBeUndefined()
      expect(tenant.status).toBe("active")
      expect(tenant.branding).toEqual({})
      expect(tenant.settings).toEqual({})
    })

    test("normalizes domain to lowercase", async () => {
      const tenant = await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
        domain: "AUTH.EXAMPLE.COM",
      })

      expect(tenant.domain).toBe("auth.example.com")
    })

    test("trims whitespace from name", async () => {
      const tenant = await service.createTenant({
        id: "tenant-123",
        name: "  Test Corp  ",
      })

      expect(tenant.name).toBe("Test Corp")
    })

    test("validates unique domain", async () => {
      await service.createTenant({
        id: "tenant-1",
        name: "First Corp",
        domain: "auth.example.com",
      })

      await expect(
        service.createTenant({
          id: "tenant-2",
          name: "Second Corp",
          domain: "auth.example.com",
        }),
      ).rejects.toThrow(TenantError)
    })

    test("throws error for empty tenant ID", async () => {
      await expect(
        service.createTenant({
          id: "",
          name: "Test Corp",
        }),
      ).rejects.toThrow(TenantError)
    })

    test("throws error for empty name", async () => {
      await expect(
        service.createTenant({
          id: "tenant-123",
          name: "",
        }),
      ).rejects.toThrow(TenantError)
    })

    test("throws error for duplicate tenant ID", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "First Corp",
      })

      await expect(
        service.createTenant({
          id: "tenant-123",
          name: "Second Corp",
        }),
      ).rejects.toThrow(TenantError)
    })

    test("creates domain lookup entry", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
        domain: "auth.example.com",
      })

      const domainLookup = await storage.get([
        "tenant",
        "domain",
        "auth.example.com",
      ])
      expect(domainLookup).toEqual({ tenantId: "tenant-123" })
    })
  })

  describe("getTenant", () => {
    test("returns tenant by ID", async () => {
      const created = await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
        domain: "auth.example.com",
      })

      const tenant = await service.getTenant("tenant-123")
      expect(tenant).toEqual(created)
    })

    test("returns null for non-existent tenant", async () => {
      const tenant = await service.getTenant("non-existent")
      expect(tenant).toBeNull()
    })

    test("returns null for empty tenant ID", async () => {
      const tenant = await service.getTenant("")
      expect(tenant).toBeNull()
    })

    test("retrieves tenant with all fields", async () => {
      const branding: TenantBranding = {
        theme: { primary: "#007bff", secondary: "#6c757d" },
        logoLight: "https://example.com/logo-light.png",
        logoDark: "https://example.com/logo-dark.png",
      }
      const settings: TenantSettings = {
        allowPublicRegistration: true,
        requireEmailVerification: true,
        mfaRequired: false,
        maxAccountsPerSession: 5,
      }

      await service.createTenant({
        id: "tenant-full",
        name: "Full Corp",
        domain: "auth.full.com",
        branding,
        settings,
      })

      const tenant = await service.getTenant("tenant-full")
      expect(tenant?.branding).toEqual(branding)
      expect(tenant?.settings).toEqual(settings)
    })
  })

  describe("getTenantByDomain", () => {
    test("returns tenant by domain", async () => {
      const created = await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
        domain: "auth.example.com",
      })

      const tenant = await service.getTenantByDomain("auth.example.com")
      expect(tenant).toEqual(created)
    })

    test("normalizes domain for lookup", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
        domain: "auth.example.com",
      })

      const tenant = await service.getTenantByDomain("AUTH.EXAMPLE.COM")
      expect(tenant?.id).toBe("tenant-123")
    })

    test("returns null for non-existent domain", async () => {
      const tenant = await service.getTenantByDomain("non-existent.com")
      expect(tenant).toBeNull()
    })

    test("returns null for empty domain", async () => {
      const tenant = await service.getTenantByDomain("")
      expect(tenant).toBeNull()
    })

    test("returns null when tenant has no domain", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
      })

      const tenant = await service.getTenantByDomain("auth.example.com")
      expect(tenant).toBeNull()
    })
  })

  describe("updateTenant", () => {
    test("updates tenant name", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "Old Name",
      })

      setSystemTime(new Date("2024-01-02T00:00:00Z"))

      const updated = await service.updateTenant("tenant-123", {
        name: "New Name",
      })

      expect(updated.name).toBe("New Name")
      expect(updated.updated_at).toBe(Date.parse("2024-01-02T00:00:00Z"))
    })

    test("updates tenant domain", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
        domain: "old.example.com",
      })

      const updated = await service.updateTenant("tenant-123", {
        domain: "new.example.com",
      })

      expect(updated.domain).toBe("new.example.com")
    })

    test("updates branding", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
        branding: { theme: { primary: "#000000" } },
      })

      const newBranding: TenantBranding = {
        theme: { primary: "#007bff" },
        logoLight: "https://example.com/logo.png",
      }

      const updated = await service.updateTenant("tenant-123", {
        branding: newBranding,
      })

      expect(updated.branding).toEqual(newBranding)
    })

    test("merges branding updates", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
        branding: {
          theme: { primary: "#000000" },
          logoLight: "https://example.com/old-logo.png",
        },
      })

      const updated = await service.updateTenant("tenant-123", {
        branding: { theme: { secondary: "#6c757d" } },
      })

      expect(updated.branding.theme?.secondary).toBe("#6c757d")
    })

    test("updates settings", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
        settings: { allowPublicRegistration: false },
      })

      const newSettings: TenantSettings = {
        allowPublicRegistration: true,
        requireEmailVerification: true,
      }

      const updated = await service.updateTenant("tenant-123", {
        settings: newSettings,
      })

      expect(updated.settings).toEqual(newSettings)
    })

    test("updates status", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
      })

      const updated = await service.updateTenant("tenant-123", {
        status: "suspended",
      })

      expect(updated.status).toBe("suspended")
    })

    test("handles domain changes with old and new lookups", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
        domain: "old.example.com",
      })

      await service.updateTenant("tenant-123", {
        domain: "new.example.com",
      })

      // Old domain lookup should be removed
      const oldLookup = await storage.get([
        "tenant",
        "domain",
        "old.example.com",
      ])
      expect(oldLookup).toBeUndefined()

      // New domain lookup should exist
      const newLookup = await storage.get([
        "tenant",
        "domain",
        "new.example.com",
      ])
      expect(newLookup).toEqual({ tenantId: "tenant-123" })
    })

    test("preserves domain when not specified in update", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
        domain: "auth.example.com",
      })

      const updated = await service.updateTenant("tenant-123", {
        name: "Updated Name",
      })

      // Domain should be preserved when not specified in update
      expect(updated.domain).toBe("auth.example.com")

      // Domain lookup should still exist
      const lookup = await storage.get(["tenant", "domain", "auth.example.com"])
      expect(lookup).toEqual({ tenantId: "tenant-123" })
    })

    test("validates unique domain on update", async () => {
      await service.createTenant({
        id: "tenant-1",
        name: "First Corp",
        domain: "first.example.com",
      })

      await service.createTenant({
        id: "tenant-2",
        name: "Second Corp",
        domain: "second.example.com",
      })

      await expect(
        service.updateTenant("tenant-2", {
          domain: "first.example.com",
        }),
      ).rejects.toThrow(TenantError)
    })

    test("allows updating to same domain", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
        domain: "auth.example.com",
      })

      const updated = await service.updateTenant("tenant-123", {
        domain: "auth.example.com",
      })

      expect(updated.domain).toBe("auth.example.com")
    })

    test("throws error for non-existent tenant", async () => {
      await expect(
        service.updateTenant("non-existent", {
          name: "New Name",
        }),
      ).rejects.toThrow(TenantError)
    })

    test("trims whitespace from updated name", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
      })

      const updated = await service.updateTenant("tenant-123", {
        name: "  New Name  ",
      })

      expect(updated.name).toBe("New Name")
    })

    test("normalizes updated domain", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
      })

      const updated = await service.updateTenant("tenant-123", {
        domain: "NEW.EXAMPLE.COM",
      })

      expect(updated.domain).toBe("new.example.com")
    })
  })

  describe("deleteTenant", () => {
    test("soft deletes tenant (sets status to deleted)", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
        domain: "auth.example.com",
      })

      setSystemTime(new Date("2024-01-02T00:00:00Z"))

      await service.deleteTenant("tenant-123")

      const tenant = await service.getTenant("tenant-123")
      expect(tenant?.status).toBe("deleted")
      expect(tenant?.updated_at).toBe(Date.parse("2024-01-02T00:00:00Z"))
    })

    test("removes domain lookup", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
        domain: "auth.example.com",
      })

      await service.deleteTenant("tenant-123")

      const lookup = await storage.get(["tenant", "domain", "auth.example.com"])
      expect(lookup).toBeUndefined()
    })

    test("preserves tenant data", async () => {
      const created = await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
        domain: "auth.example.com",
        branding: { theme: { primary: "#007bff" } },
        settings: { allowPublicRegistration: true },
      })

      await service.deleteTenant("tenant-123")

      const tenant = await service.getTenant("tenant-123")
      expect(tenant?.id).toBe(created.id)
      expect(tenant?.name).toBe(created.name)
      expect(tenant?.branding).toEqual(created.branding)
      expect(tenant?.settings).toEqual(created.settings)
    })

    test("throws error for non-existent tenant", async () => {
      await expect(service.deleteTenant("non-existent")).rejects.toThrow(
        TenantError,
      )
    })

    test("allows deleting tenant without domain", async () => {
      await service.createTenant({
        id: "tenant-123",
        name: "Test Corp",
      })

      await expect(service.deleteTenant("tenant-123")).resolves.toBeUndefined()
    })
  })

  describe("listTenants", () => {
    beforeEach(async () => {
      // Create multiple tenants for listing tests
      await service.createTenant({
        id: "tenant-1",
        name: "First Corp",
        domain: "first.example.com",
      })

      setSystemTime(new Date("2024-01-01T01:00:00Z"))
      await service.createTenant({
        id: "tenant-2",
        name: "Second Corp",
        domain: "second.example.com",
      })

      setSystemTime(new Date("2024-01-01T02:00:00Z"))
      await service.createTenant({
        id: "tenant-3",
        name: "Third Corp",
      })

      setSystemTime(new Date("2024-01-01T03:00:00Z"))
      await service.createTenant({
        id: "tenant-suspended",
        name: "Suspended Corp",
      })
      await service.updateTenant("tenant-suspended", { status: "suspended" })

      setSystemTime(new Date("2024-01-01T04:00:00Z"))
      await service.createTenant({
        id: "tenant-deleted",
        name: "Deleted Corp",
      })
      await service.deleteTenant("tenant-deleted")

      setSystemTime(new Date("2024-01-01T00:00:00Z"))
    })

    test("lists all tenants", async () => {
      const tenants = await service.listTenants()
      expect(tenants.length).toBeGreaterThanOrEqual(5)
    })

    test("filters by active status", async () => {
      const tenants = await service.listTenants({ status: "active" })
      expect(tenants.every((t) => t.status === "active")).toBe(true)
      expect(tenants.length).toBe(3)
    })

    test("filters by suspended status", async () => {
      const tenants = await service.listTenants({ status: "suspended" })
      expect(tenants.every((t) => t.status === "suspended")).toBe(true)
      expect(tenants.length).toBe(1)
      expect(tenants[0].id).toBe("tenant-suspended")
    })

    test("filters by deleted status", async () => {
      const tenants = await service.listTenants({ status: "deleted" })
      expect(tenants.every((t) => t.status === "deleted")).toBe(true)
      expect(tenants.length).toBe(1)
      expect(tenants[0].id).toBe("tenant-deleted")
    })

    test("respects limit parameter", async () => {
      const tenants = await service.listTenants({ limit: 2 })
      expect(tenants.length).toBe(2)
    })

    test("respects offset parameter", async () => {
      const allTenants = await service.listTenants({ status: "active" })
      const offsetTenants = await service.listTenants({
        status: "active",
        offset: 1,
      })

      expect(offsetTenants.length).toBe(allTenants.length - 1)
      expect(offsetTenants[0].id).toBe(allTenants[1].id)
    })

    test("combines status filter with pagination", async () => {
      const tenants = await service.listTenants({
        status: "active",
        limit: 2,
        offset: 1,
      })

      expect(tenants.length).toBe(2)
      expect(tenants.every((t) => t.status === "active")).toBe(true)
    })

    test("returns empty array when no tenants match filter", async () => {
      const tenants = await service.listTenants({ status: "pending" })
      expect(tenants).toEqual([])
    })

    test("uses default limit when not specified", async () => {
      // Default limit should be 100
      const tenants = await service.listTenants()
      expect(tenants.length).toBeLessThanOrEqual(100)
    })

    test("uses default offset when not specified", async () => {
      const withoutOffset = await service.listTenants({ limit: 5 })
      const withZeroOffset = await service.listTenants({ limit: 5, offset: 0 })

      expect(withoutOffset).toEqual(withZeroOffset)
    })

    test("excludes domain lookup keys from results", async () => {
      const tenants = await service.listTenants()

      // Verify all returned items are valid tenant objects
      tenants.forEach((tenant) => {
        expect(tenant.id).toBeDefined()
        expect(tenant.name).toBeDefined()
        expect(tenant.status).toBeDefined()
        expect(tenant.created_at).toBeDefined()
        expect(tenant.updated_at).toBeDefined()
      })
    })
  })
})

describe("TenantStorageImpl", () => {
  let baseStorage: ReturnType<typeof MemoryStorage>
  let tenantStorage: TenantStorageImpl

  beforeEach(() => {
    baseStorage = MemoryStorage()
    tenantStorage = new TenantStorageImpl(baseStorage, "tenant-123")
  })

  describe("constructor", () => {
    test("stores tenant ID", () => {
      expect(tenantStorage.tenantId).toBe("tenant-123")
    })

    test("throws error for empty tenant ID", () => {
      expect(() => new TenantStorageImpl(baseStorage, "")).toThrow()
    })

    test("throws error for whitespace-only tenant ID", () => {
      expect(() => new TenantStorageImpl(baseStorage, "   ")).toThrow()
    })
  })

  describe("key prefixing", () => {
    test("prefixes keys with tenant ID", async () => {
      await tenantStorage.set(["oauth", "refresh", "token123"], {
        token: "refresh-token",
      })

      // Verify the key is prefixed in base storage
      const value = await baseStorage.get([
        "t",
        "tenant-123",
        "oauth",
        "refresh",
        "token123",
      ])
      expect(value).toEqual({ token: "refresh-token" })
    })

    test("uses correct prefix format", async () => {
      await tenantStorage.set(["user", "profile"], { name: "John" })

      const value = await baseStorage.get([
        "t",
        "tenant-123",
        "user",
        "profile",
      ])
      expect(value).toEqual({ name: "John" })
    })
  })

  describe("get", () => {
    test("retrieves data with correct prefix", async () => {
      await baseStorage.set(["t", "tenant-123", "user", "123"], {
        name: "John",
      })

      const value = await tenantStorage.get(["user", "123"])
      expect(value).toEqual({ name: "John" })
    })

    test("returns undefined for non-existent key", async () => {
      const value = await tenantStorage.get(["non", "existent"])
      expect(value).toBeUndefined()
    })

    test("isolates data between tenants", async () => {
      const tenant1Storage = new TenantStorageImpl(baseStorage, "tenant-1")
      const tenant2Storage = new TenantStorageImpl(baseStorage, "tenant-2")

      await tenant1Storage.set(["user", "123"], { name: "Tenant 1 User" })
      await tenant2Storage.set(["user", "123"], { name: "Tenant 2 User" })

      const value1 = await tenant1Storage.get(["user", "123"])
      const value2 = await tenant2Storage.get(["user", "123"])

      expect(value1).toEqual({ name: "Tenant 1 User" })
      expect(value2).toEqual({ name: "Tenant 2 User" })
    })

    test("retrieves nested objects", async () => {
      const complexData = {
        id: 1,
        nested: { a: 1, b: { c: 2 } },
        array: [1, 2, 3],
      }

      await tenantStorage.set(["complex"], complexData)
      const value = await tenantStorage.get(["complex"])
      expect(value).toEqual(complexData)
    })
  })

  describe("set", () => {
    test("stores data with correct prefix", async () => {
      await tenantStorage.set(["user", "123"], { name: "John" })

      const value = await baseStorage.get(["t", "tenant-123", "user", "123"])
      expect(value).toEqual({ name: "John" })
    })

    test("supports TTL in seconds", async () => {
      setSystemTime(new Date("2024-01-01T00:00:00Z"))

      await tenantStorage.set(["temp", "key"], { value: "data" }, 100)

      let value = await tenantStorage.get(["temp", "key"])
      expect(value?.value).toBe("data")

      setSystemTime(new Date("2024-01-01T00:02:00Z")) // 2 minutes later
      value = await tenantStorage.get(["temp", "key"])
      expect(value).toBeUndefined()

      setSystemTime()
    })

    test("overwrites existing data", async () => {
      await tenantStorage.set(["key"], { value: "old" })
      await tenantStorage.set(["key"], { value: "new" })

      const value = await tenantStorage.get(["key"])
      expect(value).toEqual({ value: "new" })
    })

    test("stores complex objects", async () => {
      const complexData = {
        users: [
          { id: 1, name: "John" },
          { id: 2, name: "Jane" },
        ],
        metadata: { version: 1, timestamp: Date.now() },
      }

      await tenantStorage.set(["data"], complexData)
      const value = await tenantStorage.get(["data"])
      expect(value).toEqual(complexData)
    })
  })

  describe("remove", () => {
    test("removes data with correct prefix", async () => {
      await tenantStorage.set(["user", "123"], { name: "John" })

      await tenantStorage.remove(["user", "123"])

      const value = await tenantStorage.get(["user", "123"])
      expect(value).toBeUndefined()
    })

    test("does not affect other tenants' data", async () => {
      const tenant1Storage = new TenantStorageImpl(baseStorage, "tenant-1")
      const tenant2Storage = new TenantStorageImpl(baseStorage, "tenant-2")

      await tenant1Storage.set(["user", "123"], { name: "Tenant 1 User" })
      await tenant2Storage.set(["user", "123"], { name: "Tenant 2 User" })

      await tenant1Storage.remove(["user", "123"])

      const value1 = await tenant1Storage.get(["user", "123"])
      const value2 = await tenant2Storage.get(["user", "123"])

      expect(value1).toBeUndefined()
      expect(value2).toEqual({ name: "Tenant 2 User" })
    })

    test("handles removing non-existent key", async () => {
      await expect(
        tenantStorage.remove(["non", "existent"]),
      ).resolves.toBeUndefined()
    })
  })

  describe("scan", () => {
    test("scans with correct prefix", async () => {
      await tenantStorage.set(["user", "1"], { id: 1 })
      await tenantStorage.set(["user", "2"], { id: 2 })
      await tenantStorage.set(["other", "1"], { id: 3 })

      const results = await Array.fromAsync(tenantStorage.scan(["user"]))
      expect(results).toHaveLength(2)
      expect(results).toContainEqual([["user", "1"], { id: 1 }])
      expect(results).toContainEqual([["user", "2"], { id: 2 }])
    })

    test("strips tenant prefix from returned keys", async () => {
      await tenantStorage.set(["user", "profile", "123"], { name: "John" })

      const results = await Array.fromAsync(tenantStorage.scan(["user"]))

      results.forEach(([key]) => {
        expect(key[0]).not.toBe("t")
        expect(key[1]).not.toBe("tenant-123")
        expect(key[0]).toBe("user")
      })
    })

    test("isolates scan between tenants", async () => {
      const tenant1Storage = new TenantStorageImpl(baseStorage, "tenant-1")
      const tenant2Storage = new TenantStorageImpl(baseStorage, "tenant-2")

      await tenant1Storage.set(["user", "1"], { tenant: 1 })
      await tenant2Storage.set(["user", "1"], { tenant: 2 })
      await tenant2Storage.set(["user", "2"], { tenant: 2 })

      const results1 = await Array.fromAsync(tenant1Storage.scan(["user"]))
      const results2 = await Array.fromAsync(tenant2Storage.scan(["user"]))

      expect(results1).toHaveLength(1)
      expect(results2).toHaveLength(2)
    })

    test("returns empty iterable for no matches", async () => {
      const results = await Array.fromAsync(
        tenantStorage.scan(["non", "existent"]),
      )
      expect(results).toEqual([])
    })

    test("handles nested prefixes", async () => {
      await tenantStorage.set(["oauth", "access", "token1"], { type: "access" })
      await tenantStorage.set(["oauth", "refresh", "token1"], {
        type: "refresh",
      })
      await tenantStorage.set(["oauth", "access", "token2"], { type: "access" })

      const results = await Array.fromAsync(
        tenantStorage.scan(["oauth", "access"]),
      )
      expect(results).toHaveLength(2)
      expect(results.every(([, value]) => value.type === "access")).toBe(true)
    })
  })
})

describe("Tenant Resolver", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let service: TenantServiceImpl

  beforeEach(async () => {
    storage = MemoryStorage()
    service = new TenantServiceImpl(storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))

    // Create test tenants
    await service.createTenant({
      id: "acme-corp",
      name: "Acme Corp",
      domain: "auth.acme.com",
    })

    await service.createTenant({
      id: "beta-company",
      name: "Beta Company",
    })

    await service.createTenant({
      id: "suspended-tenant",
      name: "Suspended Tenant",
    })
    await service.updateTenant("suspended-tenant", { status: "suspended" })

    await service.createTenant({
      id: "deleted-tenant",
      name: "Deleted Tenant",
    })
    await service.deleteTenant("deleted-tenant")
  })

  afterEach(() => {
    setSystemTime()
  })

  describe("resolution by custom domain", () => {
    test("resolves tenant by custom domain", async () => {
      const tenant = await service.getTenantByDomain("auth.acme.com")
      expect(tenant?.id).toBe("acme-corp")
      expect(tenant?.status).toBe("active")
    })

    test("normalizes domain for lookup", async () => {
      const tenant = await service.getTenantByDomain("AUTH.ACME.COM")
      expect(tenant?.id).toBe("acme-corp")
    })

    test("returns null for non-existent domain", async () => {
      const tenant = await service.getTenantByDomain("non-existent.com")
      expect(tenant).toBeNull()
    })
  })

  describe("tenant status validation", () => {
    test("allows active tenants", async () => {
      const tenant = await service.getTenant("acme-corp")
      expect(tenant?.status).toBe("active")
    })

    test("retrieves suspended tenant", async () => {
      const tenant = await service.getTenant("suspended-tenant")
      expect(tenant?.status).toBe("suspended")
    })

    test("retrieves deleted tenant", async () => {
      const tenant = await service.getTenant("deleted-tenant")
      expect(tenant?.status).toBe("deleted")
    })

    test("deleted tenant has no domain lookup", async () => {
      const tenant = await service.getTenantByDomain("deleted.example.com")
      expect(tenant).toBeNull()
    })
  })

  describe("tenant data isolation", () => {
    test("different tenants have isolated storage", async () => {
      const storage1 = new TenantStorageImpl(storage, "acme-corp")
      const storage2 = new TenantStorageImpl(storage, "beta-company")

      await storage1.set(["config"], { setting: "acme-value" })
      await storage2.set(["config"], { setting: "beta-value" })

      const config1 = await storage1.get(["config"])
      const config2 = await storage2.get(["config"])

      expect(config1).toEqual({ setting: "acme-value" })
      expect(config2).toEqual({ setting: "beta-value" })
    })

    test("tenant cannot access another tenant's data", async () => {
      const storage1 = new TenantStorageImpl(storage, "acme-corp")
      const storage2 = new TenantStorageImpl(storage, "beta-company")

      await storage1.set(["secret"], { key: "acme-secret" })

      const value = await storage2.get(["secret"])
      expect(value).toBeUndefined()
    })

    test("scan only returns tenant's own data", async () => {
      const storage1 = new TenantStorageImpl(storage, "acme-corp")
      const storage2 = new TenantStorageImpl(storage, "beta-company")

      await storage1.set(["user", "1"], { tenant: "acme" })
      await storage1.set(["user", "2"], { tenant: "acme" })
      await storage2.set(["user", "1"], { tenant: "beta" })

      const results1 = await Array.fromAsync(storage1.scan(["user"]))
      const results2 = await Array.fromAsync(storage2.scan(["user"]))

      expect(results1).toHaveLength(2)
      expect(results2).toHaveLength(1)
      expect(results1.every(([, v]) => v.tenant === "acme")).toBe(true)
      expect(results2.every(([, v]) => v.tenant === "beta")).toBe(true)
    })
  })

  describe("edge cases", () => {
    test("handles tenant with special characters in ID", async () => {
      await service.createTenant({
        id: "tenant-with-dashes-123",
        name: "Special Tenant",
      })

      const tenant = await service.getTenant("tenant-with-dashes-123")
      expect(tenant?.id).toBe("tenant-with-dashes-123")

      const tenantStorage = new TenantStorageImpl(
        storage,
        "tenant-with-dashes-123",
      )
      await tenantStorage.set(["test"], { value: "data" })

      const value = await tenantStorage.get(["test"])
      expect(value).toEqual({ value: "data" })
    })

    test("handles long tenant IDs", async () => {
      const longId = "a".repeat(100)
      await service.createTenant({
        id: longId,
        name: "Long ID Tenant",
      })

      const tenant = await service.getTenant(longId)
      expect(tenant?.id).toBe(longId)
    })

    test("handles empty branding and settings gracefully", async () => {
      await service.createTenant({
        id: "minimal",
        name: "Minimal",
        branding: {},
        settings: {},
      })

      const tenant = await service.getTenant("minimal")
      expect(tenant?.branding).toEqual({})
      expect(tenant?.settings).toEqual({})
    })

    test("updates preserve unmodified fields", async () => {
      const original = await service.createTenant({
        id: "preserve-test",
        name: "Original Name",
        domain: "original.com",
        branding: { theme: { primary: "#000000" } },
        settings: { allowPublicRegistration: true },
      })

      const updated = await service.updateTenant("preserve-test", {
        name: "Updated Name",
      })

      expect(updated.name).toBe("Updated Name")
      expect(updated.domain).toBe(original.domain)
      expect(updated.branding).toEqual(original.branding)
      expect(updated.settings).toEqual(original.settings)
      expect(updated.created_at).toBe(original.created_at)
    })
  })
})
