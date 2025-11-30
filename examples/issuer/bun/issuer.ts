import { issuer } from "@openauthjs/openauth"
import { MemoryStorage } from "@openauthjs/openauth/storage/memory"
import { PasswordProvider } from "@openauthjs/openauth/provider/password"
import { PasswordUI } from "@openauthjs/openauth/ui/password"
import { subjects } from "../../subjects.js"
// import { AuditService } from "@openauthjs/openauth/services/audit"

async function getUser(email: string) {
  // Get user from database
  // Return user ID
  return "123"
}

export default issuer({
  subjects,
  // Required: Storage for tokens
  storage: MemoryStorage({
    persist: "./persist.json",
  }),

  // Optional: Enable client credentials (requires D1 database)
  // Note: MemoryStorage doesn't support enterprise features - use DynamoDB or Cloudflare KV
  // Enables: Client authentication, token introspection, token revocation
  // clientDb: env.AUTH_DB,

  // Optional: Enable audit logging (requires D1 database)
  // Note: MemoryStorage is for development - use real database in production
  // audit: {
  //   service: new AuditService({
  //     database: env.AUDIT_DB,
  //   }),
  //   hooks: {
  //     onTokenGenerated: true,
  //     onTokenRefreshed: true,
  //     onTokenRevoked: true,
  //     onTokenReused: true,
  //   },
  // },

  // Optional: Configure CORS
  // cors: {
  //   origins: ["http://localhost:3000"],
  //   credentials: true,
  // },

  providers: {
    password: PasswordProvider(
      PasswordUI({
        sendCode: async (email, code) => {
          console.log(email, code)
        },
        validatePassword: (password) => {
          if (password.length < 8) {
            return "Password must be at least 8 characters"
          }
        },
      }),
    ),
  },
  async allow() {
    return true
  },
  success: async (ctx, value) => {
    if (value.provider === "password") {
      return ctx.subject("user", {
        id: await getUser(value.email),
      })
    }
    throw new Error("Invalid provider")
  },
})
