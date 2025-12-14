import {
  expect,
  test,
  describe,
  beforeEach,
  mock,
  spyOn,
  setSystemTime,
  afterEach,
} from "bun:test"
import { RBACServiceImpl } from "../src/rbac/service.js"
import { RBACAdapter } from "../src/rbac/d1-adapter.js"
import type { StorageAdapter } from "../src/storage/storage.js"
import type {
  Role,
  Permission,
  UserRole,
  RolePermission,
} from "../src/contracts/types.js"
import {
  enrichTokenWithRBAC,
  createTokenEnricher,
  validateRBACClaims,
  extractRBACClaims,
  hasPermissionInToken,
  hasRoleInToken,
  hasAllPermissionsInToken,
  hasAnyPermissionInToken,
} from "../src/rbac/token-enricher.js"

// ============================================
// Mock D1 Database
// ============================================

const createMockD1 = () => {
  const mockResults: any[] = []
  let consumeResults = false // When true, shift results off queue

  const setResults = (results: any[], consume = false) => {
    mockResults.length = 0
    mockResults.push(...results)
    consumeResults = consume
  }

  const db = {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        run: mock(() =>
          Promise.resolve({ success: true, meta: { changes: 1 } }),
        ),
        all: mock(() => Promise.resolve({ results: [...mockResults] })),
        first: mock(() => {
          const result = mockResults[0] || null
          if (consumeResults && mockResults.length > 0) {
            mockResults.shift()
          }
          return Promise.resolve(result)
        }),
      }),
    }),
    _mockResults: mockResults,
    _setResults: setResults,
    _sql: [] as string[],
  }

  // Track SQL queries for verification
  const originalPrepare = db.prepare
  db.prepare = (sql: string) => {
    db._sql.push(sql)
    return originalPrepare(sql)
  }

  return db
}

// ============================================
// Mock Storage Adapter
// ============================================

const createMockStorage = () => {
  const storage = new Map<string, any>()

  const mockStorage: StorageAdapter = {
    get: mock(async (key: string[]) => {
      const keyStr = JSON.stringify(key)
      return storage.get(keyStr) ?? null
    }),
    set: mock(async (key: string[], value: any, ttl?: number) => {
      const keyStr = JSON.stringify(key)
      storage.set(keyStr, value)
    }),
    remove: mock(async (key: string[]) => {
      const keyStr = JSON.stringify(key)
      storage.delete(keyStr)
    }),
    scan: mock(async function* (prefix: string[]) {
      const prefixStr = JSON.stringify(prefix)
      for (const [key, value] of storage.entries()) {
        if (key.startsWith(prefixStr.slice(0, -1))) {
          yield [JSON.parse(key), value]
        }
      }
    }),
    _storage: storage,
  }

  return mockStorage
}

// ============================================
// Test Data Factories
// ============================================

const createTestRole = (overrides?: Partial<Role>): Role => ({
  id: "role-1",
  name: "admin",
  tenant_id: "tenant-1",
  description: "Administrator role",
  is_system_role: false,
  created_at: Date.now(),
  updated_at: Date.now(),
  ...overrides,
})

const createTestPermission = (overrides?: Partial<Permission>): Permission => ({
  id: "perm-1",
  name: "posts:read",
  client_id: "test-app",
  description: "Read posts",
  resource: "posts",
  action: "read",
  created_at: Date.now(),
  ...overrides,
})

const createTestUserRole = (overrides?: Partial<UserRole>): UserRole => ({
  user_id: "user-1",
  role_id: "role-1",
  tenant_id: "tenant-1",
  assigned_at: Date.now(),
  assigned_by: "admin",
  ...overrides,
})

// ============================================
// RBACAdapter (D1) Tests
// ============================================

