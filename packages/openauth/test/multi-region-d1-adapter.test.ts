import { expect, test, describe, beforeEach, mock } from "bun:test"
import {
  MultiRegionD1ClientAdapter,
  applySyncMessage,
  type ClientSyncMessage,
} from "../src/client/multi-region-d1-adapter.js"
import type { OAuthClient } from "../src/client/d1-adapter.js"

// Mock D1 database
const createMockD1 = () => ({
  prepare: (sql: string) => ({
    bind: (...params: any[]) => ({
      run: mock(() => Promise.resolve({ success: true, meta: { changes: 1 } })),
      first: mock(() => Promise.resolve(null)),
      all: mock(() => Promise.resolve({ results: [] })),
    }),
  }),
})

// Mock Queue
const createMockQueue = () => ({
  send: mock(() => Promise.resolve()),
})

describe("MultiRegionD1ClientAdapter", () => {
  let adapter: MultiRegionD1ClientAdapter
  let mockDb: any
  let mockQueue: any

  beforeEach(() => {
    mockDb = createMockD1()
    mockQueue = createMockQueue()
    adapter = new MultiRegionD1ClientAdapter({
      localDb: mockDb,
      syncQueue: mockQueue,
    })
  })

  describe("getClient", () => {
    test("reads from local D1 only", async () => {
      const clientId = "test-client"
      const mockClient: OAuthClient = {
        client_id: clientId,
        client_secret_hash: "salt:hash",
        client_name: "Test Client",
        redirect_uris: JSON.stringify(["http://localhost:3000/callback"]),
        grant_types: JSON.stringify(["authorization_code"]),
        scopes: JSON.stringify(["openid"]),
        created_at: Date.now(),
      } as any

      // Mock D1 to return client
      mockDb.prepare = mock(() => ({
        bind: mock(() => ({
          first: mock(() => Promise.resolve(mockClient)),
        })),
      }))

      const result = await adapter.getClient(clientId)

      expect(result).toBeTruthy()
      expect(result?.client_id).toBe(clientId)
      expect(mockDb.prepare).toHaveBeenCalled()

      // Verify JSON fields are parsed
      expect(Array.isArray(result?.redirect_uris)).toBe(true)
      expect(Array.isArray(result?.grant_types)).toBe(true)
      expect(Array.isArray(result?.scopes)).toBe(true)
    })

    test("returns null for non-existent client", async () => {
      mockDb.prepare = mock(() => ({
        bind: mock(() => ({
          first: mock(() => Promise.resolve(null)),
        })),
      }))

      const result = await adapter.getClient("non-existent")

      expect(result).toBeNull()
    })

    test("handles circuit breaker errors gracefully", async () => {
      // Force circuit breaker to open by causing failures
      mockDb.prepare = mock(() => ({
        bind: mock(() => ({
          first: mock(() => Promise.reject(new Error("D1 unavailable"))),
        })),
      }))

      // First call will fail and increment failure count
      const result1 = await adapter.getClient("test-1")
      expect(result1).toBeNull()

      // After enough failures, should return null without calling D1
      const result2 = await adapter.getClient("test-2")
      expect(result2).toBeNull()
    })
  })

  describe("createClient", () => {
    test("writes to local D1 and queues sync", async () => {
      const client: Omit<OAuthClient, "created_at" | "updated_at"> = {
        client_id: "new-client",
        client_secret_hash: "salt:hash",
        client_name: "New Client",
        redirect_uris: ["http://localhost:3000/callback"],
        grant_types: ["authorization_code"],
        scopes: ["openid"],
      }

      mockDb.prepare = mock(() => ({
        bind: mock(() => ({
          run: mock(() =>
            Promise.resolve({ success: true, meta: { changes: 1 } }),
          ),
        })),
      }))

      const result = await adapter.createClient(client)

      // Verify local D1 write
      expect(mockDb.prepare).toHaveBeenCalled()
      expect(result.client_id).toBe(client.client_id)
      expect(result.created_at).toBeTruthy()
      expect(result.updated_at).toBeTruthy()

      // Verify sync queue message
      expect(mockQueue.send).toHaveBeenCalled()
      const queueMessage = mockQueue.send.mock.calls[0][0]
      expect(queueMessage.operation).toBe("create")
      expect(queueMessage.client_id).toBe(client.client_id)
      expect(queueMessage.data).toBeTruthy()
      expect(queueMessage.timestamp).toBeTruthy()
    })

    test("succeeds even if queue sync fails", async () => {
      const client: Omit<OAuthClient, "created_at" | "updated_at"> = {
        client_id: "new-client",
        client_secret_hash: "salt:hash",
        client_name: "New Client",
        redirect_uris: ["http://localhost:3000/callback"],
        grant_types: ["authorization_code"],
        scopes: ["openid"],
      }

      mockDb.prepare = mock(() => ({
        bind: mock(() => ({
          run: mock(() =>
            Promise.resolve({ success: true, meta: { changes: 1 } }),
          ),
        })),
      }))

      // Queue fails but should not throw
      mockQueue.send = mock(() => Promise.reject(new Error("Queue error")))

      const result = await adapter.createClient(client)

      expect(result.client_id).toBe(client.client_id)
      expect(mockDb.prepare).toHaveBeenCalled()
    })
  })

  describe("updateClient", () => {
    test("updates local D1 and queues sync", async () => {
      const clientId = "test-client"
      const updates = {
        client_name: "Updated Name",
        redirect_uris: ["http://localhost:4000/callback"],
      }

      mockDb.prepare = mock(() => ({
        bind: mock(() => ({
          run: mock(() =>
            Promise.resolve({ success: true, meta: { changes: 1 } }),
          ),
          first: mock(() =>
            Promise.resolve({
              client_id: clientId,
              client_secret_hash: "salt:hash",
              client_name: updates.client_name,
              redirect_uris: JSON.stringify(updates.redirect_uris),
              grant_types: JSON.stringify(["authorization_code"]),
              scopes: JSON.stringify(["openid"]),
              created_at: Date.now(),
            }),
          ),
        })),
      }))

      const result = await adapter.updateClient(clientId, updates)

      expect(mockDb.prepare).toHaveBeenCalled()
      expect(result?.client_name).toBe(updates.client_name)

      // Verify sync queue message
      expect(mockQueue.send).toHaveBeenCalled()
      const queueMessage = mockQueue.send.mock.calls[0][0]
      expect(queueMessage.operation).toBe("update")
      expect(queueMessage.client_id).toBe(clientId)
      expect(queueMessage.updates).toEqual(updates)
    })

    test("returns null if no fields to update", async () => {
      const clientId = "test-client"
      const updates = {}

      mockDb.prepare = mock(() => ({
        bind: mock(() => ({
          first: mock(() =>
            Promise.resolve({
              client_id: clientId,
              client_secret_hash: "salt:hash",
              client_name: "Test",
              redirect_uris: JSON.stringify(["http://localhost:3000"]),
              grant_types: JSON.stringify(["authorization_code"]),
              scopes: JSON.stringify(["openid"]),
              created_at: Date.now(),
            }),
          ),
        })),
      }))

      const result = await adapter.updateClient(clientId, updates)

      // Should call getClient and return existing client
      expect(result).toBeTruthy()
      expect(result?.client_id).toBe(clientId)
    })
  })

  describe("deleteClient", () => {
    test("deletes from local D1 and queues sync", async () => {
      const clientId = "test-client"

      mockDb.prepare = mock(() => ({
        bind: mock(() => ({
          run: mock(() =>
            Promise.resolve({ success: true, meta: { changes: 1 } }),
          ),
        })),
      }))

      const result = await adapter.deleteClient(clientId)

      expect(result).toBe(true)
      expect(mockDb.prepare).toHaveBeenCalled()

      // Verify sync queue message
      expect(mockQueue.send).toHaveBeenCalled()
      const queueMessage = mockQueue.send.mock.calls[0][0]
      expect(queueMessage.operation).toBe("delete")
      expect(queueMessage.client_id).toBe(clientId)
    })

    test("returns false if client not found", async () => {
      mockDb.prepare = mock(() => ({
        bind: mock(() => ({
          run: mock(() =>
            Promise.resolve({ success: true, meta: { changes: 0 } }),
          ),
        })),
      }))

      const result = await adapter.deleteClient("non-existent")

      expect(result).toBe(false)
    })
  })

  describe("listClients", () => {
    test("lists clients with pagination", async () => {
      const mockClients = [
        {
          client_id: "client-1",
          client_secret_hash: "salt:hash1",
          client_name: "Client 1",
          redirect_uris: JSON.stringify(["http://localhost:3001"]),
          grant_types: JSON.stringify(["authorization_code"]),
          scopes: JSON.stringify(["openid"]),
          created_at: Date.now(),
        },
        {
          client_id: "client-2",
          client_secret_hash: "salt:hash2",
          client_name: "Client 2",
          redirect_uris: JSON.stringify(["http://localhost:3002"]),
          grant_types: JSON.stringify(["authorization_code"]),
          scopes: JSON.stringify(["openid"]),
          created_at: Date.now(),
        },
      ]

      mockDb.prepare = mock(() => ({
        bind: mock(() => ({
          all: mock(() => Promise.resolve({ results: mockClients })),
        })),
      }))

      const result = await adapter.listClients({ limit: 10, offset: 0 })

      expect(result).toHaveLength(2)
      expect(Array.isArray(result[0].redirect_uris)).toBe(true)
      expect(Array.isArray(result[0].grant_types)).toBe(true)
    })
  })

  describe("circuit breaker", () => {
    test("provides stats", () => {
      const stats = adapter.getCircuitBreakerStats()

      expect(stats).toBeTruthy()
      expect(stats.state).toBeDefined()
      expect(stats.totalRequests).toBeDefined()
      expect(stats.failedRequests).toBeDefined()
      expect(stats.failureRate).toBeDefined()
      expect(stats.cooldownRemaining).toBeDefined()
    })

    test("can be reset", () => {
      adapter.resetCircuitBreaker()
      const stats = adapter.getCircuitBreakerStats()

      expect(stats.state).toBe("CLOSED")
      expect(stats.totalRequests).toBe(0)
      expect(stats.failedRequests).toBe(0)
    })
  })
})

