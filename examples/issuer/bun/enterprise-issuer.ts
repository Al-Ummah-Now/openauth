/**
 * Enterprise Multi-Tenant Issuer for Bun Runtime
 *
 * This example demonstrates a complete enterprise SSO solution with:
 * - Multi-tenancy with subdomain resolution
 * - Session management (multiple accounts per browser)
 * - RBAC (Role-Based Access Control)
 * - Audit logging
 * - Client credentials support
 * - White-label branding
 *
 * REQUIREMENTS:
 * - Storage adapter (DynamoDB, PostgreSQL, or Memory for dev)
 * - Database for clients, RBAC, and audit logs
 * - Session secret for cookie encryption
 *
 * DIFFERENCES FROM CLOUDFLARE VERSION:
 * - Uses MemoryStorage for development (replace with DynamoDB/Postgres in production)
 * - No Queue support (audit logging is synchronous)
 * - Runs as a standalone Bun server
 *
 * RUN:
 * bun run enterprise-issuer.ts
 */

import {
  createMultiTenantIssuer,
  hexToSecret,
  generateCookieSecret,
  type Tenant,
} from "@openauthjs/openauth/enterprise"
import { MemoryStorage } from "@openauthjs/openauth/storage/memory"
import { SessionServiceImpl } from "@openauthjs/openauth/session"
import { TenantServiceImpl } from "@openauthjs/openauth/tenant"
import { RBACServiceImpl, RBACAdapter } from "@openauthjs/openauth/rbac"
import { AuditService } from "@openauthjs/openauth/services/audit"
import { PasswordProvider } from "@openauthjs/openauth/provider/password"
import { PasswordUI } from "@openauthjs/openauth/ui/password"
import { GoogleProvider } from "@openauthjs/openauth/provider/google"
import { subjects } from "../../subjects.js"

/**
 * Environment configuration
 */
const config = {
  // Server configuration
  port: parseInt(process.env.PORT || "3000"),
  baseDomain: process.env.BASE_DOMAIN || "localhost:3000",

  // Session encryption
  sessionSecret:
    process.env.SESSION_SECRET || generateCookieSecret().toString("hex"),

  // OAuth providers (optional)
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,

  // Database configuration
  // Note: In production, replace MemoryStorage with DynamoDB or PostgreSQL
  databaseUrl: process.env.DATABASE_URL,

  // Storage persistence (for development)
  persistPath: "./enterprise-persist.json",
}

// Log configuration on startup
console.log("Enterprise Issuer Configuration:", {
  port: config.port,
  baseDomain: config.baseDomain,
  sessionSecretSet: !!config.sessionSecret,
  googleOAuthEnabled: !!(config.googleClientId && config.googleClientSecret),
  databaseUrl: config.databaseUrl ? "***configured***" : "memory",
})

/**
 * Mock user lookup function
 * Replace with your actual database query
 */
async function findOrCreateUser(params: {
  email: string
  tenantId: string
  provider: string
  name?: string
}) {
  // TODO: Implement actual database lookup
  // Example with Drizzle ORM:
  // const user = await db.query.users.findFirst({
  //   where: and(
  //     eq(users.email, params.email),
  //     eq(users.tenantId, params.tenantId)
  //   )
  // })
  //
  // if (!user) {
  //   const [newUser] = await db.insert(users).values({
  //     email: params.email,
  //     tenantId: params.tenantId,
  //     provider: params.provider,
  //     name: params.name,
  //   }).returning()
  //   return newUser.id
  // }
  //
  // return user.id

  console.log("Creating/finding user:", params)
  return "user-123"
}

/**
 * Mock D1 database for development
 * In production, use actual D1Database or PostgreSQL
 */
class MockD1Database {
  async prepare(query: string) {
    return {
      bind: (...args: any[]) => ({
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
        first: async () => null,
      }),
    }
  }

  async exec(query: string) {
    return { results: [] }
  }

  async batch(statements: any[]) {
    return []
  }
}

