/**
 * Enterprise Multi-Tenant Issuer for Cloudflare Workers
 *
 * This example demonstrates a complete enterprise SSO solution with:
 * - Multi-tenancy with subdomain resolution (acme.auth.example.com)
 * - Session management (multiple accounts per browser)
 * - RBAC (Role-Based Access Control)
 * - Audit logging with queue-based processing
 * - Client credentials support
 * - White-label branding
 *
 * REQUIREMENTS:
 * - KV namespace for token storage
 * - D1 database for clients, RBAC, and audit logs
 * - Queue for async audit processing (optional but recommended)
 * - Session secret for cookie encryption
 *
 * ARCHITECTURE:
 * The enterprise issuer wraps the standard OAuth/OIDC issuer with:
 * 1. Tenant resolution middleware (extracts tenant from subdomain/domain)
 * 2. Session middleware (multi-account browser sessions)
 * 3. RBAC middleware (role/permission checking + token enrichment)
 * 4. Audit logging hooks (compliance tracking)
 *
 * API ENDPOINTS:
 * - OAuth/OIDC: /authorize, /token, /userinfo, /.well-known/*
 * - Sessions: /session/accounts, /session/switch, /session/check
 * - RBAC: /rbac/check, /rbac/permissions, /rbac/roles
 * - Admin: /admin/rbac/*, /admin/sessions/*, /tenants/*
 */

import {
  createMultiTenantIssuer,
  hexToSecret,
  type Tenant,
} from "@openauthjs/openauth/enterprise"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"
import { SessionServiceImpl } from "@openauthjs/openauth/session"
import { TenantServiceImpl } from "@openauthjs/openauth/tenant"
import { RBACServiceImpl, RBACAdapter } from "@openauthjs/openauth/rbac"
import { AuditService } from "@openauthjs/openauth/services/audit"
import { PasswordProvider } from "@openauthjs/openauth/provider/password"
import { PasswordUI } from "@openauthjs/openauth/ui/password"
import { GoogleProvider } from "@openauthjs/openauth/provider/google"
import { subjects } from "../../subjects.js"
import {
  type ExecutionContext,
  type KVNamespace,
  type D1Database,
  type Queue,
} from "@cloudflare/workers-types"

/**
 * Environment variables required for the enterprise issuer
 */
interface Env {
  // Required: Token storage
  AUTH_KV: KVNamespace

  // Required: Client credentials, RBAC, and audit storage
  AUTH_DB: D1Database

  // Optional: Queue for async audit logging (high performance)
  AUDIT_QUEUE?: Queue

  // Required: Session cookie encryption
  // Generate with: openssl rand -hex 32
  SESSION_SECRET: string

  // Optional: OAuth provider credentials
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string

  // Optional: Base domain for tenant resolution
  // Tenants will use subdomains: {tenant}.auth.example.com
  BASE_DOMAIN?: string
}

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
  // Example:
  // const user = await db.query.users.findFirst({
  //   where: and(
  //     eq(users.email, params.email),
  //     eq(users.tenantId, params.tenantId)
  //   )
  // })
  //
  // if (!user) {
  //   return await db.insert(users).values({
  //     email: params.email,
  //     tenantId: params.tenantId,
  //     provider: params.provider,
  //     name: params.name,
  //   }).returning()
  // }
  //
  // return user.id

  console.log("Creating/finding user:", params)
  return "user-123"
}

