/**
 * Audit Service for OpenAuth
 *
 * Provides async, non-blocking audit logging for token events using Cloudflare D1.
 * All D1 writes are fire-and-forget to avoid blocking OAuth flows.
 *
 * ARCHITECTURE:
 * - Default: Direct D1 writes (simple, synchronous)
 * - Optional: Queue-based writes (scalable, async with separate consumer)
 *
 * QUEUE-BASED MODE (Optional):
 * When a queue is provided, audit events are published to the queue instead of
 * written directly to D1. A separate consumer worker reads from the queue and
 * batch-writes to D1 for better performance and scalability.
 *
 * Benefits of queue-based mode:
 * - Non-blocking: Queue writes are faster than D1 writes
 * - Batch processing: Consumer can batch multiple events in single transaction
 * - Resilient: Queue handles retries and dead letter queue for failed events
 * - Scalable: Consumer auto-scales based on queue depth
 *
 * @packageDocumentation
 */

import type { D1Database, Queue } from "@cloudflare/workers-types"
import { SQLValidator } from "../security/sql-validator.js"

export type TokenEventType = "generated" | "refreshed" | "revoked" | "reused"

export interface TokenMetadata {
  [key: string]: string | number | boolean | null
}

export interface TokenUsageEvent {
  token_id: string
  subject: string
  event_type: TokenEventType
  client_id?: string
  ip_address?: string
  user_agent?: string
  timestamp: number
  metadata?: TokenMetadata
}

interface D1TokenUsageRow {
  token_id: string
  subject: string
  event_type: string
  client_id: string | null
  ip_address: string | null
  user_agent: string | null
  timestamp: number
  metadata: string | null
}

export interface AuditServiceConfig {
  database: D1Database
  tableName?: string
  /**
   * Optional: Cloudflare Queue for async audit logging
   *
   * When provided, audit events are published to the queue instead of written
   * directly to D1. A separate consumer worker is required to read from the
   * queue and write to the audit database.
   *
   * Benefits:
   * - Faster writes (queue is faster than D1)
   * - Better scalability (consumer can batch writes)
   * - Automatic retries and dead letter queue handling
   *
   * If not provided, falls back to direct D1 writes (default behavior).
   */
  queue?: Queue
}

/**
 * Message format for audit events sent to queue
 * Used by both AuditService (producer) and consumer worker
 */
export interface AuditEventMessage {
  version: 1
  event: TokenUsageEvent
  enqueued_at: number
}

/**
 * Type guard for token metadata
 */
function isTokenMetadata(value: unknown): value is TokenMetadata {
  if (typeof value !== "object" || value === null) {
    return false
  }

  for (const val of Object.values(value)) {
    const type = typeof val
    if (
      type !== "string" &&
      type !== "number" &&
      type !== "boolean" &&
      val !== null
    ) {
      return false
    }
  }

  return true
}

/**
 * Safely parse metadata JSON string
 */
function parseMetadata(raw: string | null): TokenMetadata | undefined {
  if (!raw) return undefined

  try {
    const parsed: unknown = JSON.parse(raw)
    if (isTokenMetadata(parsed)) {
      return parsed
    }
    console.warn(
      "AuditService: Invalid metadata format, expected TokenMetadata",
    )
    return undefined
  } catch (error) {
    console.error("AuditService: Failed to parse metadata JSON:", error)
    return undefined
  }
}

/**
 * Valid event types set for efficient validation
 */
const VALID_EVENT_TYPES = new Set<TokenEventType>([
  "generated",
  "refreshed",
  "revoked",
  "reused",
])

/**
 * Validate event type
 */
function isValidEventType(value: string): value is TokenEventType {
  return VALID_EVENT_TYPES.has(value as TokenEventType)
}

/**
 * Convert D1 row to TokenUsageEvent
 */
function rowToEvent(row: D1TokenUsageRow): TokenUsageEvent {
  return {
    token_id: row.token_id,
    subject: row.subject,
    event_type: isValidEventType(row.event_type) ? row.event_type : "generated",
    client_id: row.client_id || undefined,
    ip_address: row.ip_address || undefined,
    user_agent: row.user_agent || undefined,
    timestamp: row.timestamp,
    metadata: parseMetadata(row.metadata),
  }
}

export class AuditService {
  private db: D1Database
  private tableName: string
  private queue?: Queue
  private failureCount = 0
  private successCount = 0
  private lastFailureTime: number | null = null

  constructor(config: AuditServiceConfig) {
    this.db = config.database
    this.queue = config.queue
    // SECURITY: Validate table name to prevent SQL injection
    this.tableName = SQLValidator.validateTableName(
      config.tableName || "token_usage",
    )
  }