describe("applySyncMessage", () => {
  let mockDb: any

  beforeEach(() => {
    mockDb = createMockD1()
  })

  test("applies CREATE operation with INSERT OR IGNORE", async () => {
    const message: ClientSyncMessage = {
      operation: "create",
      client_id: "new-client",
      data: {
        client_id: "new-client",
        client_secret_hash: "salt:hash",
        client_name: "New Client",
        redirect_uris: ["http://localhost:3000"],
        grant_types: ["authorization_code"],
        scopes: ["openid"],
      },
      timestamp: Date.now(),
    }

    mockDb.prepare = mock(() => ({
      bind: mock(() => ({
        run: mock(() =>
          Promise.resolve({ success: true, meta: { changes: 1 } }),
        ),
      })),
    }))

    await applySyncMessage(mockDb, message)

    expect(mockDb.prepare).toHaveBeenCalled()
    const sql = mockDb.prepare.mock.calls[0][0]
    // Uses INSERT OR IGNORE - only inserts if not exists
    expect(sql).toContain("INSERT OR IGNORE")
  })

  test("applies UPDATE operation with timestamp check", async () => {
    const message: ClientSyncMessage = {
      operation: "update",
      client_id: "existing-client",
      updates: {
        client_name: "Updated Name",
      },
      timestamp: Date.now(),
    }

    mockDb.prepare = mock(() => ({
      bind: mock(() => ({
        run: mock(() =>
          Promise.resolve({ success: true, meta: { changes: 1 } }),
        ),
      })),
    }))

    await applySyncMessage(mockDb, message)

    expect(mockDb.prepare).toHaveBeenCalled()
    const sql = mockDb.prepare.mock.calls[0][0]
    expect(sql).toContain("UPDATE")
    expect(sql).toContain("updated_at < ?")
  })

  test("applies DELETE operation with timestamp check", async () => {
    const message: ClientSyncMessage = {
      operation: "delete",
      client_id: "client-to-delete",
      timestamp: Date.now(),
    }

    mockDb.prepare = mock(() => ({
      bind: mock(() => ({
        run: mock(() =>
          Promise.resolve({ success: true, meta: { changes: 1 } }),
        ),
      })),
    }))

    await applySyncMessage(mockDb, message)

    expect(mockDb.prepare).toHaveBeenCalled()
    const sql = mockDb.prepare.mock.calls[0][0]
    expect(sql).toContain("DELETE")
    expect(sql).toContain("updated_at <= ?")
  })

  test("throws error for unknown operation", async () => {
    const message = {
      operation: "unknown",
      client_id: "test",
      timestamp: Date.now(),
    } as any

    await expect(applySyncMessage(mockDb, message)).rejects.toThrow(
      "Unknown sync operation",
    )
  })

  test("throws error for CREATE without data", async () => {
    const message: ClientSyncMessage = {
      operation: "create",
      client_id: "test",
      timestamp: Date.now(),
    }

    await expect(applySyncMessage(mockDb, message)).rejects.toThrow(
      "Create operation requires data",
    )
  })

  test("throws error for UPDATE without updates", async () => {
    const message: ClientSyncMessage = {
      operation: "update",
      client_id: "test",
      timestamp: Date.now(),
    }

    await expect(applySyncMessage(mockDb, message)).rejects.toThrow(
      "Update operation requires updates",
    )
  })
})