// ============================================
// STEP 1: Initialize Storage
// ============================================
// MemoryStorage is for development only
// For production, use:
// - DynamoStorage({ table: "auth-storage" })
// - PostgresStorage({ connectionString: "..." })
const storage = MemoryStorage({
  persist: config.persistPath,
})

// ============================================
// STEP 2: Initialize Tenant Service
// ============================================
const tenantService = new TenantServiceImpl(storage)

// ============================================
// STEP 3: Initialize Session Service
// ============================================
const sessionService = new SessionServiceImpl(storage, {
  maxAccountsPerSession: 3, // Allow up to 3 logged-in accounts
  sessionLifetimeSeconds: 7 * 24 * 60 * 60, // 7 days total lifetime
  slidingWindowSeconds: 24 * 60 * 60, // Extend by 1 day on activity
})

// ============================================
// STEP 4: Initialize RBAC Service
// ============================================
// Note: Using mock D1 database for development
// In production, pass actual database connection
const mockDb = new MockD1Database() as any
const rbacAdapter = new RBACAdapter(mockDb)
const rbacService = new RBACServiceImpl(rbacAdapter, storage, {
  cachePermissionsTTL: 60, // Cache permissions for 60 seconds
  includeRolesInToken: true, // Add roles to JWT claims
  includePermissionsInToken: true, // Add permissions to JWT claims
})

// ============================================
// STEP 5: Initialize Audit Service
// ============================================
// Note: No queue support in Bun - audit logging is synchronous
const auditService = new AuditService({
  database: mockDb,
  // queue: undefined - Bun doesn't support Cloudflare Queues
})

// ============================================
// STEP 6: Create Enterprise Issuer
// ============================================
const { app } = createMultiTenantIssuer({
  // Core services
  storage,
  tenantService,
  sessionService,
  rbacService,

  // Session cookie encryption
  sessionSecret: hexToSecret(config.sessionSecret),

  // Tenant resolution strategy
  tenantResolver: {
    baseDomain: config.baseDomain,
    // For local development:
    // - localhost:3000 (no tenant)
    // - acme.localhost:3000 (tenant: acme)
    //
    // For production with custom domain:
    // - auth.example.com (no tenant)
    // - acme.auth.example.com (tenant: acme)
    //
    // Note: Most browsers support subdomain cookies on localhost
    // but you may need to use 127.0.0.1 or edit /etc/hosts
  },

  // Optional: Enable client credentials
  clientDb: mockDb,

  // Optional: Enable audit logging
  audit: {
    service: auditService,
    hooks: {
      onTokenGenerated: true, // Log when tokens are created
      onTokenRefreshed: true, // Log when tokens are refreshed
      onTokenRevoked: true, // Log when tokens are revoked
      onTokenReused: true, // Log security incidents (token reuse)
    },
  },

  // Optional: Configure CORS
  cors: {
    origins: [
      "http://localhost:3001",
      "http://localhost:3002",
      "https://app.example.com",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    headers: ["Content-Type", "Authorization"],
    maxAge: 3600,
  },

  // OAuth providers
  providers: {
    // Password provider with email verification
    password: PasswordProvider(
      PasswordUI({
        sendCode: async (email, code) => {
          // In development, just log the code
          console.log(`\n${"=".repeat(50)}`)
          console.log(`Verification code for ${email}: ${code}`)
          console.log(`${"=".repeat(50)}\n`)

          // TODO: In production, send actual email
          // Example with Resend:
          // await resend.emails.send({
          //   from: 'noreply@example.com',
          //   to: email,
          //   subject: 'Your verification code',
          //   text: `Your code is: ${code}`,
          // })
        },
        validatePassword: (password) => {
          if (password.length < 8) {
            return "Password must be at least 8 characters"
          }
          if (!/[A-Z]/.test(password)) {
            return "Password must contain an uppercase letter"
          }
          if (!/[0-9]/.test(password)) {
            return "Password must contain a number"
          }
        },
      }),
    ),

    // Google OAuth provider (optional)
    ...(config.googleClientId && config.googleClientSecret
      ? {
          google: GoogleProvider({
            clientId: config.googleClientId,
            clientSecret: config.googleClientSecret,
          }),
        }
      : {}),
  },

  // Subject schema (defines token claims structure)
  subjects,

  // ============================================
  // STEP 7: Success Handler
  // ============================================
  onSuccess: async (ctx, authValue, tenant: Tenant) => {
    console.log("Authentication successful:", {
      provider: authValue.provider,
      tenant: tenant.id,
      timestamp: new Date().toISOString(),
    })

    // Look up or create user in your database
    const userId = await findOrCreateUser({
      email:
        authValue.provider === "password"
          ? authValue.email
          : authValue.provider === "google"
            ? authValue.email
            : "",
      tenantId: tenant.id,
      provider: authValue.provider,
      name: authValue.provider === "google" ? authValue.name : undefined,
    })

    // Get user's roles and permissions from RBAC
    const roles = await rbacService.getUserRoles(userId, tenant.id)

    const permissions = await rbacService.getUserPermissions({
      userId,
      appId: "default-app",
      tenantId: tenant.id,
    })

    // Return subject claims
    return ctx.subject("user", {
      id: userId,
      email:
        authValue.provider === "password"
          ? authValue.email
          : authValue.provider === "google"
            ? authValue.email
            : "",
      tenantId: tenant.id,
      roles: roles.map((r) => r.name),
      permissions, // Already string[] from getUserPermissions
    })
  },

  // Optional: Custom error handling
  onError: async (error) => {
    console.error("Authentication error:", error)
  },
})

// ============================================
// STEP 8: Start Bun Server
// ============================================
const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
})

