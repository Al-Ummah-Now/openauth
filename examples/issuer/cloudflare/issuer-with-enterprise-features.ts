/**
 * Example: OpenAuth with Optional Enterprise Features
 *
 * This example shows how to enable enterprise features.
 * All features are OPTIONAL - the basic example (issuer.ts) works without any of these.
 *
 * Features shown:
 * - Client credentials (enables introspection & revocation)
 * - Audit logging with queue-based processing
 * - Global CORS configuration
 */

import { issuer } from "@openauthjs/openauth"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"
import { AuditService } from "@openauthjs/openauth/services/audit"
import {
  type ExecutionContext,
  type KVNamespace,
  type D1Database,
  type Queue,
} from "@cloudflare/workers-types"
import { subjects } from "../../subjects.js"
import { PasswordProvider } from "@openauthjs/openauth/provider/password"
import { PasswordUI } from "@openauthjs/openauth/ui/password"

interface Env {
  // Required
  CloudflareAuthKV: KVNamespace

  // Optional: For enterprise features
  AUTH_DB: D1Database // Client credentials
  AUDIT_DB: D1Database // Audit logs
  AUDIT_QUEUE: Queue // Queue for async audit logging
  ALLOWED_ORIGINS: string // Comma-separated origins
}

async function getUser(email: string) {
  // Get user from database
  // Return user ID
  return "123"
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return issuer({
      // Required: KV storage for tokens
      storage: CloudflareStorage({
        namespace: env.CloudflareAuthKV,
      }),

      // Optional: Enable client credentials
      // This enables:
      // - POST /token/introspect (RFC 7662)
      // - POST /token/revoke (RFC 7009)
      // - Client authentication with PBKDF2
      clientDb: env.AUTH_DB,

      // Optional: Enable audit logging
      // This tracks all token operations for compliance and security
      audit: {
        service: new AuditService({
          database: env.AUDIT_DB,
          queue: env.AUDIT_QUEUE, // Optional: Use queue for high performance
        }),
        hooks: {
          onTokenGenerated: true, // Log when tokens are created
          onTokenRefreshed: true, // Log when tokens are refreshed
          onTokenRevoked: true, // Log when tokens are revoked
          onTokenReused: true, // Log reuse detection (security incident)
        },
      },

      // Optional: Configure global CORS
      cors: {
        origins: env.ALLOWED_ORIGINS.split(","),
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        headers: ["Content-Type", "Authorization"],
        maxAge: 3600, // Cache preflight for 1 hour
      },

      subjects,
      providers: {
        password: PasswordProvider(
          PasswordUI({
            sendCode: async (email, code) => {
              console.log(email, code)
            },
          }),
        ),
      },
      success: async (ctx, value) => {
        if (value.provider === "password") {
          return ctx.subject("user", {
            id: await getUser(value.email),
          })
        }
        throw new Error("Invalid provider")
      },
    }).fetch(request, env, ctx)
  },
}
