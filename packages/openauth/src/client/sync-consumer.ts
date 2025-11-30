/**
 * Queue Consumer for Multi-Region Client Sync
 *
 * Processes sync messages from the queue and replicates client changes
 * across all regional D1 instances.
 *
 * Deploy this as a separate queue consumer worker or add to your main worker.
 *
 * @packageDocumentation
 */

import type {
  D1Database,
  MessageBatch,
  Message,
} from "@cloudflare/workers-types"
import {
  applySyncMessage,
  type ClientSyncMessage,
} from "./multi-region-d1-adapter.js"

export interface SyncConsumerEnv {
  // All regional D1 databases
  DB_US?: D1Database
  DB_EU?: D1Database
  DB_APAC?: D1Database

  // Add more regions as needed
  [key: string]: D1Database | undefined
}

/**
 * Process a batch of client sync messages
 * Replicates changes to all configured regional D1 instances
 */
export async function processClientSyncBatch(
  batch: MessageBatch<ClientSyncMessage>,
  env: SyncConsumerEnv,
  tableName = "oauth_clients",
): Promise<void> {
  // Collect all regional databases
  const databases: { name: string; db: D1Database }[] = []

  if (env.DB_US) databases.push({ name: "US", db: env.DB_US })
  if (env.DB_EU) databases.push({ name: "EU", db: env.DB_EU })
  if (env.DB_APAC) databases.push({ name: "APAC", db: env.DB_APAC })

  if (databases.length === 0) {
    console.warn("No regional databases configured for sync")
    return
  }

  console.log(
    `Processing ${batch.messages.length} sync messages across ${databases.length} regions`,
  )

  // Process each message
  for (const message of batch.messages) {
    try {
      const syncData = message.body

      console.log(
        `Syncing ${syncData.operation} for client ${syncData.client_id} (timestamp: ${syncData.timestamp})`,
      )

      // Apply to all regions in parallel
      const results = await Promise.allSettled(
        databases.map(async ({ name, db }) => {
          try {
            await applySyncMessage(db, syncData, tableName)
            console.log(
              `✓ Synced to ${name}: ${syncData.operation} ${syncData.client_id}`,
            )
          } catch (error) {
            console.error(
              `✗ Failed to sync to ${name}: ${syncData.operation} ${syncData.client_id}`,
              error,
            )
            throw error
          }
        }),
      )

      // Check for failures
      const failures = results.filter((r) => r.status === "rejected")
      if (failures.length > 0) {
        console.error(
          `${failures.length}/${databases.length} regions failed to sync ${syncData.client_id}`,
        )
        // Message will be retried automatically by queue
        message.retry()
      } else {
        // All regions synced successfully
        message.ack()
      }
    } catch (error) {
      console.error("Failed to process sync message:", error)
      message.retry()
    }
  }
}

/**
 * Example queue consumer worker
 *
 * Add to wrangler.toml:
 * ```toml
 * [[queues.consumers]]
 * queue = "client-sync"
 * max_batch_size = 10
 * max_batch_timeout = 5
 * max_retries = 3
 * dead_letter_queue = "client-sync-dlq"
 * ```
 */
export default {
  async queue(
    batch: MessageBatch<ClientSyncMessage>,
    env: SyncConsumerEnv,
  ): Promise<void> {
    await processClientSyncBatch(batch, env)
  },
}
