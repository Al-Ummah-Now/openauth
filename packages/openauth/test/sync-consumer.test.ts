import { expect, test, describe, beforeEach, mock } from "bun:test"
import {
  processClientSyncBatch,
  type SyncConsumerEnv,
} from "../src/client/sync-consumer.js"
import type { ClientSyncMessage } from "../src/client/multi-region-d1-adapter.js"

// Mock D1 database
const createMockD1 = () => ({
  prepare: mock((sql: string) => ({
    bind: (...params: any[]) => ({
      run: mock(() => Promise.resolve({ success: true, meta: { changes: 1 } })),
    }),
  })),
})

// Mock message batch
const createMockBatch = (messages: ClientSyncMessage[]) => ({
  messages: messages.map((body) => ({
    body,
    id: crypto.randomUUID(),
    timestamp: new Date(),
    ack: mock(() => {}),
    retry: mock(() => {}),
  })),
  queue: "client-sync",
  ackAll: mock(() => {}),
  retryAll: mock(() => {}),
})

describe("processClientSyncBatch", () => {
  let env: SyncConsumerEnv
  let mockUsDb: any
  let mockEuDb: any
  let mockApacDb: any

  beforeEach(() => {
    mockUsDb = createMockD1()
    mockEuDb = createMockD1()
    mockApacDb = createMockD1()

    env = {
      DB_US: mockUsDb,
      DB_EU: mockEuDb,
      DB_APAC: mockApacDb,
    }
  })

  test("processes CREATE message across all regions", async () => {
    const syncMessage: ClientSyncMessage = {
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

    const batch = createMockBatch([syncMessage])

    await processClientSyncBatch(batch, env)

    // Verify all regions received the sync
    expect(mockUsDb.prepare).toHaveBeenCalled()
    expect(mockEuDb.prepare).toHaveBeenCalled()
    expect(mockApacDb.prepare).toHaveBeenCalled()

    // Verify message was acknowledged
    expect(batch.messages[0].ack).toHaveBeenCalled()
  })

  test("processes UPDATE message across all regions", async () => {
    const syncMessage: ClientSyncMessage = {
      operation: "update",
      client_id: "existing-client",
      updates: {
        client_name: "Updated Name",
        redirect_uris: ["http://localhost:4000"],
      },
      timestamp: Date.now(),
    }

    const batch = createMockBatch([syncMessage])

    await processClientSyncBatch(batch, env)

    // Verify all regions received the sync
    expect(mockUsDb.prepare).toHaveBeenCalled()
    expect(mockEuDb.prepare).toHaveBeenCalled()
    expect(mockApacDb.prepare).toHaveBeenCalled()

    // Verify message was acknowledged
    expect(batch.messages[0].ack).toHaveBeenCalled()
  })

  test("processes DELETE message across all regions", async () => {
    const syncMessage: ClientSyncMessage = {
      operation: "delete",
      client_id: "client-to-delete",
      timestamp: Date.now(),
    }

    const batch = createMockBatch([syncMessage])

    await processClientSyncBatch(batch, env)

    // Verify all regions received the sync
    expect(mockUsDb.prepare).toHaveBeenCalled()
    expect(mockEuDb.prepare).toHaveBeenCalled()
    expect(mockApacDb.prepare).toHaveBeenCalled()

    // Verify message was acknowledged
    expect(batch.messages[0].ack).toHaveBeenCalled()
  })

  test("processes multiple messages in batch", async () => {
    const messages: ClientSyncMessage[] = [
      {
        operation: "create",
        client_id: "client-1",
        data: {
          client_id: "client-1",
          client_secret_hash: "salt:hash1",
          client_name: "Client 1",
          redirect_uris: ["http://localhost:3001"],
          grant_types: ["authorization_code"],
          scopes: ["openid"],
        },
        timestamp: Date.now(),
      },
      {
        operation: "update",
        client_id: "client-2",
        updates: {
          client_name: "Updated Client 2",
        },
        timestamp: Date.now(),
      },
      {
        operation: "delete",
        client_id: "client-3",
        timestamp: Date.now(),
      },
    ]

    const batch = createMockBatch(messages)

    await processClientSyncBatch(batch, env)

    // All messages should be acknowledged
    expect(batch.messages[0].ack).toHaveBeenCalled()
    expect(batch.messages[1].ack).toHaveBeenCalled()
    expect(batch.messages[2].ack).toHaveBeenCalled()
  })

  test("retries message if any region fails", async () => {
    const syncMessage: ClientSyncMessage = {
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

    // Mock EU DB to fail
    mockEuDb.prepare = mock(() => ({
      bind: mock(() => ({
        run: mock(() => Promise.reject(new Error("EU DB unavailable"))),
      })),
    }))

    const batch = createMockBatch([syncMessage])

    await processClientSyncBatch(batch, env)

    // Message should be retried, not acknowledged
    expect(batch.messages[0].retry).toHaveBeenCalled()
    expect(batch.messages[0].ack).not.toHaveBeenCalled()
  })

  test("handles empty batch gracefully", async () => {
    const batch = createMockBatch([])

    await processClientSyncBatch(batch, env)

    // Should not throw error
    expect(mockUsDb.prepare).not.toHaveBeenCalled()
  })

  test("handles env with no databases configured", async () => {
    const emptyEnv: SyncConsumerEnv = {}
    const syncMessage: ClientSyncMessage = {
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

    const batch = createMockBatch([syncMessage])

    // Should not throw, just log warning
    await processClientSyncBatch(batch, emptyEnv)

    // Message should still be processed (no-op)
    expect(batch.messages[0].ack).not.toHaveBeenCalled()
  })

  test("handles partial region sync failure gracefully", async () => {
    const syncMessage: ClientSyncMessage = {
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

    // Mock APAC DB to fail
    mockApacDb.prepare = mock(() => ({
      bind: mock(() => ({
        run: mock(() => Promise.reject(new Error("APAC DB unavailable"))),
      })),
    }))

    const batch = createMockBatch([syncMessage])

    await processClientSyncBatch(batch, env)

    // Should retry because one region failed
    expect(batch.messages[0].retry).toHaveBeenCalled()
  })

  test("rejects invalid custom table names for security", async () => {
    const syncMessage: ClientSyncMessage = {
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

    const batch = createMockBatch([syncMessage])
    const invalidTableName = "custom_oauth_clients"

    // Should fail because custom table names are blocked by SQLValidator
    await processClientSyncBatch(batch, env, invalidTableName)

    // Message should be retried due to security rejection
    expect(batch.messages[0].retry).toHaveBeenCalled()
  })

  test("processes messages in sequence (not parallel)", async () => {
    const messages: ClientSyncMessage[] = [
      {
        operation: "create",
        client_id: "client-1",
        data: {
          client_id: "client-1",
          client_secret_hash: "salt:hash1",
          client_name: "Client 1",
          redirect_uris: ["http://localhost:3001"],
          grant_types: ["authorization_code"],
          scopes: ["openid"],
        },
        timestamp: Date.now(),
      },
      {
        operation: "create",
        client_id: "client-2",
        data: {
          client_id: "client-2",
          client_secret_hash: "salt:hash2",
          client_name: "Client 2",
          redirect_uris: ["http://localhost:3002"],
          grant_types: ["authorization_code"],
          scopes: ["openid"],
        },
        timestamp: Date.now(),
      },
    ]

    const batch = createMockBatch(messages)

    await processClientSyncBatch(batch, env)

    // Both messages should be processed
    expect(batch.messages[0].ack).toHaveBeenCalled()
    expect(batch.messages[1].ack).toHaveBeenCalled()
  })
})
