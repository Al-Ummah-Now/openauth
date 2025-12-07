# Enterprise Admin APIs - Implementation Plan

This document outlines the detailed implementation plan for Enterprise Admin APIs.

## Table of Contents

1. [Phase 1: M2M Authentication](#phase-1-m2m-authentication)
2. [Phase 2: User Management](#phase-2-user-management)
3. [Phase 3: RBAC REST APIs](#phase-3-rbac-rest-apis)
4. [Phase 4: Dynamic Identity Providers](#phase-4-dynamic-identity-providers)
5. [Phase 5: Scope-Based Authorization](#phase-5-scope-based-authorization)
6. [Phase 6: Security & Audit](#phase-6-security--audit)

---

## Phase 1: M2M Authentication

**Effort: 2 days**

### Objective

Add standard OAuth2 `client_credentials` grant that validates against the `oauth_clients` table without requiring a provider.

### Files to Create

```
packages/openauth/src/m2m/
├── index.ts           # Public exports
├── types.ts           # M2M types and interfaces
└── handler.ts         # Token handler logic
```

### Types (m2m/types.ts)

```typescript
export interface M2MTokenRequest {
  client_id: string
  client_secret: string
  grant_type: "client_credentials"
  scope?: string
}

export interface M2MTokenResponse {
  access_token: string
  token_type: "Bearer"
  expires_in: number
  scope?: string
}

export interface M2MTokenClaims {
  mode: "m2m"
  iss: string
  sub: string // client_id
  client_id: string
  tenant_id?: string
  scope: string
  iat: number
  exp: number
  jti: string
}

export interface M2MConfig {
  accessTokenTTL?: number // Default: 3600 (1 hour)
  rateLimit?: number // Default: 30 req/min
  defaultScopes?: string[]
}
```

### Handler (m2m/handler.ts)

```typescript
import { SignJWT } from "jose"
import type { Context } from "hono"

export async function handleM2MTokenRequest(
  c: Context,
  clientId: string,
  clientSecret: string,
  requestedScope: string | undefined,
  authenticator: ClientAuthenticator,
  config: M2MConfig,
  signingKey: () => Promise<SigningKey>,
  issuerUrl: string,
): Promise<Response> {
  // 1. Authenticate client against oauth_clients table
  const { client, isPublicClient } = await authenticator.authenticateClient(
    clientId,
    clientSecret,
  )

  if (!client) {
    return c.json(
      {
        error: "invalid_client",
        error_description: "Client authentication failed",
      },
      401,
    )
  }

  // 2. Reject public clients (RFC 6749 requirement)
  if (isPublicClient) {
    return c.json(
      {
        error: "unauthorized_client",
        error_description: "Public clients cannot use client_credentials grant",
      },
      400,
    )
  }

  // 3. Validate grant type allowed
  const grantTypes = JSON.parse(client.grant_types || "[]")
  if (!grantTypes.includes("client_credentials")) {
    return c.json(
      {
        error: "unauthorized_client",
        error_description: "Client not authorized for client_credentials grant",
      },
      400,
    )
  }

  // 4. Validate and filter scopes
  const allowedScopes = JSON.parse(client.scopes || "[]")
  const requestedScopes = requestedScope?.split(" ").filter(Boolean) || []
  const grantedScopes =
    requestedScopes.length > 0
      ? requestedScopes.filter((s) => allowedScopes.includes(s))
      : config.defaultScopes || allowedScopes

  if (requestedScopes.length > 0 && grantedScopes.length === 0) {
    return c.json(
      {
        error: "invalid_scope",
        error_description: "Requested scopes not allowed for this client",
      },
      400,
    )
  }

  // 5. Generate M2M access token
  const jti = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const ttl = config.accessTokenTTL || 3600

  const claims: M2MTokenClaims = {
    mode: "m2m",
    iss: issuerUrl,
    sub: clientId,
    client_id: clientId,
    tenant_id: client.tenant_id,
    scope: grantedScopes.join(" "),
    iat: now,
    exp: now + ttl,
    jti,
  }

  const key = await signingKey()
  const accessToken = await new SignJWT(claims)
    .setProtectedHeader({ alg: key.alg, kid: key.id, typ: "JWT" })
    .sign(key.private)

  // 6. Return token (NO refresh token for M2M)
  return c.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ttl,
    scope: grantedScopes.join(" "),
  })
}
```

### Integration in issuer.ts

Modify `/token` endpoint (around line 1117):

```typescript
if (grantType === "client_credentials") {
  const provider = form.get("provider")

  // ========================================
  // STANDARD M2M: No provider required
  // ========================================
  if (!provider && clientAuthenticator) {
    const credentials = extractClientCredentials(c, form)
    if (credentials.error) return credentials.error

    // Rate limiting
    const allowed = await checkRateLimit(
      credentials.clientId!,
      "m2m_token",
      30, // requests
      60, // per minute
    )
    if (!allowed) {
      return c.json(
        {
          error: "slow_down",
          error_description: "Rate limit exceeded",
        },
        429,
      )
    }

    return handleM2MTokenRequest(
      c,
      credentials.clientId!,
      credentials.clientSecret!,
      form.get("scope")?.toString(),
      clientAuthenticator,
      input.m2m || {},
      signingKey,
      issuer(c),
    )
  }

  // ========================================
  // LEGACY: Provider-based client_credentials
  // ========================================
  if (!provider) {
    return c.json({ error: "missing `provider` form value" }, 400)
  }
  // ... existing provider-based flow
}
```

### Tests

```typescript
describe("M2M Authentication", () => {
  it("issues token for valid client credentials", async () => {
    const response = await app.request("/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: "test-service",
        client_secret: "secret123",
        scope: "users:read",
      }),
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.access_token).toBeDefined()
    expect(data.token_type).toBe("Bearer")
    expect(data.refresh_token).toBeUndefined()  // No refresh for M2M
  })

  it("rejects public clients", async () => { ... })
  it("rejects invalid scopes", async () => { ... })
  it("rejects clients without client_credentials grant", async () => { ... })
})
```

---

## Phase 2: User Management

**Effort: 3 days**

### Objective

Create a central users table with CRUD APIs and auto-creation on provider login.

### Database Migration (005_user_management.sql)

```sql
-- Migration 005: User Management
-- Central users table with identity provider linking

PRAGMA foreign_keys = ON;

-- ============================================
-- USERS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    metadata TEXT,                    -- JSON for extensibility
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_login_at INTEGER,
    deleted_at INTEGER,               -- Soft delete

    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Unique email per tenant (excluding deleted)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_tenant
    ON users(tenant_id, email) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_at) WHERE deleted_at IS NOT NULL;

-- ============================================
-- USER IDENTITIES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS user_identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    provider_data TEXT,               -- JSON
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identities_unique
    ON user_identities(tenant_id, provider, provider_user_id);

CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id);
```

### Files to Create

```
packages/openauth/src/user/
├── index.ts           # Public exports
├── types.ts           # User types
├── service.ts         # UserServiceImpl
├── d1-adapter.ts      # D1 database operations
└── api.ts             # Hono routes
```

### Types (user/types.ts)

```typescript
export interface User {
  id: string
  tenant_id: string
  email: string
  name?: string
  metadata?: Record<string, unknown>
  created_at: number
  updated_at: number
  last_login_at?: number
  deleted_at?: number
}

export interface UserIdentity {
  id: string
  user_id: string
  tenant_id: string
  provider: string
  provider_user_id: string
  provider_data?: Record<string, unknown>
  created_at: number
  last_used_at?: number
}

export interface UserWithIdentities extends User {
  identities: UserIdentity[]
}

export interface CreateUserParams {
  tenantId: string
  email: string
  name?: string
  metadata?: Record<string, unknown>
}

export interface UpdateUserParams {
  email?: string
  name?: string
  metadata?: Record<string, unknown>
}

export interface ListUsersParams {
  tenantId: string
  search?: string
  limit?: number
  offset?: number
  orderBy?: "created_at" | "updated_at" | "email"
  orderDir?: "asc" | "desc"
}

export interface FindOrCreateResult {
  user: User
  identity: UserIdentity
  created: boolean
}
```

### Service Interface (contracts/types.ts addition)

```typescript
export interface UserService {
  // CRUD
  createUser(params: CreateUserParams): Promise<User>
  getUser(userId: string, tenantId: string): Promise<User | null>
  getUserByEmail(email: string, tenantId: string): Promise<User | null>
  getUserWithIdentities(
    userId: string,
    tenantId: string,
  ): Promise<UserWithIdentities | null>
  updateUser(
    userId: string,
    tenantId: string,
    updates: UpdateUserParams,
  ): Promise<User>
  deleteUser(userId: string, tenantId: string): Promise<void>
  listUsers(params: ListUsersParams): Promise<{ users: User[]; total: number }>

  // Identity operations
  linkIdentity(params: LinkIdentityParams): Promise<UserIdentity>
  unlinkIdentity(identityId: string, userId: string): Promise<void>
  getIdentityByProvider(
    tenantId: string,
    provider: string,
    providerUserId: string,
  ): Promise<UserIdentity | null>

  // Provider login integration
  findOrCreateUserByIdentity(
    params: FindOrCreateParams,
  ): Promise<FindOrCreateResult>

  // Admin operations
  suspendUser(userId: string, tenantId: string): Promise<void>
  updateLastLogin(userId: string): Promise<void>
}
```

### API Routes (user/api.ts)

```typescript
import { Hono } from "hono"
import type { UserService, SessionService } from "../contracts/types"

export function createUserRoutes(
  userService: UserService,
  sessionService: SessionService,
): Hono {
  const app = new Hono()

  // GET /api/users - List users
  app.get("/", async (c) => {
    const tenantId = c.get("tenantId")
    const search = c.req.query("search")
    const limit = parseInt(c.req.query("limit") || "50")
    const offset = parseInt(c.req.query("offset") || "0")

    const result = await userService.listUsers({
      tenantId,
      search,
      limit: Math.min(limit, 100),
      offset,
    })

    return c.json(result)
  })

  // GET /api/users/:id - Get user with identities
  app.get("/:id", async (c) => {
    const tenantId = c.get("tenantId")
    const userId = c.req.param("id")

    const user = await userService.getUserWithIdentities(userId, tenantId)
    if (!user) {
      return c.json({ error: "User not found" }, 404)
    }

    return c.json({ user })
  })

  // POST /api/users - Create user
  app.post("/", async (c) => {
    const tenantId = c.get("tenantId")
    const body = await c.req.json()

    const user = await userService.createUser({
      tenantId,
      email: body.email,
      name: body.name,
      metadata: body.metadata,
    })

    return c.json({ user }, 201)
  })

  // PATCH /api/users/:id - Update user
  app.patch("/:id", async (c) => {
    const tenantId = c.get("tenantId")
    const userId = c.req.param("id")
    const body = await c.req.json()

    const user = await userService.updateUser(userId, tenantId, body)
    return c.json({ user })
  })

  // DELETE /api/users/:id - Soft delete
  app.delete("/:id", async (c) => {
    const tenantId = c.get("tenantId")
    const userId = c.req.param("id")

    await userService.deleteUser(userId, tenantId)
    await sessionService.revokeUserSessions(tenantId, userId)

    return c.body(null, 204)
  })

  // POST /api/users/:id/suspend - Suspend user
  app.post("/:id/suspend", async (c) => {
    const tenantId = c.get("tenantId")
    const userId = c.req.param("id")

    await userService.suspendUser(userId, tenantId)
    await sessionService.revokeUserSessions(tenantId, userId)

    return c.json({ success: true })
  })

  // DELETE /api/users/:id/sessions - Revoke all sessions
  app.delete("/:id/sessions", async (c) => {
    const tenantId = c.get("tenantId")
    const userId = c.req.param("id")

    const count = await sessionService.revokeUserSessions(tenantId, userId)
    return c.json({ revokedCount: count })
  })

  // GET /api/users/:id/roles - Get user roles
  app.get("/:id/roles", async (c) => {
    // Delegate to RBAC service
  })

  return app
}
```

### Enterprise Issuer Integration

Add auto-create user on provider login:

```typescript
// In enterprise/issuer.ts success callback

if (config.userService) {
  const { user, identity, created } =
    await config.userService.findOrCreateUserByIdentity({
      tenantId: tenant.id,
      provider: value.provider,
      providerUserId: value.userID || value.properties?.sub,
      email: value.properties?.email || value.email,
      name: value.properties?.name,
      providerData: value.properties,
    })

  // Add canonical user ID to token properties
  enrichedProperties.userId = user.id

  // Update last login
  await config.userService.updateLastLogin(user.id)
}
```

---

## Phase 3: RBAC REST APIs

**Effort: 2 days**

### Objective

Complete the RBAC REST API by adding missing endpoints.

### Missing Endpoints to Add

| Endpoint               | Method | Status  |
| ---------------------- | ------ | ------- |
| `/api/roles/:id`       | GET    | **Add** |
| `/api/roles/:id`       | PATCH  | **Add** |
| `/api/roles/:id`       | DELETE | **Add** |
| `/api/apps/:id`        | DELETE | **Add** |
| `/api/permissions/:id` | DELETE | **Add** |

### Service Interface Additions (contracts/types.ts)

```typescript
export interface RBACService {
  // ... existing methods ...

  // Add these
  getRole(roleId: string, tenantId: string): Promise<Role | null>
  updateRole(params: UpdateRoleParams): Promise<Role>
  deleteRole(roleId: string, tenantId: string): Promise<void>

  getApp(appId: string, tenantId: string): Promise<App | null>
  deleteApp(appId: string, tenantId: string): Promise<void>

  getPermission(permissionId: string): Promise<Permission | null>
  deletePermission(permissionId: string): Promise<void>
}

export interface UpdateRoleParams {
  roleId: string
  tenantId: string
  name?: string
  description?: string
}
```

### D1 Adapter Additions (rbac/d1-adapter.ts)

```typescript
async updateRole(params: UpdateRoleParams): Promise<Role> {
  const now = Date.now()
  const sets: string[] = ["updated_at = ?"]
  const values: any[] = [now]

  if (params.name !== undefined) {
    sets.push("name = ?")
    values.push(params.name)
  }
  if (params.description !== undefined) {
    sets.push("description = ?")
    values.push(params.description)
  }

  values.push(params.roleId, params.tenantId)

  await this.db
    .prepare(`UPDATE rbac_roles SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`)
    .bind(...values)
    .run()

  return this.getRole(params.roleId, params.tenantId)
}

async deleteRole(roleId: string, tenantId: string): Promise<void> {
  // Check if system role
  const role = await this.getRole(roleId, tenantId)
  if (role?.is_system_role) {
    throw new RBACError("cannot_delete_system_role", "System roles cannot be deleted")
  }

  // Delete role (cascades to role_permissions and user_roles)
  await this.db
    .prepare("DELETE FROM rbac_roles WHERE id = ? AND tenant_id = ?")
    .bind(roleId, tenantId)
    .run()
}

async deleteApp(appId: string, tenantId: string): Promise<void> {
  // Delete app (cascades to permissions)
  await this.db
    .prepare("DELETE FROM rbac_apps WHERE id = ? AND tenant_id = ?")
    .bind(appId, tenantId)
    .run()
}

async deletePermission(permissionId: string): Promise<void> {
  // Delete permission (cascades to role_permissions)
  await this.db
    .prepare("DELETE FROM rbac_permissions WHERE id = ?")
    .bind(permissionId)
    .run()
}
```

### Admin Endpoints Additions (rbac/admin-endpoints.ts)

```typescript
// GET /roles/:roleId
router.get("/roles/:roleId", async (c) => {
  const tenantId = c.get("tenantId")
  const roleId = c.req.param("roleId")
  const includePermissions = c.req.query("include") === "permissions"

  const role = await service.getRole(roleId, tenantId)
  if (!role) {
    return c.json({ error: "Role not found" }, 404)
  }

  if (includePermissions) {
    const permissions = await service.listRolePermissions(roleId)
    return c.json({ ...role, permissions })
  }

  return c.json(role)
})

// PATCH /roles/:roleId
router.patch("/roles/:roleId", async (c) => {
  const tenantId = c.get("tenantId")
  const roleId = c.req.param("roleId")
  const body = await c.req.json()

  const existing = await service.getRole(roleId, tenantId)
  if (!existing) {
    return c.json({ error: "Role not found" }, 404)
  }
  if (existing.is_system_role) {
    return c.json({ error: "System roles cannot be modified" }, 403)
  }

  const role = await service.updateRole({
    roleId,
    tenantId,
    name: body.name,
    description: body.description,
  })

  return c.json(role)
})

// DELETE /roles/:roleId
router.delete("/roles/:roleId", async (c) => {
  const tenantId = c.get("tenantId")
  const roleId = c.req.param("roleId")

  await service.deleteRole(roleId, tenantId)
  return c.body(null, 204)
})

// DELETE /apps/:appId
router.delete("/apps/:appId", async (c) => {
  const tenantId = c.get("tenantId")
  const appId = c.req.param("appId")

  await service.deleteApp(appId, tenantId)
  return c.body(null, 204)
})

// DELETE /permissions/:permissionId
router.delete("/permissions/:permissionId", async (c) => {
  const permissionId = c.req.param("permissionId")

  await service.deletePermission(permissionId)
  return c.body(null, 204)
})
```

---

## Phase 4: Dynamic Identity Providers

**Effort: 5 days**

### Objective

Enable identity providers to be configured via database instead of code.

### Database Migration (006_identity_providers.sql)

```sql
-- Migration 006: Dynamic Identity Providers

CREATE TABLE IF NOT EXISTS identity_providers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,

    -- Provider type (matches static definitions)
    type TEXT NOT NULL CHECK (type IN (
        'oauth2', 'oidc', 'saml', 'password',
        'google', 'github', 'microsoft', 'apple', 'facebook',
        'discord', 'slack', 'spotify', 'twitch', 'x', 'yahoo',
        'linkedin', 'jumpcloud', 'keycloak', 'cognito'
    )),

    -- Identification
    name TEXT NOT NULL,               -- URL slug (e.g., "google")
    display_name TEXT NOT NULL,       -- UI label (e.g., "Sign in with Google")

    -- OAuth credentials (encrypted)
    client_id TEXT,
    client_secret_encrypted TEXT,
    client_secret_iv TEXT,
    client_secret_tag TEXT,

    -- Provider-specific config (JSON)
    config TEXT NOT NULL DEFAULT '{}',

    -- Display settings
    icon_url TEXT,
    button_color TEXT,
    display_order INTEGER DEFAULT 0,

    -- Status
    enabled INTEGER NOT NULL DEFAULT 1,

    -- Timestamps
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    created_by TEXT,
    updated_by TEXT,

    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_idp_tenant_name
    ON identity_providers(tenant_id, name);

CREATE INDEX IF NOT EXISTS idx_idp_tenant_enabled
    ON identity_providers(tenant_id, enabled);
```

### Files to Create

```
packages/openauth/src/enterprise/identity-provider/
├── index.ts           # Public exports
├── types.ts           # Types and schemas
├── service.ts         # IdentityProviderService
├── d1-adapter.ts      # D1 operations
├── factory.ts         # Create provider from config
├── loader.ts          # Dynamic loading with cache
├── cache.ts           # Cache adapters
└── api.ts             # REST API routes

packages/openauth/src/security/
└── encryption.ts      # AES-256-GCM encryption
```

### Static Provider Definitions (identity-provider/types.ts)

```typescript
export const PROVIDER_ENDPOINTS: Record<string, ProviderEndpoints> = {
  google: {
    authorization: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    jwks: "https://www.googleapis.com/oauth2/v3/certs",
  },
  github: {
    authorization: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
  },
  microsoft: {
    authorization:
      "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
  },
  apple: {
    authorization: "https://appleid.apple.com/auth/authorize",
    token: "https://appleid.apple.com/auth/token",
    jwks: "https://appleid.apple.com/auth/keys",
  },
  facebook: {
    authorization: "https://www.facebook.com/v18.0/dialog/oauth",
    token: "https://graph.facebook.com/v18.0/oauth/access_token",
  },
  discord: {
    authorization: "https://discord.com/oauth2/authorize",
    token: "https://discord.com/api/oauth2/token",
  },
  slack: {
    authorization: "https://slack.com/openid/connect/authorize",
    token: "https://slack.com/api/openid.connect.token",
  },
  spotify: {
    authorization: "https://accounts.spotify.com/authorize",
    token: "https://accounts.spotify.com/api/token",
  },
  twitch: {
    authorization: "https://id.twitch.tv/oauth2/authorize",
    token: "https://id.twitch.tv/oauth2/token",
  },
  x: {
    authorization: "https://twitter.com/i/oauth2/authorize",
    token: "https://api.twitter.com/2/oauth2/token",
  },
  yahoo: {
    authorization: "https://api.login.yahoo.com/oauth2/request_auth",
    token: "https://api.login.yahoo.com/oauth2/get_token",
  },
  linkedin: {
    authorization: "https://www.linkedin.com/oauth/v2/authorization",
    token: "https://www.linkedin.com/oauth/v2/accessToken",
  },
}

export const DEFAULT_SCOPES: Record<string, string[]> = {
  google: ["openid", "email", "profile"],
  github: ["read:user", "user:email"],
  microsoft: ["openid", "email", "profile", "User.Read"],
  apple: ["name", "email"],
  facebook: ["email", "public_profile"],
  discord: ["identify", "email"],
  slack: ["openid", "profile", "email"],
  spotify: ["user-read-email", "user-read-private"],
  twitch: ["user:read:email"],
  x: ["users.read", "tweet.read"],
  yahoo: ["openid", "profile", "email"],
  linkedin: ["openid", "profile", "email"],
}
```

### Encryption Service (security/encryption.ts)

```typescript
export interface EncryptionService {
  encrypt(plaintext: string): Promise<EncryptedValue>
  decrypt(encrypted: EncryptedValue): Promise<string>
}

export interface EncryptedValue {
  ciphertext: string
  iv: string
  tag: string
}

export function createEncryptionService(
  masterKey: Uint8Array,
): EncryptionService {
  if (masterKey.length !== 32) {
    throw new Error("Master key must be 256 bits (32 bytes)")
  }

  return {
    async encrypt(plaintext: string): Promise<EncryptedValue> {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const encoder = new TextEncoder()

      const key = await crypto.subtle.importKey(
        "raw",
        masterKey,
        { name: "AES-GCM" },
        false,
        ["encrypt"],
      )

      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoder.encode(plaintext),
      )

      const arr = new Uint8Array(encrypted)
      return {
        ciphertext: btoa(String.fromCharCode(...arr.slice(0, -16))),
        iv: btoa(String.fromCharCode(...iv)),
        tag: btoa(String.fromCharCode(...arr.slice(-16))),
      }
    },

    async decrypt(encrypted: EncryptedValue): Promise<string> {
      const iv = Uint8Array.from(atob(encrypted.iv), (c) => c.charCodeAt(0))
      const ciphertext = Uint8Array.from(atob(encrypted.ciphertext), (c) =>
        c.charCodeAt(0),
      )
      const tag = Uint8Array.from(atob(encrypted.tag), (c) => c.charCodeAt(0))

      const combined = new Uint8Array(ciphertext.length + tag.length)
      combined.set(ciphertext)
      combined.set(tag, ciphertext.length)

      const key = await crypto.subtle.importKey(
        "raw",
        masterKey,
        { name: "AES-GCM" },
        false,
        ["decrypt"],
      )

      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        combined,
      )

      return new TextDecoder().decode(decrypted)
    },
  }
}
```

### Provider Factory (identity-provider/factory.ts)

```typescript
import { Oauth2Provider, OidcProvider } from "../../provider"
import { PROVIDER_ENDPOINTS, DEFAULT_SCOPES } from "./types"

export function createProviderFromConfig(input: ProviderConfig): Provider {
  const { type, name, client_id, client_secret, config } = input

  // Pre-configured providers (Google, GitHub, etc.)
  if (type in PROVIDER_ENDPOINTS) {
    return Oauth2Provider({
      type,
      clientID: client_id,
      clientSecret: client_secret,
      endpoint: PROVIDER_ENDPOINTS[type],
      scopes: config.scopes || DEFAULT_SCOPES[type] || [],
      query: config.query,
      pkce: config.pkce,
    })
  }

  // Generic OAuth2
  if (type === "oauth2") {
    if (!config.endpoint) {
      throw new Error("OAuth2 requires endpoint configuration")
    }
    return Oauth2Provider({
      type: name,
      clientID: client_id,
      clientSecret: client_secret,
      endpoint: config.endpoint,
      scopes: config.scopes || [],
      query: config.query,
      pkce: config.pkce,
    })
  }

  // Generic OIDC
  if (type === "oidc") {
    if (!config.issuer) {
      throw new Error("OIDC requires issuer URL")
    }
    return OidcProvider({
      type: name,
      clientID: client_id,
      issuer: config.issuer,
      scopes: config.scopes,
      query: config.query,
    })
  }

  throw new Error(`Unsupported provider type: ${type}`)
}
```

### Dynamic Loader with Caching (identity-provider/loader.ts)

```typescript
export function createDynamicProviderLoader(
  config: LoaderConfig,
): DynamicProviderLoader {
  const cache = new Map<string, CacheEntry>()
  const TTL = config.cacheTTL || 60_000 // 1 minute

  return {
    async getProviders(tenantId: string): Promise<Map<string, Provider>> {
      const now = Date.now()
      const cached = cache.get(tenantId)

      if (cached && now - cached.loadedAt < TTL) {
        return cached.providers
      }

      // Load from database
      const providers = new Map<string, Provider>()

      // Static providers first (can be overridden)
      if (config.staticProviders) {
        for (const [name, provider] of Object.entries(config.staticProviders)) {
          providers.set(name, provider)
        }
      }

      // Dynamic providers from DB
      const dbProviders =
        await config.service.listProvidersWithSecrets(tenantId)
      for (const p of dbProviders) {
        if (!p.enabled) continue
        try {
          providers.set(
            p.name,
            createProviderFromConfig({
              type: p.type,
              name: p.name,
              client_id: p.client_id,
              client_secret: p.client_secret_decrypted,
              config: JSON.parse(p.config),
            }),
          )
        } catch (err) {
          console.error(`Failed to load provider ${p.name}:`, err)
        }
      }

      cache.set(tenantId, { providers, loadedAt: now })
      return providers
    },

    invalidate(tenantId: string): void {
      cache.delete(tenantId)
    },
  }
}
```

### API Routes (identity-provider/api.ts)

```typescript
export function createIdentityProviderRoutes(
  service: IdentityProviderService,
): Hono {
  const app = new Hono()

  // GET /api/providers
  app.get("/", async (c) => {
    const tenantId = c.get("tenantId")
    const providers = await service.listProviders(tenantId)
    return c.json({ providers: providers.map(maskSecrets) })
  })

  // POST /api/providers
  app.post("/", async (c) => {
    const tenantId = c.get("tenantId")
    const body = await c.req.json()

    const provider = await service.createProvider(tenantId, body)
    return c.json({ provider: maskSecrets(provider) }, 201)
  })

  // GET /api/providers/:id
  app.get("/:id", async (c) => {
    const tenantId = c.get("tenantId")
    const id = c.req.param("id")

    const provider = await service.getProvider(tenantId, id)
    if (!provider) return c.json({ error: "Not found" }, 404)

    return c.json({ provider: maskSecrets(provider) })
  })

  // PATCH /api/providers/:id
  app.patch("/:id", async (c) => {
    const tenantId = c.get("tenantId")
    const id = c.req.param("id")
    const body = await c.req.json()

    const provider = await service.updateProvider(tenantId, id, body)
    service.invalidateCache(tenantId)

    return c.json({ provider: maskSecrets(provider) })
  })

  // DELETE /api/providers/:id
  app.delete("/:id", async (c) => {
    const tenantId = c.get("tenantId")
    const id = c.req.param("id")

    await service.deleteProvider(tenantId, id)
    service.invalidateCache(tenantId)

    return c.body(null, 204)
  })

  return app
}

function maskSecrets(p: IdentityProvider): IdentityProviderOutput {
  return {
    ...p,
    client_id: p.client_id,
    has_client_secret: !!p.client_secret_encrypted,
    client_secret_encrypted: undefined,
    client_secret_iv: undefined,
    client_secret_tag: undefined,
  }
}
```

---

## Phase 5: Scope-Based Authorization

**Effort: 1 day**

### Objective

Create middleware to validate scopes on Admin API requests.

### Scope Definitions

```typescript
export const ADMIN_SCOPES = {
  // Users
  "users:read": "Read user information",
  "users:write": "Create and update users",
  "users:delete": "Delete users",

  // Roles
  "roles:read": "Read roles",
  "roles:write": "Create and update roles",
  "roles:delete": "Delete roles",

  // Permissions
  "permissions:read": "Read permissions",
  "permissions:write": "Create and delete permissions",

  // Providers
  "providers:read": "Read identity providers",
  "providers:write": "Manage identity providers",

  // Clients
  "clients:read": "Read OAuth clients",
  "clients:write": "Manage OAuth clients",

  // Sessions
  "sessions:read": "Read sessions",
  "sessions:revoke": "Revoke sessions",

  // Admin (superscope)
  admin: "Full admin access",
} as const
```

### Middleware (middleware/scope-auth.ts)

```typescript
import type { Context, Next } from "hono"

export function requireScopes(...requiredScopes: string[]) {
  return async (c: Context, next: Next) => {
    const tokenScopes = (c.get("scopes") as string[]) || []

    // Check for admin superscope
    if (tokenScopes.includes("admin")) {
      await next()
      return
    }

    // Check specific scopes
    const hasAll = requiredScopes.every((s) => tokenScopes.includes(s))
    if (!hasAll) {
      return c.json(
        {
          error: "insufficient_scope",
          error_description: `Required scopes: ${requiredScopes.join(", ")}`,
        },
        403,
      )
    }

    await next()
  }
}

// Usage in routes
app.get("/api/users", requireScopes("users:read"), handler)
app.post("/api/users", requireScopes("users:write"), handler)
app.delete("/api/users/:id", requireScopes("users:delete"), handler)
```

### Token Scope Extraction Middleware

```typescript
export function extractScopes() {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing authorization" }, 401)
    }

    const token = authHeader.slice(7)
    const payload = await verifyToken(token)

    // Extract scopes from token
    const scopes = payload.scope?.split(" ") || []
    c.set("scopes", scopes)
    c.set("tokenPayload", payload)

    // Set context based on token type
    if (payload.mode === "m2m") {
      c.set("clientId", payload.client_id)
      c.set("tenantId", payload.tenant_id)
    } else {
      c.set("userId", payload.sub)
      c.set("tenantId", payload.properties?.tenantId)
    }

    await next()
  }
}
```

---

## Phase 6: Security & Audit

**Effort: 2 days**

### Objective

Add secret encryption and audit logging for admin operations.

### Audit Log Schema

```sql
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,

    -- Actor
    actor_type TEXT NOT NULL,         -- 'user', 'client', 'system'
    actor_id TEXT NOT NULL,

    -- Action
    action TEXT NOT NULL,             -- 'user.create', 'role.delete', etc.
    resource_type TEXT NOT NULL,
    resource_id TEXT,

    -- Details
    details TEXT,                     -- JSON with before/after state
    ip_address TEXT,
    user_agent TEXT,

    -- Timestamp
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant_time
    ON audit_log(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_actor
    ON audit_log(actor_type, actor_id);

CREATE INDEX IF NOT EXISTS idx_audit_resource
    ON audit_log(resource_type, resource_id);
```

### Audit Service

```typescript
export interface AuditService {
  log(event: AuditEvent): Promise<void>
  query(params: AuditQueryParams): Promise<AuditLogEntry[]>
}

export interface AuditEvent {
  tenantId: string
  actorType: "user" | "client" | "system"
  actorId: string
  action: string
  resourceType: string
  resourceId?: string
  details?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
}

export function createAuditService(db: D1Database): AuditService {
  return {
    async log(event: AuditEvent): Promise<void> {
      await db
        .prepare(
          `
          INSERT INTO audit_log
          (id, tenant_id, actor_type, actor_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .bind(
          crypto.randomUUID(),
          event.tenantId,
          event.actorType,
          event.actorId,
          event.action,
          event.resourceType,
          event.resourceId || null,
          event.details ? JSON.stringify(event.details) : null,
          event.ipAddress || null,
          event.userAgent || null,
          Date.now(),
        )
        .run()
    },

    async query(params: AuditQueryParams): Promise<AuditLogEntry[]> {
      // Implementation
    },
  }
}
```

### Audit Middleware

```typescript
export function auditMiddleware(auditService: AuditService) {
  return async (c: Context, next: Next) => {
    await next()

    // Only audit mutating operations
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
      return
    }

    const path = c.req.path
    const method = c.req.method

    // Parse resource from path
    const match = path.match(/\/api\/(\w+)(?:\/([^/]+))?/)
    if (!match) return

    const [, resourceType, resourceId] = match
    const action = `${resourceType}.${methodToAction(method)}`

    await auditService.log({
      tenantId: c.get("tenantId"),
      actorType: c.get("tokenPayload")?.mode === "m2m" ? "client" : "user",
      actorId: c.get("clientId") || c.get("userId"),
      action,
      resourceType,
      resourceId,
      ipAddress:
        c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For"),
      userAgent: c.req.header("User-Agent"),
    })
  }
}

function methodToAction(method: string): string {
  switch (method) {
    case "POST":
      return "create"
    case "PUT":
      return "update"
    case "PATCH":
      return "update"
    case "DELETE":
      return "delete"
    default:
      return method.toLowerCase()
  }
}
```

---

## Summary

| Phase | Deliverables            | Files              | Tests    |
| ----- | ----------------------- | ------------------ | -------- |
| 1     | M2M token endpoint      | 3 new              | 5 tests  |
| 2     | User CRUD + auto-create | 5 new, 1 migration | 10 tests |
| 3     | Complete RBAC APIs      | 2 modified         | 5 tests  |
| 4     | Dynamic providers       | 8 new, 1 migration | 10 tests |
| 5     | Scope authorization     | 2 new              | 5 tests  |
| 6     | Encryption + Audit      | 3 new, 1 migration | 5 tests  |

**Total: ~15 days of implementation**
