/**
 * Combined Worker: OAuth Issuer + Audit Consumer
 *
 * This single worker handles:
 * 1. HTTP requests - OAuth issuer endpoints
 * 2. Queue consumer - Processes audit events from queue
 *
 * Benefits of combined worker:
 * - Simpler deployment (one worker instead of two)
 * - Shared resources and configuration
 * - Easier to manage
 *
 * For high traffic, you can split into separate workers:
 * - One for OAuth issuer (HTTP only)
 * - One for audit consumer (queue only)
 */

import {
  handleAuditBatch,
  type AuditEventMessage,
} from "openauth/services/audit-consumer"

// Uncomment these when you configure your issuer:
// import { issuer } from "openauth"
// import { AuditService } from "openauth/services/audit"
// import { D1ClientAdapter } from "openauth/client/d1-adapter"
// import { ClientAuthenticator } from "openauth/client/authenticator"
// import { subjects } from "./subjects"
// import { GoogleProvider } from "openauth/provider/google"

interface Env {
  DB: D1Database
  AUDIT_DB: D1Database
  AUDIT_QUEUE: Queue
}

export default {
  /**
   * HTTP handler - OAuth issuer
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    // Example: Configure your issuer with audit service
    // Uncomment and customize for your use case:

    /*
    const clientAdapter = new D1ClientAdapter({
      database: env.DB,
    })

    const authenticator = new ClientAuthenticator({
      adapter: clientAdapter,
    })

    const auditService = new AuditService({
      database: env.AUDIT_DB,
      queue: env.AUDIT_QUEUE, // Optional - enables queue-based logging
    })

    const app = issuer({
      subjects,
      providers: {
        google: GoogleProvider({ ... })
      },
      // Pass authenticator and auditService to your issuer config
    })

    return app.fetch(request, env)
    */

    // Placeholder response - replace with your actual issuer
    return new Response("Configure your OAuth issuer here", { status: 501 })
  },

  /**
   * Queue consumer handler - Processes audit events
   *
   * Cloudflare automatically calls this when messages are available.
   * Messages are batched (up to 50 messages or 5 seconds).
   *
   * This runs in the SAME worker as the OAuth issuer above.
   */
  async queue(batch: MessageBatch<AuditEventMessage>, env: Env): Promise<void> {
    console.log(`Processing batch of ${batch.messages.length} audit events`)

    try {
      await handleAuditBatch(batch, env.AUDIT_DB)
      console.log(`Successfully processed ${batch.messages.length} events`)
    } catch (error) {
      console.error("Failed to process audit batch:", error)
      // handleAuditBatch already handles retries
    }
  },
}
