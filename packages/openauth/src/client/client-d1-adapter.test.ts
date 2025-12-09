import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test"
import { ClientD1Adapter } from "./client-d1-adapter.js"
import { ClientNotFoundError, ClientNameConflictError } from "./errors.js"
import { CircuitState } from "./circuit-breaker.js"
import { hashClientSecret } from "./secret-generator.js"

// Helper to create mock D1 database
function createMockD1() {
  const mockClients = new Map<string, any>()

  const mockDb = {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        run: mock(async () => {
          // Handle INSERT
          if (sql.includes("INSERT INTO oauth_clients")) {
            const [
              id,
              tenantId,
              name,
              secretHash,
              grantTypes,
              scopes,
              redirectUris,
              metadata,
              enabled,
              createdAt,
              updatedAt,
            ] = params
            mockClients.set(id, {
              id,
              tenant_id: tenantId,
              name,
              client_secret_hash: secretHash,
              grant_types: grantTypes,
              scopes,
              redirect_uris: redirectUris,
              metadata,
              enabled,
              created_at: createdAt,
              updated_at: updatedAt,
            })
            return { success: true, meta: { changes: 1 } }
          }
          // Handle UPDATE for rotate secret
          if (
            sql.includes("UPDATE oauth_clients SET") &&
            sql.includes("previous_secret_hash")
          ) {
            const clientId = params[params.length - 2]
            const tenantId = params[params.length - 1]
            const client = mockClients.get(clientId)
            if (client && client.tenant_id === tenantId) {
              // Update for rotation: new_hash, previous_hash, previous_expires, rotated_at, updated_at
              client.client_secret_hash = params[0]
              client.previous_secret_hash = params[1]
              client.previous_secret_expires_at = params[2]
              client.rotated_at = params[3]
              client.updated_at = params[4]
            }
            return { success: true, meta: { changes: 1 } }
          }
          // Handle generic UPDATE
          if (sql.includes("UPDATE oauth_clients SET")) {
            // Parse SET clause to update fields
            const clientId = params[params.length - 2]
            const tenantId = params[params.length - 1]
            const client = mockClients.get(clientId)
            if (client && client.tenant_id === tenantId) {
              // Simple update - params order: updated_at, [field values...], clientId, tenantId
              // For name update: updated_at=params[0], name=params[1]
              if (sql.includes("name = ?")) {
                const nameIdx = sql.indexOf("name = ?")
                const setClauseStart = sql.indexOf("SET ") + 4
                const setClausePart = sql.substring(
                  setClauseStart,
                  sql.indexOf(" WHERE"),
                )
                const clauses = setClausePart.split(", ")
                clauses.forEach((clause, idx) => {
                  if (clause.includes("name")) client.name = params[idx]
                  if (clause.includes("updated_at"))
                    client.updated_at = params[idx]
                  if (clause.includes("enabled")) client.enabled = params[idx]
                  if (clause.includes("grant_types"))
                    client.grant_types = params[idx]
                  if (clause.includes("scopes")) client.scopes = params[idx]
                  if (clause.includes("redirect_uris"))
                    client.redirect_uris = params[idx]
                  if (clause.includes("metadata")) client.metadata = params[idx]
                })
              }
            }
            return { success: true, meta: { changes: 1 } }
          }
          // Handle DELETE
          if (sql.includes("DELETE FROM oauth_clients")) {
            const clientId = params[params.length - 2]
            mockClients.delete(clientId)
            return { success: true, meta: { changes: 1 } }
          }
          return { success: true, meta: { changes: 0 } }
        }),
        first: mock(async () => {
          // Handle SELECT by id only (for getClientById)
          if (sql === "SELECT * FROM oauth_clients WHERE id = ?") {
            const clientId = params[0]
            return mockClients.get(clientId) || null
          }
          // Handle SELECT by id and tenant (for getClient)
          if (
            sql.includes(
              "SELECT * FROM oauth_clients WHERE id = ? AND tenant_id = ?",
            )
          ) {
            const [clientId, tenantId] = params
            const client = mockClients.get(clientId)
            if (client && client.tenant_id === tenantId) {
              return client
            }
            return null
          }
          // Handle name conflict check
          if (
            sql.includes(
              "SELECT id FROM oauth_clients WHERE tenant_id = ? AND name = ?",
            )
          ) {
            const [tenantId, name] = params
            for (const [, client] of mockClients) {
              if (client.tenant_id === tenantId && client.name === name) {
                return { id: client.id }
              }
            }
            return null
          }
          // Handle name conflict check for update (with id != ?)
          if (
            sql.includes(
              "SELECT id FROM oauth_clients WHERE tenant_id = ? AND name = ? AND id != ?",
            )
          ) {
            const [tenantId, name, excludeId] = params
            for (const [, client] of mockClients) {
              if (
                client.tenant_id === tenantId &&
                client.name === name &&
                client.id !== excludeId
              ) {
                return { id: client.id }
              }
            }
            return null
          }
          return null
        }),
        all: mock(async () => {
          if (sql.includes("SELECT * FROM oauth_clients WHERE tenant_id = ?")) {
            const tenantId = params[0]
            const results = Array.from(mockClients.values()).filter(
              (c) => c.tenant_id === tenantId,
            )
            return { results }
          }
          return { results: [] }
        }),
      }),
    }),
    _mockClients: mockClients,
  }

  return mockDb
}

