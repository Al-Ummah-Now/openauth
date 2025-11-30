import { issuer } from "@openauthjs/openauth"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"
import {
  type ExecutionContext,
  type KVNamespace,
  type D1Database,
  type Queue,
} from "@cloudflare/workers-types"
import { subjects } from "../../subjects.js"
import { PasswordProvider } from "@openauthjs/openauth/provider/password"
import { PasswordUI } from "@openauthjs/openauth/ui/password"
// import { AuditService } from "@openauthjs/openauth/services/audit"

interface Env {
  CloudflareAuthKV: KVNamespace
  // Optional: Uncomment to enable enterprise features
  // AUTH_DB?: D1Database      // For client credentials, introspection, revocation
  // AUDIT_DB?: D1Database     // For audit logging
  // AUDIT_QUEUE?: Queue       // For queue-based audit logging (high performance)
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

      // Optional: Enable client credentials (uncomment to use)
      // Enables: Client authentication, token introspection, token revocation
      // clientDb: env.AUTH_DB,

      // Optional: Enable audit logging (uncomment to use)
      // audit: {
      //   service: new AuditService({
      //     database: env.AUDIT_DB,
      //     queue: env.AUDIT_QUEUE,  // Optional: Use queue for high performance
      //   }),
      //   hooks: {
      //     onTokenGenerated: true,   // Log token creation
      //     onTokenRefreshed: true,   // Log token refresh
      //     onTokenRevoked: true,     // Log token revocation
      //     onTokenReused: true,      // Log reuse detection (security)
      //   },
      // },

      // Optional: Configure CORS (uncomment to use)
      // cors: {
      //   origins: ["https://app.example.com"],
      //   credentials: true,
      // },

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