console.log(`
${"=".repeat(60)}
Enterprise Multi-Tenant Issuer Running
${"=".repeat(60)}

Server: http://localhost:${config.port}
Base Domain: ${config.baseDomain}

ENDPOINTS:
  OAuth/OIDC:
    GET  /authorize                  - Authorization endpoint
    POST /token                      - Token endpoint
    GET  /userinfo                   - UserInfo endpoint
    GET  /.well-known/openid-configuration
    GET  /.well-known/jwks.json

  Session Management:
    GET    /session/accounts         - List logged-in accounts
    POST   /session/switch           - Switch active account
    DELETE /session/accounts/:userId - Sign out one account
    DELETE /session/all              - Sign out all accounts
    GET    /session/check            - Silent session check

  RBAC:
    POST /rbac/check                 - Check single permission
    POST /rbac/check/batch           - Check multiple permissions
    GET  /rbac/permissions           - Get user permissions
    GET  /rbac/roles                 - Get user roles

  Admin:
    POST /admin/sessions/revoke-user - Revoke all user sessions
    POST /admin/sessions/revoke      - Revoke specific session
    POST /admin/rbac/*               - RBAC administration

  Tenant Management:
    POST   /tenants                  - Create tenant
    GET    /tenants                  - List tenants
    GET    /tenants/:id              - Get tenant
    PUT    /tenants/:id              - Update tenant
    DELETE /tenants/:id              - Delete tenant

QUICK START:

  1. Create a tenant:
     curl -X POST http://localhost:${config.port}/tenants \\
       -H "Content-Type: application/json" \\
       -d '{"id": "acme", "name": "Acme Corp", "status": "active"}'

  2. Test authentication:
     Open http://localhost:${config.port}/authorize?client_id=test&response_type=code&redirect_uri=http://localhost:3001/callback

  3. Check session:
     curl http://localhost:${config.port}/session/accounts \\
       -H "Cookie: session=..."

  4. Test RBAC:
     curl -X POST http://localhost:${config.port}/rbac/check \\
       -H "Content-Type: application/json" \\
       -d '{"userId": "user-123", "appId": "default-app", "permission": "posts:read"}'

NOTES:
  - Using MemoryStorage for development (data persists to ${config.persistPath})
  - Replace with DynamoDB or PostgreSQL for production
  - Session secret: ${config.sessionSecret ? "configured" : "auto-generated"}
  - Google OAuth: ${config.googleClientId ? "enabled" : "disabled"}

${"=".repeat(60)}
`)