describe("ClientD1Adapter", () => {
  let adapter: ClientD1Adapter
  let mockDb: ReturnType<typeof createMockD1>

  beforeEach(() => {
    mockDb = createMockD1()
    adapter = new ClientD1Adapter(mockDb as any)
  })

  describe("createClient", () => {
    test("creates a new client with generated id and secret", async () => {
      const result = await adapter.createClient("tenant-1", {
        name: "Test App",
        grant_types: ["authorization_code"],
        scopes: ["read", "write"],
        redirect_uris: ["https://example.com/callback"],
      })

      expect(result.client.name).toBe("Test App")
      expect(result.client.id).toBeDefined()
      expect(result.secret).toBeDefined()
      expect(result.secret.length).toBeGreaterThan(20)
    })

    test("throws ClientNameConflictError for duplicate name", async () => {
      await adapter.createClient("tenant-1", { name: "My App" })

      await expect(
        adapter.createClient("tenant-1", { name: "My App" }),
      ).rejects.toThrow(ClientNameConflictError)
    })

    test("allows same name in different tenants", async () => {
      await adapter.createClient("tenant-1", { name: "My App" })
      const result = await adapter.createClient("tenant-2", { name: "My App" })

      expect(result.client.name).toBe("My App")
      expect(result.client.tenant_id).toBe("tenant-2")
    })

    test("validates client name", async () => {
      await expect(
        adapter.createClient("tenant-1", { name: "" }),
      ).rejects.toThrow()
    })

    test("validates grant types", async () => {
      await expect(
        adapter.createClient("tenant-1", {
          name: "Test",
          grant_types: ["invalid_grant" as any],
        }),
      ).rejects.toThrow()
    })
  })

  describe("getClient", () => {
    test("returns client by id and tenant", async () => {
      const created = await adapter.createClient("tenant-1", {
        name: "Test App",
      })
      const client = await adapter.getClient(created.client.id, "tenant-1")

      expect(client).not.toBeNull()
      expect(client!.name).toBe("Test App")
    })

    test("returns null for non-existent client", async () => {
      const client = await adapter.getClient("non-existent", "tenant-1")
      expect(client).toBeNull()
    })

    test("returns null for wrong tenant", async () => {
      const created = await adapter.createClient("tenant-1", {
        name: "Test App",
      })
      const client = await adapter.getClient(created.client.id, "tenant-2")

      expect(client).toBeNull()
    })
  })

  describe("getClientById", () => {
    test("returns client by id only (cross-tenant)", async () => {
      const created = await adapter.createClient("tenant-1", {
        name: "Test App",
      })
      const client = await adapter.getClientById(created.client.id)

      expect(client).not.toBeNull()
      expect(client!.name).toBe("Test App")
    })

    test("returns null for non-existent client", async () => {
      const client = await adapter.getClientById("non-existent")
      expect(client).toBeNull()
    })
  })

  describe("updateClient", () => {
    test("updates client name", async () => {
      const created = await adapter.createClient("tenant-1", {
        name: "Old Name",
      })
      const updated = await adapter.updateClient(
        created.client.id,
        "tenant-1",
        {
          name: "New Name",
        },
      )

      expect(updated.name).toBe("New Name")
    })

    test("throws ClientNotFoundError for non-existent client", async () => {
      await expect(
        adapter.updateClient("non-existent", "tenant-1", { name: "New" }),
      ).rejects.toThrow(ClientNotFoundError)
    })

    test("throws ClientNameConflictError when updating to existing name", async () => {
      await adapter.createClient("tenant-1", { name: "Existing App" })
      const created = await adapter.createClient("tenant-1", { name: "My App" })

      await expect(
        adapter.updateClient(created.client.id, "tenant-1", {
          name: "Existing App",
        }),
      ).rejects.toThrow(ClientNameConflictError)
    })
  })

  describe("deleteClient", () => {
    test("deletes existing client", async () => {
      const created = await adapter.createClient("tenant-1", { name: "Test" })
      await adapter.deleteClient(created.client.id, "tenant-1")

      const client = await adapter.getClient(created.client.id, "tenant-1")
      expect(client).toBeNull()
    })

    test("throws ClientNotFoundError for non-existent client", async () => {
      await expect(
        adapter.deleteClient("non-existent", "tenant-1"),
      ).rejects.toThrow(ClientNotFoundError)
    })
  })

  describe("listClients", () => {
    test("returns clients for tenant", async () => {
      await adapter.createClient("tenant-1", { name: "App 1" })
      await adapter.createClient("tenant-1", { name: "App 2" })
      await adapter.createClient("tenant-2", { name: "Other App" })

      const result = await adapter.listClients("tenant-1")

      expect(result.clients.length).toBe(2)
    })

    test("returns empty array for tenant with no clients", async () => {
      const result = await adapter.listClients("empty-tenant")
      expect(result.clients).toEqual([])
      expect(result.has_more).toBe(false)
    })
  })

  describe("rotateSecret", () => {
    test("generates new secret and preserves old", async () => {
      const created = await adapter.createClient("tenant-1", { name: "Test" })
      const oldSecret = created.secret

      const rotated = await adapter.rotateSecret(created.client.id, "tenant-1")

      expect(rotated.secret).not.toBe(oldSecret)
      expect(rotated.client.rotated_at).toBeDefined()
    })

    test("throws ClientNotFoundError for non-existent client", async () => {
      await expect(
        adapter.rotateSecret("non-existent", "tenant-1"),
      ).rejects.toThrow(ClientNotFoundError)
    })
  })

  describe("verifyCredentials", () => {
    test("returns client for valid credentials", async () => {
      const created = await adapter.createClient("tenant-1", { name: "Test" })
      const client = await adapter.verifyCredentials(
        created.client.id,
        created.secret,
      )

      expect(client).not.toBeNull()
      expect(client!.id).toBe(created.client.id)
    })

    test("returns null for invalid secret", async () => {
      const created = await adapter.createClient("tenant-1", { name: "Test" })
      const client = await adapter.verifyCredentials(
        created.client.id,
        "wrong-secret",
      )

      expect(client).toBeNull()
    })

    test("returns null for non-existent client", async () => {
      const client = await adapter.verifyCredentials(
        "non-existent",
        "any-secret",
      )
      expect(client).toBeNull()
    })
  })

  describe("Circuit Breaker", () => {
    test("starts in closed state", () => {
      const stats = adapter.getCircuitBreakerStats()
      expect(stats.state).toBe(CircuitState.CLOSED)
    })

    test("can be manually reset", () => {
      adapter.resetCircuitBreaker()
      const stats = adapter.getCircuitBreakerStats()
      expect(stats.state).toBe(CircuitState.CLOSED)
    })

    test("tracks request statistics", async () => {
      await adapter.createClient("tenant-1", { name: "Test" })
      const stats = adapter.getCircuitBreakerStats()

      expect(stats.totalRequests).toBeGreaterThan(0)
    })
  })
})

describe("ClientD1Adapter with custom config", () => {
  test("accepts custom retry config", () => {
    const mockDb = createMockD1()
    const adapter = new ClientD1Adapter(mockDb as any, {
      retryConfig: {
        maxAttempts: 5,
        initialDelayMs: 50,
      },
    })

    expect(adapter).toBeDefined()
  })

  test("accepts custom circuit breaker config", () => {
    const mockDb = createMockD1()
    const adapter = new ClientD1Adapter(mockDb as any, {
      circuitBreakerConfig: {
        failureThreshold: 30,
        minimumRequests: 10,
      },
    })

    expect(adapter).toBeDefined()
  })
})
