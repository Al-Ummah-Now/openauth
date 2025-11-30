import { issuer } from "@openauthjs/openauth"
import { handle } from "hono/aws-lambda"
import { subjects } from "../../subjects.js"
import { PasswordUI } from "@openauthjs/openauth/ui/password"
import { PasswordProvider } from "@openauthjs/openauth/provider/password"
// import { AuditService } from "@openauthjs/openauth/services/audit"

async function getUser(email: string) {
  // Get user from database
  // Return user ID
  return "123"
}

const app = issuer({
  // Note: Enterprise features require environment bindings
  // For Lambda, you would need to pass D1/Queue instances via context

  // Optional: Enable client credentials (requires D1 database)
  // Enables: Client authentication, token introspection, token revocation
  // clientDb: context.AUTH_DB,

  // Optional: Enable audit logging (requires D1 database)
  // audit: {
  //   service: new AuditService({
  //     database: context.AUDIT_DB,
  //     // queue: context.AUDIT_QUEUE,  // Optional: Use queue for high performance
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
})

// @ts-ignore
export const handler = handle(app)