  /**
   * Log token usage event (async, non-blocking)
   * Uses fire-and-forget pattern - errors are logged but not thrown
   *
   * Behavior:
   * - If queue is configured: Publishes event to queue (consumer writes to D1)
   * - If queue is NOT configured: Writes directly to D1 (default behavior)
   */
  async logTokenUsage(event: TokenUsageEvent): Promise<void> {
    try {
      if (this.queue) {
        // Queue-based mode: Publish to queue (consumer will write to D1)
        const message: AuditEventMessage = {
          version: 1,
          event,
          enqueued_at: Date.now(),
        }
        await this.queue.send(message)
      } else {
        // Default mode: Direct D1 write
        await this.db
          .prepare(
            `
            INSERT INTO ${this.tableName}
            (token_id, subject, event_type, client_id, ip_address, user_agent, timestamp, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          )
          .bind(
            event.token_id,
            event.subject,
            event.event_type,
            event.client_id || null,
            event.ip_address || null,
            event.user_agent || null,
            event.timestamp,
            event.metadata ? JSON.stringify(event.metadata) : null,
          )
          .run()
      }

      // Track success
      this.successCount++
    } catch (error) {
      // Track failure for metrics
      this.failureCount++
      this.lastFailureTime = Date.now()

      // Log error but don't fail the OAuth flow
      const errorContext = this.queue ? "queue" : "D1"
      console.error(
        `AuditService: Failed to log token usage to ${errorContext}:`,
        error,
      )

      // Alert if failure rate is high (>10% of last 100 operations)
      const totalOperations = this.successCount + this.failureCount
      if (totalOperations >= 100) {
        const failureRate = this.failureCount / totalOperations
        if (failureRate > 0.1) {
          console.warn(
            `AuditService: High failure rate detected: ${(failureRate * 100).toFixed(2)}% (${this.failureCount}/${totalOperations} failed)`,
          )
        }
      }
    }
  }

  /**
   * Get token usage analytics for a subject
   */
  async getTokenAnalytics(
    subject: string,
    limit = 100,
  ): Promise<TokenUsageEvent[]> {
    try {
      const { results } = await this.db
        .prepare(
          `
          SELECT * FROM ${this.tableName}
          WHERE subject = ?
          ORDER BY timestamp DESC
          LIMIT ?
        `,
        )
        .bind(subject, limit)
        .all<D1TokenUsageRow>()

      if (!results) return []

      return results.map(rowToEvent)
    } catch (error) {
      console.error("AuditService: Failed to get token analytics:", error)
      return []
    }
  }

  /**
   * Get token family history (track refresh token chains)
   */
  async getTokenFamily(
    tokenId: string,
    limit = 50,
  ): Promise<TokenUsageEvent[]> {
    try {
      const { results } = await this.db
        .prepare(
          `
          SELECT * FROM ${this.tableName}
          WHERE token_id = ?
          ORDER BY timestamp ASC
          LIMIT ?
        `,
        )
        .bind(tokenId, limit)
        .all<D1TokenUsageRow>()

      if (!results) return []

      return results.map(rowToEvent)
    } catch (error) {
      console.error("AuditService: Failed to get token family:", error)
      return []
    }
  }

  /**
   * Get audit logs with filters
   */
  async getAuditLogs(options: {
    subject?: string
    event_type?: TokenEventType
    client_id?: string
    start_timestamp?: number
    end_timestamp?: number
    limit?: number
    offset?: number
  }): Promise<TokenUsageEvent[]> {
    try {
      const conditions: string[] = []
      const bindings: (string | number)[] = []

      if (options.subject) {
        conditions.push("subject = ?")
        bindings.push(options.subject)
      }

      if (options.event_type) {
        conditions.push("event_type = ?")
        bindings.push(options.event_type)
      }

      if (options.client_id) {
        conditions.push("client_id = ?")
        bindings.push(options.client_id)
      }

      if (options.start_timestamp) {
        conditions.push("timestamp >= ?")
        bindings.push(options.start_timestamp)
      }

      if (options.end_timestamp) {
        conditions.push("timestamp <= ?")
        bindings.push(options.end_timestamp)
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
      const limit = options.limit || 100
      const offset = options.offset || 0

      bindings.push(limit, offset)

      const { results } = await this.db
        .prepare(
          `
          SELECT * FROM ${this.tableName}
          ${whereClause}
          ORDER BY timestamp DESC
          LIMIT ? OFFSET ?
        `,
        )
        .bind(...bindings)
        .all<D1TokenUsageRow>()

      if (!results) return []

      return results.map(rowToEvent)
    } catch (error) {
      console.error("AuditService: Failed to get audit logs:", error)
      return []
    }
  }

  /**
   * Clean up old audit logs (for data retention policies)
   */
  async cleanExpired(maxAgeSeconds: number): Promise<number> {
    try {
      const cutoffTimestamp = Date.now() - maxAgeSeconds * 1000

      const result = await this.db
        .prepare(`DELETE FROM ${this.tableName} WHERE timestamp < ?`)
        .bind(cutoffTimestamp)
        .run()

      return result.meta.changes || 0
    } catch (error) {
      console.error("AuditService: Failed to clean expired logs:", error)
      return 0
    }
  }

  /**
   * Get audit logging metrics
   * Returns statistics about audit logging success/failure rates
   */
  getMetrics(): {
    successCount: number
    failureCount: number
    totalOperations: number
    failureRate: number
    lastFailureTime: number | null
  } {
    const totalOperations = this.successCount + this.failureCount
    const failureRate =
      totalOperations > 0 ? this.failureCount / totalOperations : 0

    return {
      successCount: this.successCount,
      failureCount: this.failureCount,
      totalOperations,
      failureRate,
      lastFailureTime: this.lastFailureTime,
    }
  }

  /**
   * Reset metrics counters
   * Useful for periodic metric reporting systems
   */
  resetMetrics(): void {
    this.successCount = 0
    this.failureCount = 0
    this.lastFailureTime = null
  }
}