/**
 * Cloudflare Workers export
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // ============================================
    // STEP 1: Initialize Storage
    // ============================================
    // CloudflareStorage wraps KV namespace with OpenAuth storage interface
    const storage = CloudflareStorage({
      namespace: env.AUTH_KV,
    })

    // ============================================
    // STEP 2: Initialize Tenant Service
    // ============================================
    // Manages tenant CRUD operations and provides tenant-isolated storage
    const tenantService = new TenantServiceImpl(storage)

    // ============================================
    // STEP 3: Initialize Session Service
    // ============================================
    // Manages multi-account browser sessions with sliding expiration
    const sessionService = new SessionServiceImpl(storage, {
      maxAccountsPerSession: 3, // Allow up to 3 logged-in accounts
      sessionLifetimeSeconds: 7 * 24 * 60 * 60, // 7 days total lifetime
      slidingWindowSeconds: 24 * 60 * 60, // Extend by 1 day on activity
    })

    // ============================================
    // STEP 4: Initialize RBAC Service
    // ============================================
    // Provides role-based access control with permission checking
    const rbacAdapter = new RBACAdapter(env.AUTH_DB)
    const rbacService = new RBACServiceImpl(rbacAdapter, storage, {
      cachePermissionsTTL: 60, // Cache permissions for 60 seconds
      includeRolesInToken: true, // Add roles to JWT claims
      includePermissionsInToken: true, // Add permissions to JWT claims
    })

    // ============================================
    // STEP 5: Initialize Audit Service (Optional)
    // ============================================
    // Tracks all token operations for compliance
    const auditService = new AuditService({
      database: env.AUTH_DB,
      queue: env.AUDIT_QUEUE, // Optional: Use queue for async processing
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
      sessionSecret: hexToSecret(env.SESSION_SECRET),

      // Tenant resolution strategy
      tenantResolver: {
        baseDomain: env.BASE_DOMAIN || "auth.example.com",
        // Tenants will be resolved from subdomains:
        // - acme.auth.example.com -> tenant: acme
        // - contoso.auth.example.com -> tenant: contoso
        //
        // Other strategies available:
        // - strategy: 'domain' (exact domain match)
        // - strategy: 'path' (URL path prefix)
        // - strategy: 'header' (custom header)
        // - strategy: 'query' (query parameter)
      },

      // Optional: Enable client credentials
      // Enables POST /token/introspect and POST /token/revoke
      clientDb: env.AUTH_DB,

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
        origins: ["https://app.example.com", "https://*.example.com"],
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
              // TODO: Send actual email via your email service
              // Example with SendGrid:
              // await sendgrid.send({
              //   to: email,
              //   from: 'noreply@example.com',
              //   subject: 'Your verification code',
              //   text: `Your code is: ${code}`,
              // })
              console.log(`Verification code for ${email}: ${code}`)
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
        ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
          ? {
              google: GoogleProvider({
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET,
              }),
            }
          : {}),
      },

      // Subject schema (defines token claims structure)
      subjects,

      // ============================================
      // STEP 7: Success Handler
      // ============================================
      // Called after successful authentication
      // Returns the subject claims that will be encoded in the JWT
      onSuccess: async (ctx, authValue, tenant: Tenant) => {
        // authValue contains provider-specific data:
        // - For password: { provider: 'password', email: string }
        // - For Google: { provider: 'google', email: string, name: string, ... }

        console.log("Authentication successful:", {
          provider: authValue.provider,
          tenant: tenant.id,
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
        // These will be automatically added to the JWT if configured
        const roles = await rbacService.getUserRoles(userId, tenant.id)

        const permissions = await rbacService.getUserPermissions({
          userId,
          appId: "default-app",
          tenantId: tenant.id,
        })

        // Return subject claims
        // These will be encoded in the JWT and available to your application
        return ctx.subject("user", {
          id: userId,
          email:
            authValue.provider === "password"
              ? authValue.email
              : authValue.provider === "google"
                ? authValue.email
                : "",
          tenantId: tenant.id,
          // RBAC claims are automatically added if configured in rbacService
          // but you can also manually include them:
          roles: roles.map((r) => r.name),
          permissions, // Already string[] from getUserPermissions
        })
      },

      // Optional: Custom error handling
      onError: async (error) => {
        console.error("Authentication error:", error)

        // You can customize error responses here
        // Default behavior returns appropriate OAuth error responses
      },
    })

    // ============================================
    // STEP 8: Handle Request
    // ============================================
    // The enterprise issuer handles all OAuth/OIDC endpoints plus:
    // - Session management endpoints
    // - RBAC endpoints
    // - Tenant management endpoints
    return app.fetch(request, env, ctx)
  },
}

/**
 * DEPLOYMENT NOTES:
 *
 * 1. Create KV namespace:
 *    wrangler kv:namespace create AUTH_KV
 *
 * 2. Create D1 database:
 *    wrangler d1 create auth-db
 *
 * 3. Create Queue (optional):
 *    wrangler queues create audit-queue
 *
 * 4. Run migrations:
 *    wrangler d1 execute auth-db --file=./schema.sql
 *
 * 5. Add to wrangler.toml:
 *    [[kv_namespaces]]
 *    binding = "AUTH_KV"
 *    id = "YOUR_KV_ID"
 *
 *    [[d1_databases]]
 *    binding = "AUTH_DB"
 *    database_name = "auth-db"
 *    database_id = "YOUR_D1_ID"
 *
 *    [[queues.producers]]
 *    binding = "AUDIT_QUEUE"
 *    queue = "audit-queue"
 *
 *    [vars]
 *    BASE_DOMAIN = "auth.example.com"
 *
 * 6. Set secrets:
 *    wrangler secret put SESSION_SECRET
 *    wrangler secret put GOOGLE_CLIENT_ID
 *    wrangler secret put GOOGLE_CLIENT_SECRET
 *
 * 7. Deploy:
 *    wrangler deploy
 *
 * TESTING:
 *
 * 1. Create a tenant:
 *    curl -X POST https://auth.example.com/tenants \
 *      -H "Content-Type: application/json" \
 *      -d '{"id": "acme", "name": "Acme Corp"}'
 *
 * 2. Navigate to tenant subdomain:
 *    https://acme.auth.example.com/authorize?...
 *
 * 3. Test session management:
 *    GET https://acme.auth.example.com/session/accounts
 *
 * 4. Test RBAC:
 *    POST https://acme.auth.example.com/rbac/check
 *    {"userId": "user-123", "permission": "posts:read"}
 */