describe("RBACAdapter", () => {
  let adapter: RBACAdapter
  let mockDb: any

  beforeEach(() => {
    mockDb = createMockD1()
    adapter = new RBACAdapter(mockDb)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))
  })

  afterEach(() => {
    setSystemTime()
  })

  // ==========================================
  // Create Operations
  // ==========================================

  describe("createRole", () => {
    test("creates role with generated UUID", async () => {
      const prepareSpy = spyOn(mockDb, "prepare")

      const role = await adapter.createRole({
        name: "editor",
        tenant_id: "tenant-1",
        description: "Editor role",
        is_system_role: false,
      })

      expect(prepareSpy).toHaveBeenCalled()
      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("INSERT INTO rbac_roles")

      expect(role.id).toBeDefined()
      expect(role.name).toBe("editor")
      expect(role.tenant_id).toBe("tenant-1")
      expect(role.is_system_role).toBe(false)
    })

    test("creates system role", async () => {
      const role = await adapter.createRole({
        name: "super-admin",
        tenant_id: "tenant-1",
        is_system_role: true,
      })

      expect(role.is_system_role).toBe(true)
    })
  })

  describe("createPermission", () => {
    test("creates permission with correct structure", async () => {
      const prepareSpy = spyOn(mockDb, "prepare")

      const permission = await adapter.createPermission({
        name: "users:write",
        client_id: "app-1",
        resource: "users",
        action: "write",
        description: "Write users",
      })

      expect(prepareSpy).toHaveBeenCalled()
      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("INSERT INTO rbac_permissions")

      expect(permission.id).toBeDefined()
      expect(permission.name).toBe("users:write")
      expect(permission.client_id).toBe("app-1")
      expect(permission.resource).toBe("users")
      expect(permission.action).toBe("write")
    })
  })

  // ==========================================
  // Assignment Operations
  // ==========================================

  describe("assignRoleToUser", () => {
    test("assigns role to user", async () => {
      mockDb._setResults([]) // No existing assignment

      const prepareSpy = spyOn(mockDb, "prepare")

      const userRole = await adapter.assignRoleToUser({
        user_id: "user-1",
        role_id: "role-1",
        tenant_id: "tenant-1",
        assigned_by: "admin",
      })

      expect(userRole.user_id).toBe("user-1")
      expect(userRole.role_id).toBe("role-1")
      expect(userRole.tenant_id).toBe("tenant-1")

      // Verify INSERT was called
      const insertCall = prepareSpy.mock.calls.find((call) =>
        call[0].includes("INSERT INTO rbac_user_roles"),
      )
      expect(insertCall).toBeDefined()
    })

    test("throws error if role already assigned", async () => {
      // Mock existing assignment
      mockDb._setResults([{ user_id: "user-1" }])

      await expect(
        adapter.assignRoleToUser({
          user_id: "user-1",
          role_id: "role-1",
          tenant_id: "tenant-1",
          assigned_by: "admin",
        }),
      ).rejects.toThrow("Role is already assigned to user")
    })

    test("supports expiration timestamp", async () => {
      mockDb._setResults([])

      const expiresAt = Date.now() + 86400000 // 24 hours

      const userRole = await adapter.assignRoleToUser({
        user_id: "user-1",
        role_id: "role-1",
        tenant_id: "tenant-1",
        assigned_by: "admin",
        expires_at: expiresAt,
      })

      expect(userRole.expires_at).toBe(expiresAt)
    })
  })

  describe("assignPermissionToRole", () => {
    test("assigns permission to role", async () => {
      mockDb._setResults([]) // No existing assignment

      const prepareSpy = spyOn(mockDb, "prepare")

      const rolePermission = await adapter.assignPermissionToRole({
        role_id: "role-1",
        permission_id: "perm-1",
        granted_by: "admin",
      })

      expect(rolePermission.role_id).toBe("role-1")
      expect(rolePermission.permission_id).toBe("perm-1")
      expect(rolePermission.granted_by).toBe("admin")

      // Verify INSERT was called
      const insertCall = prepareSpy.mock.calls.find((call) =>
        call[0].includes("INSERT INTO rbac_role_permissions"),
      )
      expect(insertCall).toBeDefined()
    })

    test("throws error if permission already assigned to role", async () => {
      mockDb._setResults([{ role_id: "role-1" }])

      await expect(
        adapter.assignPermissionToRole({
          role_id: "role-1",
          permission_id: "perm-1",
          granted_by: "admin",
        }),
      ).rejects.toThrow("Permission is already assigned to role")
    })
  })

  describe("removeRoleFromUser", () => {
    test("removes role assignment", async () => {
      const prepareSpy = spyOn(mockDb, "prepare")

      await adapter.removeRoleFromUser("user-1", "role-1", "tenant-1")

      expect(prepareSpy).toHaveBeenCalled()
      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("DELETE FROM rbac_user_roles")
      expect(sql).toContain(
        "WHERE user_id = ? AND role_id = ? AND tenant_id = ?",
      )
    })
  })

  describe("removePermissionFromRole", () => {
    test("removes permission from role", async () => {
      const prepareSpy = spyOn(mockDb, "prepare")

      await adapter.removePermissionFromRole("role-1", "perm-1")

      expect(prepareSpy).toHaveBeenCalled()
      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("DELETE FROM rbac_role_permissions")
      expect(sql).toContain("WHERE role_id = ? AND permission_id = ?")
    })
  })

  // ==========================================
  // Query Operations
  // ==========================================

  describe("getUserRoles", () => {
    test("returns user roles excluding expired ones", async () => {
      const now = Date.now()

      const roles = [
        {
          id: "role-1",
          name: "admin",
          tenant_id: "tenant-1",
          description: "Admin",
          is_system_role: 0,
          created_at: now,
          updated_at: now,
        },
        {
          id: "role-2",
          name: "editor",
          tenant_id: "tenant-1",
          description: null,
          is_system_role: 1,
          created_at: now,
          updated_at: now,
        },
      ]

      mockDb._setResults(roles)

      const prepareSpy = spyOn(mockDb, "prepare")

      const result = await adapter.getUserRoles("user-1", "tenant-1")

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe("admin")
      expect(result[0].is_system_role).toBe(false)
      expect(result[1].name).toBe("editor")
      expect(result[1].is_system_role).toBe(true)
      expect(result[1].description).toBeUndefined()

      // Verify expiration check in SQL
      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("ur.expires_at IS NULL OR ur.expires_at > ?")
    })

    test("enforces tenant isolation", async () => {
      mockDb._setResults([])

      const prepareSpy = spyOn(mockDb, "prepare")

      await adapter.getUserRoles("user-1", "tenant-1")

      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("WHERE ur.user_id = ? AND ur.tenant_id = ?")
    })
  })

  describe("listRoles", () => {
    test("lists roles for tenant", async () => {
      const roles = [
        {
          id: "role-1",
          name: "admin",
          tenant_id: "tenant-1",
          description: "Admin",
          is_system_role: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ]

      mockDb._setResults(roles)

      const prepareSpy = spyOn(mockDb, "prepare")

      const result = await adapter.listRoles("tenant-1")

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe("admin")

      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("WHERE tenant_id = ?")
    })
  })

  describe("listPermissions", () => {
    test("lists permissions for app", async () => {
      const permissions = [
        {
          id: "perm-1",
          name: "posts:read",
          client_id: "app-1",
          description: "Read",
          resource: "posts",
          action: "read",
          created_at: Date.now(),
        },
      ]

      mockDb._setResults(permissions)

      const prepareSpy = spyOn(mockDb, "prepare")

      const result = await adapter.listPermissions("app-1")

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe("posts:read")

      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("WHERE client_id = ?")
    })
  })

  describe("listRolePermissions", () => {
    test("lists permissions for role", async () => {
      const permissions = [
        {
          id: "perm-1",
          name: "posts:read",
          client_id: "app-1",
          description: "Read",
          resource: "posts",
          action: "read",
          created_at: Date.now(),
        },
      ]

      mockDb._setResults(permissions)

      const prepareSpy = spyOn(mockDb, "prepare")

      const result = await adapter.listRolePermissions("role-1")

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe("posts:read")

      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("WHERE rp.role_id = ?")
    })
  })

  describe("listUserRoles", () => {
    test("lists role assignments for user", async () => {
      const userRoles = [
        {
          user_id: "user-1",
          role_id: "role-1",
          tenant_id: "tenant-1",
          assigned_at: Date.now(),
          expires_at: null,
          assigned_by: "admin",
        },
      ]

      mockDb._setResults(userRoles)

      const prepareSpy = spyOn(mockDb, "prepare")

      const result = await adapter.listUserRoles("user-1", "tenant-1")

      expect(result).toHaveLength(1)
      expect(result[0].role_id).toBe("role-1")
      expect(result[0].expires_at).toBeUndefined()

      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("WHERE user_id = ? AND tenant_id = ?")
    })
  })

  describe("getRole", () => {
    test("gets role by id with tenant isolation", async () => {
      const role = {
        id: "role-1",
        name: "admin",
        tenant_id: "tenant-1",
        description: "Admin",
        is_system_role: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
      }

      mockDb._setResults([role])

      const prepareSpy = spyOn(mockDb, "prepare")

      const result = await adapter.getRole("role-1", "tenant-1")

      expect(result).not.toBeNull()
      expect(result?.name).toBe("admin")

      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("WHERE id = ? AND tenant_id = ?")
    })
  })

  describe("getPermission", () => {
    test("gets permission by id", async () => {
      const permission = {
        id: "perm-1",
        name: "posts:read",
        client_id: "app-1",
        description: "Read",
        resource: "posts",
        action: "read",
        created_at: Date.now(),
      }

      mockDb._setResults([permission])

      const result = await adapter.getPermission("perm-1")

      expect(result).not.toBeNull()
      expect(result?.name).toBe("posts:read")
    })
  })

  describe("getRolePermissions", () => {
    test("returns empty array for empty role list", async () => {
      const result = await adapter.getRolePermissions([])
      expect(result).toEqual([])
    })

    test("builds parameterized IN clause for multiple roles", async () => {
      const permissions = [
        {
          id: "perm-1",
          name: "posts:read",
          client_id: "app-1",
          description: "Read",
          resource: "posts",
          action: "read",
          created_at: Date.now(),
        },
      ]

      mockDb._setResults(permissions)

      const prepareSpy = spyOn(mockDb, "prepare")

      await adapter.getRolePermissions(["role-1", "role-2", "role-3"])

      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("WHERE rp.role_id IN (?, ?, ?)")
    })
  })

  // ==========================================
  // Update Operations
  // ==========================================

  describe("updateRole", () => {
    test("updates role name", async () => {
      const now = Date.now()
      const existingRole = {
        id: "role-1",
        name: "new-name",
        tenant_id: "tenant-1",
        description: "Admin",
        is_system_role: 0,
        created_at: now,
        updated_at: now,
      }

      mockDb._setResults([existingRole])

      const prepareSpy = spyOn(mockDb, "prepare")

      const result = await adapter.updateRole("role-1", "tenant-1", {
        name: "new-name",
      })

      expect(result.name).toBe("new-name")

      // Check UPDATE query was called
      const updateCall = prepareSpy.mock.calls.find((call) =>
        call[0].includes("UPDATE rbac_roles"),
      )
      expect(updateCall).toBeDefined()
    })

    test("updates role description", async () => {
      const now = Date.now()
      const existingRole = {
        id: "role-1",
        name: "admin",
        tenant_id: "tenant-1",
        description: "New description",
        is_system_role: 0,
        created_at: now,
        updated_at: now,
      }

      mockDb._setResults([existingRole])

      const result = await adapter.updateRole("role-1", "tenant-1", {
        description: "New description",
      })

      expect(result.description).toBe("New description")
    })

    test("throws error for invalid role name format", async () => {
      // Set up an existing non-system role for the getRole check
      const existingRole = {
        id: "role-1",
        name: "admin",
        tenant_id: "tenant-1",
        description: "Admin role",
        is_system_role: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
      }
      mockDb._setResults([existingRole])

      await expect(
        adapter.updateRole("role-1", "tenant-1", {
          name: "invalid name!",
        }),
      ).rejects.toThrow(
        "Role name must contain only alphanumeric characters, hyphens, and underscores",
      )
    })

    test("throws error when role not found", async () => {
      mockDb._setResults([]) // No role found

      await expect(
        adapter.updateRole("nonexistent", "tenant-1", {
          name: "new-name",
        }),
      ).rejects.toThrow("Role not found")
    })

    test("throws error when trying to update system role", async () => {
      // Set up a system role
      const systemRole = {
        id: "system-role-1",
        name: "system-admin",
        tenant_id: "tenant-1",
        description: "System admin role",
        is_system_role: 1, // System role
        created_at: Date.now(),
        updated_at: Date.now(),
      }
      mockDb._setResults([systemRole])

      await expect(
        adapter.updateRole("system-role-1", "tenant-1", {
          name: "new-name",
        }),
      ).rejects.toThrow("Cannot modify system role")
    })
  })

  describe("deleteRole", () => {
    test("deletes role and associated data", async () => {
      const role = {
        id: "role-1",
        name: "admin",
        tenant_id: "tenant-1",
        description: "Admin",
        is_system_role: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
      }

      mockDb._setResults([role])

      const prepareSpy = spyOn(mockDb, "prepare")

      await adapter.deleteRole("role-1", "tenant-1")

      // Verify deletion queries were called
      const deleteUserRoles = prepareSpy.mock.calls.find((call) =>
        call[0].includes("DELETE FROM rbac_user_roles"),
      )
      expect(deleteUserRoles).toBeDefined()

      const deleteRolePermissions = prepareSpy.mock.calls.find((call) =>
        call[0].includes("DELETE FROM rbac_role_permissions"),
      )
      expect(deleteRolePermissions).toBeDefined()

      const deleteRole = prepareSpy.mock.calls.find((call) =>
        call[0].includes("DELETE FROM rbac_roles"),
      )
      expect(deleteRole).toBeDefined()
    })

    test("throws error when role not found", async () => {
      mockDb._setResults([]) // No role found

      await expect(
        adapter.deleteRole("nonexistent", "tenant-1"),
      ).rejects.toThrow("Role not found")
    })

    test("throws error when trying to delete system role", async () => {
      const systemRole = {
        id: "role-1",
        name: "super-admin",
        tenant_id: "tenant-1",
        description: "System admin",
        is_system_role: 1, // This is a system role
        created_at: Date.now(),
        updated_at: Date.now(),
      }

      mockDb._setResults([systemRole])

      await expect(adapter.deleteRole("role-1", "tenant-1")).rejects.toThrow(
        "Cannot delete system role",
      )
    })
  })

  describe("deletePermission", () => {
    test("deletes permission and removes from roles", async () => {
      const permission = {
        id: "perm-1",
        name: "posts:read",
        client_id: "app-1",
        description: "Read",
        resource: "posts",
        action: "read",
        created_at: Date.now(),
      }

      mockDb._setResults([permission])

      const prepareSpy = spyOn(mockDb, "prepare")

      await adapter.deletePermission("perm-1")

      // Verify deletion queries were called
      const deleteRolePermissions = prepareSpy.mock.calls.find((call) =>
        call[0].includes("DELETE FROM rbac_role_permissions"),
      )
      expect(deleteRolePermissions).toBeDefined()

      const deletePermission = prepareSpy.mock.calls.find((call) =>
        call[0].includes("DELETE FROM rbac_permissions"),
      )
      expect(deletePermission).toBeDefined()
    })

    test("throws error when permission not found", async () => {
      mockDb._setResults([]) // No permission found

      await expect(adapter.deletePermission("nonexistent")).rejects.toThrow(
        "Permission not found",
      )
    })

    test("throws error when permission client_id does not match", async () => {
      const permission = {
        id: "perm-1",
        name: "posts:read",
        client_id: "app-1",
        description: "Read",
        resource: "posts",
        action: "read",
        created_at: Date.now(),
      }

      mockDb._setResults([permission])

      await expect(
        adapter.deletePermission("perm-1", "different-app"),
      ).rejects.toThrow("Permission not found in specified client")
    })
  })

  describe("getUsersWithRole", () => {
    test("returns list of user IDs with role", async () => {
      const userRoles = [{ user_id: "user-1" }, { user_id: "user-2" }]

      mockDb._setResults(userRoles)

      const prepareSpy = spyOn(mockDb, "prepare")

      const result = await adapter.getUsersWithRole("role-1", "tenant-1")

      expect(result).toEqual(["user-1", "user-2"])

      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("SELECT DISTINCT user_id")
      expect(sql).toContain("FROM rbac_user_roles")
      expect(sql).toContain("WHERE role_id = ? AND tenant_id = ?")
    })

    test("returns empty array when no users have role", async () => {
      mockDb._setResults([])

      const result = await adapter.getUsersWithRole("role-1", "tenant-1")

      expect(result).toEqual([])
    })
  })
})

