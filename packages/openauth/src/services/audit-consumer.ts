/**
 * Audit Consumer for OpenAuth
 *
 * Helper functions for queue consumer workers that process audit events
 * and write them to D1 in batches.
 *
 * Usage:
 * ```typescript
 * import { handleAuditBatch } from 'openauth/services/audit-consumer'
 *
 * export default {
 *   async queue(batch: MessageBatch<AuditEventMessage>, env: Env) {
 *     await handleAuditBatch(batch, env.AUDIT_DB)
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

import type { D1Database } from "@cloudflare/workers-types"
import { SQLValidator } from "../security/sql-validator.js"
import type { AuditEventMessage, TokenUsageEvent } from "./audit.js"

/**
 * Batch insert audit events into D1 database
 *
 * Uses D1 batch API for performance - all events are inserted in a single transaction.
 * This is much faster than individual inserts.
 *
 * @param db - D1 database instance
 * @param events - Array of audit events to insert
 * @param tableName - Table name (default: "token_usage")
 * @throws Error if database write fails
 */
export async function insertAuditEvents(
  db: D1Database,
  events: TokenUsageEvent[],
  tableName = "token_usage",
): Promise<void> {
  if (events.length === 0) {
    return
  }

  // SECURITY: Validate table name to prevent SQL injection
  const validatedTable = SQLValidator.validateTableName(tableName)

  // Create prepared statement for batch insert
  const stmt = db.prepare(
    `
    INSERT INTO ${validatedTable}
    (token_id, subject, event_type, client_id, ip_address, user_agent, timestamp, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  )

  // Bind values for each event
  const batch = events.map((event) =>
    stmt.bind(
      event.token_id,
      event.subject,
      event.event_type,
      event.client_id || null,
      event.ip_address || null,
      event.user_agent || null,
      event.timestamp,
      event.metadata ? JSON.stringify(event.metadata) : null,
    ),
  )

  // Execute batch insert (single transaction)
  await db.batch(batch)
}

/**
 * Handle a batch of audit event messages from Cloudflare Queue
 *
 * Processes messages, writes to D1, and handles retries for failed messages.
 *
 * Message handling:
 * - Success: All messages acknowledged (ack)
 * - Partial failure: Failed messages retried with exponential backoff
 * - Max retries (3): Failed messages acknowledged to prevent infinite retries
 *
 * @param batch - Message batch from Cloudflare Queue
 * @param db - D1 database instance
 * @param tableName - Table name (default: "token_usage")
 */
export async function handleAuditBatch(
  batch: MessageBatch<AuditEventMessage>,
  db: D1Database,
  tableName = "token_usage",
): Promise<void> {
  // Extract events from messages
  const events = batch.messages.map((msg) => msg.body.event)

  try {
    // Batch insert all events
    await insertAuditEvents(db, events, tableName)

    // Acknowledge all messages on success
    batch.messages.forEach((msg) => msg.ack())
  } catch (error) {
    // On failure, retry messages with exponential backoff
    console.error("AuditConsumer: Failed to insert audit events:", error)

    batch.messages.forEach((msg) => {
      // Check if message has retry metadata (added by queue)
      const retryCount = (msg.body as any).retry_count || 0

      if (retryCount < 3) {
        // Retry with exponential backoff (5s, 10s, 20s)
        const delaySeconds = Math.pow(2, retryCount) * 5
        msg.retry({ delaySeconds })
      } else {
        // Max retries reached - acknowledge to prevent infinite loop
        // In production, you might want to send to dead letter queue or alert
        console.error(
          `AuditConsumer: Max retries (3) reached for event, acknowledging to prevent infinite loop:`,
          msg.body,
        )
        msg.ack()
      }
    })
  }
}

/**
 * MessageBatch type for Cloudflare Queue consumers
 * Included here for convenience and type safety
 */
export interface MessageBatch<T = unknown> {
  readonly messages: Message<T>[]
  retryAll(options?: { delaySeconds?: number }): void
  ackAll(): void
}

/**
 * Message type for Cloudflare Queue
 */
export interface Message<T = unknown> {
  readonly id: string
  readonly timestamp: Date
  readonly body: T
  ack(): void
  retry(options?: { delaySeconds?: number }): void
}