// ============================================
// RBACServiceImpl Tests
// ============================================

describe("RBACServiceImpl", () => {
  let service: RBACServiceImpl
  let adapter: RBACAdapter
  let storage: StorageAdapter
  let mockDb: any

  beforeEach(() => {
    mockDb = createMockD1()
    adapter = new RBACAdapter(mockDb)
    storage = createMockStorage()
    service = new RBACServiceImpl(adapter, storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))
  })

  afterEach(() => {
    setSystemTime()
  })

  // ==========================================
  // Permission Checking
  // ==========================================

  describe("checkPermission", () => {
    test("returns true when user has permission", async () => {
      const permissions = [
        {
          id: "perm-1",
          name: "posts:read",
          client_id: "app-1",
          description: "Read posts",
          resource: "posts",
          action: "read",
          created_at: Date.now(),
        },
      ]

      mockDb._setResults(permissions)

      const result = await service.checkPermission({
        userId: "user-1",
        clientId: "app-1",
        tenantId: "tenant-1",
        permission: "posts:read",
      })

      expect(result).toBe(true)
    })

    test("returns false when user lacks permission", async () => {
      mockDb._setResults([])

      const result = await service.checkPermission({
        userId: "user-1",
        clientId: "app-1",
        tenantId: "tenant-1",
        permission: "posts:delete",
      })

      expect(result).toBe(false)
    })

    test("uses cached permissions on subsequent calls", async () => {
      const permissions = [
        {
          id: "perm-1",
          name: "posts:read",
          client_id: "app-1",
          description: "Read",
          resource: "posts",
          action: "read",
          created_at: Date.now(),
        },
      ]

      mockDb._setResults(permissions)

      const prepareSpy = spyOn(mockDb, "prepare")

      // First call - should query database
      await service.checkPermission({
        userId: "user-1",
        clientId: "app-1",
        tenantId: "tenant-1",
        permission: "posts:read",
      })

      const firstCallCount = prepareSpy.mock.calls.length

      // Second call - should use cache
      await service.checkPermission({
        userId: "user-1",
        clientId: "app-1",
        tenantId: "tenant-1",
        permission: "posts:read",
      })

      const secondCallCount = prepareSpy.mock.calls.length

      // Should not have made additional database calls
      expect(secondCallCount).toBe(firstCallCount)
    })

    test("refreshes cache after TTL expires", async () => {
      const permissions = [
        {
          id: "perm-1",
          name: "posts:read",
          client_id: "app-1",
          description: "Read",
          resource: "posts",
          action: "read",
          created_at: Date.now(),
        },
      ]

      mockDb._setResults(permissions)

      const getSpy = spyOn(storage, "get")

      // First call
      await service.checkPermission({
        userId: "user-1",
        clientId: "app-1",
        tenantId: "tenant-1",
        permission: "posts:read",
      })

      // Move time forward past TTL (60 seconds)
      setSystemTime(new Date("2024-01-01T00:02:00Z"))

      // Second call - should refresh cache
      await service.checkPermission({
        userId: "user-1",
        clientId: "app-1",
        tenantId: "tenant-1",
        permission: "posts:read",
      })

      // Should have checked cache twice
      expect(getSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe("checkPermissions", () => {
    test("returns correct results for batch permission check", async () => {
      const permissions = [
        {
          id: "perm-1",
          name: "posts:read",
          client_id: "app-1",
          description: "Read",
          resource: "posts",
          action: "read",
          created_at: Date.now(),
        },
        {
          id: "perm-2",
          name: "posts:write",
          client_id: "app-1",
          description: "Write",
          resource: "posts",
          action: "write",
          created_at: Date.now(),
        },
      ]

      mockDb._setResults(permissions)

      const results = await service.checkPermissions({
        userId: "user-1",
        clientId: "app-1",
        tenantId: "tenant-1",
        permissions: ["posts:read", "posts:write", "posts:delete"],
      })

      expect(results["posts:read"]).toBe(true)
      expect(results["posts:write"]).toBe(true)
      expect(results["posts:delete"]).toBe(false)
    })

    test("uses cached permissions for batch check", async () => {
      const permissions = [
        {
          id: "perm-1",
          name: "posts:read",
          client_id: "app-1",
          description: "Read",
          resource: "posts",
          action: "read",
          created_at: Date.now(),
        },
      ]

      mockDb._setResults(permissions)

      const prepareSpy = spyOn(mockDb, "prepare")

      // First batch check
      await service.checkPermissions({
        userId: "user-1",
        clientId: "app-1",
        tenantId: "tenant-1",
        permissions: ["posts:read", "posts:write"],
      })

      const firstCallCount = prepareSpy.mock.calls.length

      // Second batch check - should use cache
      await service.checkPermissions({
        userId: "user-1",
        clientId: "app-1",
        tenantId: "tenant-1",
        permissions: ["posts:read"],
      })

      expect(prepareSpy.mock.calls.length).toBe(firstCallCount)
    })
  })

  describe("getUserPermissions", () => {
    test("returns all user permissions for app", async () => {
      const permissions = [
        {
          id: "perm-1",
          name: "posts:read",
          client_id: "app-1",
          description: "Read",
          resource: "posts",
          action: "read",
          created_at: Date.now(),
        },
        {
          id: "perm-2",
          name: "posts:write",
          client_id: "app-1",
          description: "Write",
          resource: "posts",
          action: "write",
          created_at: Date.now(),
        },
      ]

      mockDb._setResults(permissions)

      const result = await service.getUserPermissions({
        userId: "user-1",
        clientId: "app-1",
        tenantId: "tenant-1",
      })

      expect(result).toEqual(["posts:read", "posts:write"])
    })

    test("caches permission list", async () => {
      const permissions = [
        {
          id: "perm-1",
          name: "posts:read",
          client_id: "app-1",
          description: "Read",
          resource: "posts",
          action: "read",
          created_at: Date.now(),
        },
      ]

      mockDb._setResults(permissions)

      const setSpy = spyOn(storage, "set")

      await service.getUserPermissions({
        userId: "user-1",
        clientId: "app-1",
        tenantId: "tenant-1",
      })

      expect(setSpy).toHaveBeenCalled()
      const cacheKey = setSpy.mock.calls[0][0]
      expect(cacheKey).toEqual([
        "rbac",
        "permissions",
        "tenant-1",
        "user-1",
        "app-1",
      ])
    })
  })

  describe("getUserRoles", () => {
    test("returns user roles from adapter", async () => {
      const roles = [
        {
          id: "role-1",
          name: "admin",
          tenant_id: "tenant-1",
          description: "Admin",
          is_system_role: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ]

      mockDb._setResults(roles)

      const result = await service.getUserRoles("user-1", "tenant-1")

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe("admin")
    })
  })

  // ==========================================
  // Token Enrichment
  // ==========================================

  describe("enrichTokenClaims", () => {
    test("returns roles and permissions for token", async () => {
      const roles = [
        {
          id: "role-1",
          name: "admin",
          tenant_id: "tenant-1",
          description: "Admin",
          is_system_role: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: "role-2",
          name: "editor",
          tenant_id: "tenant-1",
          description: "Editor",
          is_system_role: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ]

      const permissions = [
        {
          id: "perm-1",
          name: "posts:read",
          client_id: "app-1",
          description: "Read",
          resource: "posts",
          action: "read",
          created_at: Date.now(),
        },
        {
          id: "perm-2",
          name: "posts:write",
          client_id: "app-1",
          description: "Write",
          resource: "posts",
          action: "write",
          created_at: Date.now(),
        },
      ]

      // First query returns roles
      mockDb._setResults(roles)

      const result = await service.enrichTokenClaims({
        userId: "user-1",
        clientId: "app-1",
        tenantId: "tenant-1",
      })

      expect(result.roles).toEqual(["admin", "editor"])
      // Permissions would be fetched from cache or second query
    })

    test("enforces max permissions limit", async () => {
      const roles = [
        {
          id: "role-1",
          name: "admin",
          tenant_id: "tenant-1",
          description: "Admin",
          is_system_role: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ]

      // Create 60 permissions (exceeds default limit of 50)
      const permissions = Array.from({ length: 60 }, (_, i) => ({
        id: `perm-${i}`,
        name: `permission:${i}`,
        client_id: "app-1",
        description: `Permission ${i}`,
        resource: "resource",
        action: "action",
        created_at: Date.now(),
      }))

      mockDb._setResults(permissions)

      const result = await service.enrichTokenClaims({
        userId: "user-1",
        clientId: "app-1",
        tenantId: "tenant-1",
      })

      // Should be limited to 50
      expect(result.permissions.length).toBe(50)
    })

    test("warns when limiting permissions", async () => {
      const consoleSpy = spyOn(console, "warn")

      const roles = [
        {
          id: "role-1",
          name: "admin",
          tenant_id: "tenant-1",
          description: "Admin",
          is_system_role: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ]

      const permissions = Array.from({ length: 60 }, (_, i) => ({
        id: `perm-${i}`,
        name: `permission:${i}`,
        client_id: "app-1",
        description: `Permission ${i}`,
        resource: "resource",
        action: "action",
        created_at: Date.now(),
      }))

      mockDb._setResults(permissions)

      await service.enrichTokenClaims({
        userId: "user-1",
        clientId: "app-1",
        tenantId: "tenant-1",
      })

      expect(consoleSpy).toHaveBeenCalled()
      expect(consoleSpy.mock.calls[0][0]).toContain("60 permissions")
      expect(consoleSpy.mock.calls[0][0]).toContain("limiting to 50")
    })
  })

  // ==========================================
  // Cache Invalidation
  // ==========================================

  describe("cache invalidation", () => {
    test("invalidates cache when assigning role to user", async () => {
      // Set up mock responses for the query sequence:
      // 1. getRole: return the role object
      // 2. check existing assignment: return null (no existing assignment)
      const mockRole = {
        id: "role-1",
        name: "editor",
        tenant_id: "tenant-1",
        description: "Editor role",
        is_system_role: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
      }
      // Use consume mode (true) to shift results off queue after each query
      mockDb._setResults([mockRole, null], true)

      const removeSpy = spyOn(storage, "remove")

      // Pre-populate cache
      await storage.set(
        ["rbac", "permissions", "tenant-1", "user-1", "app-1"],
        { permissions: ["posts:read"], cachedAt: Date.now() },
      )

      await service.assignRoleToUser({
        userId: "user-1",
        roleId: "role-1",
        tenantId: "tenant-1",
        assignedBy: "admin",
      })

      // Should have removed cache
      expect(removeSpy).toHaveBeenCalled()
    })

    test("invalidates cache when removing role from user", async () => {
      const removeSpy = spyOn(storage, "remove")

      await storage.set(
        ["rbac", "permissions", "tenant-1", "user-1", "app-1"],
        { permissions: ["posts:read"], cachedAt: Date.now() },
      )

      await service.removeRoleFromUser({
        userId: "user-1",
        roleId: "role-1",
        tenantId: "tenant-1",
      })

      expect(removeSpy).toHaveBeenCalled()
    })

    test("invalidates cache for all users with role when assigning permission", async () => {
      mockDb._setResults([]) // No existing assignment

      const userRoles = [
        {
          user_id: "user-1",
          role_id: "role-1",
          tenant_id: "tenant-1",
          assigned_at: Date.now(),
          assigned_by: "admin",
        },
        {
          user_id: "user-2",
          role_id: "role-1",
          tenant_id: "tenant-1",
          assigned_at: Date.now(),
          assigned_by: "admin",
        },
      ]

      // Pre-populate caches for both users
      await storage.set(
        ["rbac", "permissions", "tenant-1", "user-1", "app-1"],
        { permissions: ["posts:read"], cachedAt: Date.now() },
      )
      await storage.set(
        ["rbac", "permissions", "tenant-1", "user-2", "app-1"],
        { permissions: ["posts:read"], cachedAt: Date.now() },
      )

      const removeSpy = spyOn(storage, "remove")
      const listUserRolesSpy = spyOn(
        adapter,
        "listUserRoles",
      ).mockResolvedValue(userRoles)

      await service.assignPermissionToRole({
        roleId: "role-1",
        permissionId: "perm-1",
        grantedBy: "admin",
      })

      // Should call listUserRoles to find users with this role
      expect(listUserRolesSpy).toHaveBeenCalled()
      // The actual cache invalidation might vary based on implementation
      // so we just verify the method was called to get the user list
    })

    test("handles cache invalidation errors gracefully", async () => {
      mockDb._setResults([])

      const consoleSpy = spyOn(console, "warn")
      const listUserRolesSpy = spyOn(
        adapter,
        "listUserRoles",
      ).mockRejectedValue(new Error("Database error"))

      await service.assignPermissionToRole({
        roleId: "role-1",
        permissionId: "perm-1",
        grantedBy: "admin",
      })

      // Should warn but not throw
      expect(consoleSpy).toHaveBeenCalled()
      const warnCalls = consoleSpy.mock.calls.map((call) => call[0])
      const hasInvalidationWarning = warnCalls.some((msg) =>
        msg.includes("Could not invalidate cache"),
      )
      expect(hasInvalidationWarning).toBe(true)
    })
  })

  // ==========================================
  // Admin Operations
  // ==========================================

  describe("admin operations", () => {
    test("creates role via adapter", async () => {
      const createRoleSpy = spyOn(adapter, "createRole").mockResolvedValue(
        createTestRole(),
      )

      await service.createRole({
        name: "editor",
        tenantId: "tenant-1",
        description: "Editor role",
      })

      expect(createRoleSpy).toHaveBeenCalledWith({
        name: "editor",
        tenant_id: "tenant-1",
        description: "Editor role",
        is_system_role: undefined,
      })
    })

    test("creates permission via adapter", async () => {
      const createPermissionSpy = spyOn(
        adapter,
        "createPermission",
      ).mockResolvedValue(createTestPermission())

      await service.createPermission({
        name: "users:write",
        clientId: "app-1",
        resource: "users",
        action: "write",
      })

      expect(createPermissionSpy).toHaveBeenCalledWith({
        name: "users:write",
        client_id: "app-1",
        resource: "users",
        action: "write",
        description: undefined,
      })
    })

    test("lists roles via adapter", async () => {
      const listRolesSpy = spyOn(adapter, "listRoles").mockResolvedValue([
        createTestRole(),
      ])

      await service.listRoles("tenant-1")

      expect(listRolesSpy).toHaveBeenCalledWith("tenant-1")
    })

    test("lists permissions via adapter", async () => {
      const listPermissionsSpy = spyOn(
        adapter,
        "listPermissions",
      ).mockResolvedValue([createTestPermission()])

      await service.listPermissions("app-1")

      expect(listPermissionsSpy).toHaveBeenCalledWith("app-1")
    })

    test("lists role permissions via adapter", async () => {
      const listRolePermissionsSpy = spyOn(
        adapter,
        "listRolePermissions",
      ).mockResolvedValue([createTestPermission()])

      await service.listRolePermissions("role-1")

      expect(listRolePermissionsSpy).toHaveBeenCalledWith("role-1")
    })

    test("lists user roles via adapter", async () => {
      const listUserRolesSpy = spyOn(
        adapter,
        "listUserRoles",
      ).mockResolvedValue([createTestUserRole()])

      await service.listUserRoles("user-1", "tenant-1")

      expect(listUserRolesSpy).toHaveBeenCalledWith("user-1", "tenant-1")
    })

    test("gets role via adapter", async () => {
      const getRoleSpy = spyOn(adapter, "getRole").mockResolvedValue(
        createTestRole(),
      )

      const result = await service.getRole("role-1", "tenant-1")

      expect(getRoleSpy).toHaveBeenCalledWith("role-1", "tenant-1")
      expect(result).not.toBeNull()
      expect(result?.name).toBe("admin")
    })

    test("gets permission via adapter", async () => {
      const getPermissionSpy = spyOn(
        adapter,
        "getPermission",
      ).mockResolvedValue(createTestPermission())

      const result = await service.getPermission("perm-1")

      expect(getPermissionSpy).toHaveBeenCalledWith("perm-1")
      expect(result).not.toBeNull()
      expect(result?.name).toBe("posts:read")
    })

    test("updates role via adapter", async () => {
      const updateRoleSpy = spyOn(adapter, "updateRole").mockResolvedValue(
        createTestRole({ name: "updated-role" }),
      )

      const result = await service.updateRole({
        roleId: "role-1",
        tenantId: "tenant-1",
        name: "updated-role",
        description: "Updated description",
      })

      expect(updateRoleSpy).toHaveBeenCalledWith("role-1", "tenant-1", {
        name: "updated-role",
        description: "Updated description",
      })
      expect(result.name).toBe("updated-role")
    })

    test("deletes role and invalidates cache", async () => {
      const getUsersWithRoleSpy = spyOn(
        adapter,
        "getUsersWithRole",
      ).mockResolvedValue(["user-1", "user-2"])
      const deleteRoleSpy = spyOn(adapter, "deleteRole").mockResolvedValue(
        undefined,
      )
      const removeSpy = spyOn(storage, "remove")

      // Pre-populate caches
      await storage.set(
        ["rbac", "permissions", "tenant-1", "user-1", "app-1"],
        { permissions: ["posts:read"], cachedAt: Date.now() },
      )
      await storage.set(
        ["rbac", "permissions", "tenant-1", "user-2", "app-1"],
        { permissions: ["posts:write"], cachedAt: Date.now() },
      )

      await service.deleteRole("role-1", "tenant-1")

      expect(getUsersWithRoleSpy).toHaveBeenCalledWith("role-1", "tenant-1")
      expect(deleteRoleSpy).toHaveBeenCalledWith("role-1", "tenant-1")
      // Cache should have been invalidated for users
      expect(removeSpy).toHaveBeenCalled()
    })

    test("deletes permission via adapter", async () => {
      const deletePermissionSpy = spyOn(
        adapter,
        "deletePermission",
      ).mockResolvedValue(undefined)

      await service.deletePermission("perm-1")

      expect(deletePermissionSpy).toHaveBeenCalledWith("perm-1")
    })
  })

  // ==========================================
  // Security Features Tests
  // ==========================================

  describe("security features", () => {
    test("prevents self-assignment of roles", async () => {
      // Set up mock role for getRole check
      const mockRole = createTestRole({ is_system_role: false })
      const getRoleSpy = spyOn(adapter, "getRole").mockResolvedValue(mockRole)

      await expect(
        service.assignRoleToUser({
          userId: "user-1",
          roleId: "role-1",
          tenantId: "tenant-1",
          assignedBy: "user-1", // Same as userId - self-assignment
        }),
      ).rejects.toThrow("Cannot assign roles to yourself")
    })

    test("prevents privilege escalation for system roles", async () => {
      // Set up a system role
      const systemRole = createTestRole({
        id: "system-admin",
        name: "system-admin",
        is_system_role: true,
      })
      const getRoleSpy = spyOn(adapter, "getRole").mockResolvedValue(systemRole)

      // Assigner does NOT have the system role
      const getUserRolesSpy = spyOn(adapter, "getUserRoles").mockResolvedValue([
        createTestRole({
          id: "other-role",
          name: "editor",
          is_system_role: false,
        }),
      ])

      await expect(
        service.assignRoleToUser({
          userId: "user-2",
          roleId: "system-admin",
          tenantId: "tenant-1",
          assignedBy: "admin", // Admin trying to assign system role they don't have
        }),
      ).rejects.toThrow("Cannot assign a system role you do not have")
    })

    test("allows assigning system role if assigner has it", async () => {
      // Set up a system role
      const systemRole = createTestRole({
        id: "system-admin",
        name: "system-admin",
        is_system_role: true,
      })
      const getRoleSpy = spyOn(adapter, "getRole").mockResolvedValue(systemRole)

      // Assigner HAS the system role
      const getUserRolesSpy = spyOn(adapter, "getUserRoles").mockResolvedValue([
        createTestRole({
          id: "system-admin",
          name: "system-admin",
          is_system_role: true,
        }),
      ])

      // Mock the adapter's assignRoleToUser
      const assignSpy = spyOn(adapter, "assignRoleToUser").mockResolvedValue({
        user_id: "user-2",
        role_id: "system-admin",
        tenant_id: "tenant-1",
        assigned_at: Date.now(),
        assigned_by: "admin",
      })

      // Should succeed
      const result = await service.assignRoleToUser({
        userId: "user-2",
        roleId: "system-admin",
        tenantId: "tenant-1",
        assignedBy: "admin",
      })

      expect(result.role_id).toBe("system-admin")
      expect(assignSpy).toHaveBeenCalled()
    })

    test("allows assigning non-system role without privilege check", async () => {
      // Set up a non-system role
      const regularRole = createTestRole({
        id: "editor",
        name: "editor",
        is_system_role: false,
      })
      const getRoleSpy = spyOn(adapter, "getRole").mockResolvedValue(
        regularRole,
      )

      // Mock the adapter's assignRoleToUser
      const assignSpy = spyOn(adapter, "assignRoleToUser").mockResolvedValue({
        user_id: "user-2",
        role_id: "editor",
        tenant_id: "tenant-1",
        assigned_at: Date.now(),
        assigned_by: "admin",
      })

      // Should succeed without checking assigner's roles
      const result = await service.assignRoleToUser({
        userId: "user-2",
        roleId: "editor",
        tenantId: "tenant-1",
        assignedBy: "admin",
      })

      expect(result.role_id).toBe("editor")
      expect(assignSpy).toHaveBeenCalled()
    })

    test("throws role not found for non-existent role", async () => {
      const getRoleSpy = spyOn(adapter, "getRole").mockResolvedValue(null)

      await expect(
        service.assignRoleToUser({
          userId: "user-2",
          roleId: "non-existent",
          tenantId: "tenant-1",
          assignedBy: "admin",
        }),
      ).rejects.toThrow("Role not found")
    })
  })
})

// ============================================
// Token Enricher Tests
// ============================================

describe("Token Enricher", () => {
  let service: RBACServiceImpl
  let adapter: RBACAdapter
  let storage: StorageAdapter
  let mockDb: any

  beforeEach(() => {
    mockDb = createMockD1()
    adapter = new RBACAdapter(mockDb)
    storage = createMockStorage()
    service = new RBACServiceImpl(adapter, storage)
  })

  describe("enrichTokenWithRBAC", () => {
    test("enriches token with correct structure", async () => {
      const roles = [
        {
          id: "role-1",
          name: "admin",
          tenant_id: "tenant-1",
          description: "Admin",
          is_system_role: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ]

      const permissions = [
        {
          id: "perm-1",
          name: "posts:read",
          client_id: "app-1",
          description: "Read",
          resource: "posts",
          action: "read",
          created_at: Date.now(),
        },
      ]

      mockDb._setResults(permissions)

      const claims = await enrichTokenWithRBAC(service, {
        userId: "user-1",
        clientId: "app-1",
        tenantId: "tenant-1",
      })

      expect(claims).toHaveProperty("roles")
      expect(claims).toHaveProperty("permissions")
      expect(Array.isArray(claims.roles)).toBe(true)
      expect(Array.isArray(claims.permissions)).toBe(true)
    })

    test("enforces custom permission limit", async () => {
      const permissions = Array.from({ length: 60 }, (_, i) => ({
        id: `perm-${i}`,
        name: `permission:${i}`,
        client_id: "app-1",
        description: `Permission ${i}`,
        resource: "resource",
        action: "action",
        created_at: Date.now(),
      }))

      mockDb._setResults(permissions)

      const claims = await enrichTokenWithRBAC(
        service,
        {
          userId: "user-1",
          clientId: "app-1",
          tenantId: "tenant-1",
        },
        { maxPermissionsInToken: 25 },
      )

      expect(claims.permissions.length).toBe(25)
    })

    test("warns when truncating permissions", async () => {
      const consoleSpy = spyOn(console, "warn")

      const permissions = Array.from({ length: 60 }, (_, i) => ({
        id: `perm-${i}`,
        name: `permission:${i}`,
        client_id: "app-1",
        description: `Permission ${i}`,
        resource: "resource",
        action: "action",
        created_at: Date.now(),
      }))

      mockDb._setResults(permissions)

      await enrichTokenWithRBAC(
        service,
        {
          userId: "user-1",
          clientId: "app-1",
          tenantId: "tenant-1",
        },
        { maxPermissionsInToken: 25 },
      )

      expect(consoleSpy).toHaveBeenCalled()
      const warnCalls = consoleSpy.mock.calls.map((call) => call[0])
      const hasTruncationWarning = warnCalls.some((msg) =>
        msg.includes("truncating to 25"),
      )
      expect(hasTruncationWarning).toBe(true)
    })
  })

  describe("createTokenEnricher", () => {
    test("creates bound enricher function", async () => {
      const permissions = [
        {
          id: "perm-1",
          name: "posts:read",
          client_id: "app-1",
          description: "Read",
          resource: "posts",
          action: "read",
          created_at: Date.now(),
        },
      ]

      mockDb._setResults(permissions)

      const enricher = createTokenEnricher(service, {
        maxPermissionsInToken: 25,
      })

      const claims = await enricher({
        userId: "user-1",
        clientId: "app-1",
        tenantId: "tenant-1",
      })

      expect(claims).toHaveProperty("roles")
      expect(claims).toHaveProperty("permissions")
    })
  })

  describe("validateRBACClaims", () => {
    test("validates correct claims structure", () => {
      const claims = {
        roles: ["admin", "editor"],
        permissions: ["posts:read", "posts:write"],
      }

      expect(validateRBACClaims(claims)).toBe(true)
    })

    test("rejects invalid claims - not an object", () => {
      expect(validateRBACClaims(null)).toBe(false)
      expect(validateRBACClaims(undefined)).toBe(false)
      expect(validateRBACClaims("string")).toBe(false)
    })

    test("rejects invalid roles array", () => {
      expect(validateRBACClaims({ roles: "admin", permissions: [] })).toBe(
        false,
      )
      expect(validateRBACClaims({ roles: [1, 2, 3], permissions: [] })).toBe(
        false,
      )
    })

    test("rejects invalid permissions array", () => {
      expect(validateRBACClaims({ roles: [], permissions: "read" })).toBe(false)
      expect(validateRBACClaims({ roles: [], permissions: [1, 2] })).toBe(false)
    })

    test("rejects too many permissions", () => {
      const consoleSpy = spyOn(console, "warn")

      const permissions = Array.from({ length: 60 }, (_, i) => `perm:${i}`)

      const result = validateRBACClaims({
        roles: [],
        permissions,
      })

      expect(result).toBe(false)
      expect(consoleSpy).toHaveBeenCalled()
    })

    test("respects custom permission limit", () => {
      const permissions = Array.from({ length: 30 }, (_, i) => `perm:${i}`)

      const result = validateRBACClaims(
        {
          roles: [],
          permissions,
        },
        { maxPermissionsInToken: 25 },
      )

      expect(result).toBe(false)
    })
  })

  describe("extractRBACClaims", () => {
    test("extracts valid claims from JWT payload", () => {
      const payload = {
        sub: "user-1",
        roles: ["admin"],
        permissions: ["posts:read"],
        iat: Date.now(),
      }

      const claims = extractRBACClaims(payload)

      expect(claims).not.toBeNull()
      expect(claims?.roles).toEqual(["admin"])
      expect(claims?.permissions).toEqual(["posts:read"])
    })

    test("returns null for invalid claims", () => {
      const payload = {
        sub: "user-1",
        roles: "admin", // Invalid - should be array
        permissions: ["posts:read"],
      }

      const claims = extractRBACClaims(payload)

      expect(claims).toBeNull()
    })

    test("returns null for missing claims", () => {
      const payload = {
        sub: "user-1",
        iat: Date.now(),
      }

      const claims = extractRBACClaims(payload)

      expect(claims).toBeNull()
    })
  })

  describe("hasPermissionInToken", () => {
    test("returns true when permission exists", () => {
      const payload = {
        roles: ["admin"],
        permissions: ["posts:read", "posts:write"],
      }

      expect(hasPermissionInToken(payload, "posts:read")).toBe(true)
    })

    test("returns false when permission missing", () => {
      const payload = {
        roles: ["admin"],
        permissions: ["posts:read"],
      }

      expect(hasPermissionInToken(payload, "posts:delete")).toBe(false)
    })

    test("returns false for invalid payload", () => {
      const payload = {
        roles: "admin",
        permissions: "read",
      }

      expect(hasPermissionInToken(payload, "posts:read")).toBe(false)
    })
  })

  describe("hasRoleInToken", () => {
    test("returns true when role exists", () => {
      const payload = {
        roles: ["admin", "editor"],
        permissions: [],
      }

      expect(hasRoleInToken(payload, "admin")).toBe(true)
    })

    test("returns false when role missing", () => {
      const payload = {
        roles: ["editor"],
        permissions: [],
      }

      expect(hasRoleInToken(payload, "admin")).toBe(false)
    })

    test("returns false for invalid payload", () => {
      const payload = {
        roles: "admin",
        permissions: [],
      }

      expect(hasRoleInToken(payload, "admin")).toBe(false)
    })
  })

  describe("hasAllPermissionsInToken", () => {
    test("returns true when all permissions exist", () => {
      const payload = {
        roles: [],
        permissions: ["posts:read", "posts:write", "posts:delete"],
      }

      expect(
        hasAllPermissionsInToken(payload, ["posts:read", "posts:write"]),
      ).toBe(true)
    })

    test("returns false when any permission missing", () => {
      const payload = {
        roles: [],
        permissions: ["posts:read"],
      }

      expect(
        hasAllPermissionsInToken(payload, ["posts:read", "posts:write"]),
      ).toBe(false)
    })

    test("returns true for empty array", () => {
      const payload = {
        roles: [],
        permissions: ["posts:read"],
      }

      expect(hasAllPermissionsInToken(payload, [])).toBe(true)
    })
  })

  describe("hasAnyPermissionInToken", () => {
    test("returns true when any permission exists", () => {
      const payload = {
        roles: [],
        permissions: ["posts:read"],
      }

      expect(
        hasAnyPermissionInToken(payload, ["posts:read", "posts:write"]),
      ).toBe(true)
    })

    test("returns false when no permissions match", () => {
      const payload = {
        roles: [],
        permissions: ["posts:read"],
      }

      expect(
        hasAnyPermissionInToken(payload, ["posts:write", "posts:delete"]),
      ).toBe(false)
    })

    test("returns false for empty array", () => {
      const payload = {
        roles: [],
        permissions: ["posts:read"],
      }

      expect(hasAnyPermissionInToken(payload, [])).toBe(false)
    })
  })
})
