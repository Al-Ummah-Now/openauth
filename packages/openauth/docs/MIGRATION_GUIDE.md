# OpenAuth Enterprise Migration Guide

## Overview

This guide helps you migrate from basic OpenAuth to OpenAuth Enterprise, which adds:

- Multi-account browser sessions (up to 3 accounts)
- Multi-tenant white-label support
- Role-based access control (RBAC)
- Enhanced OIDC compliance

The migration is designed to be **backward compatible** - existing implementations continue to work without modifications, and enterprise features can be adopted incrementally.

---

## Table of Contents

1. [Migration Strategies](#migration-strategies)
2. [Prerequisites](#prerequisites)
3. [Step-by-Step Migration](#step-by-step-migration)
4. [Feature-by-Feature Adoption](#feature-by-feature-adoption)
5. [Breaking Changes](#breaking-changes)
6. [Configuration Changes](#configuration-changes)
7. [Database Migrations](#database-migrations)
8. [Testing Your Migration](#testing-your-migration)
9. [Rollback Procedures](#rollback-procedures)

---

## Migration Strategies

### Strategy 1: Full Enterprise Migration

Adopt all enterprise features at once. Best for:

- New deployments
- Complete rewrites
- Applications requiring all enterprise features immediately

### Strategy 2: Incremental Adoption

Adopt features one at a time. Best for:

- Existing production systems
- Risk-averse migrations
- Teams learning enterprise features

### Strategy 3: Feature Flagged Migration

Deploy enterprise code but enable features gradually via configuration. Best for:

- Large-scale deployments
- A/B testing new features
- Gradual rollout to user segments

---

## Prerequisites

### 1. Node.js and Runtime Requirements

- Node.js 18+ (or Bun 1.0+, Deno 1.40+)
- For Cloudflare Workers: wrangler 3.0+

### 2. Database Requirements

**For RBAC** (optional):

- Cloudflare D1 database
- Run RBAC schema migration (004_rbac_schema.sql)

**For Tenant Management** (optional):

- Cloudflare D1 database
- Run tenant schema migration (002_add_tenant_support.sql)

### 3. Environment Variables

Add these new environment variables:

```bash
# Required for session encryption (256-bit key as hex)
SESSION_SECRET=your-64-character-hex-string-here

# Optional: D1 database binding name
D1_DATABASE=DB

# Optional: Default tenant ID for non-enterprise mode
DEFAULT_TENANT_ID=default
```

### 4. Generate Session Secret

```bash
# Using OpenSSL
openssl rand -hex 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Step-by-Step Migration

### Step 1: Update Dependencies

Ensure you have the latest OpenAuth version:

```bash
npm update @openauthjs/openauth
```

### Step 2: Create Database Schema

If using D1 database for enterprise features:

```bash
# Create D1 database (if not exists)
wrangler d1 create openauth-db

# Apply migrations in order
wrangler d1 execute openauth-db --file=./src/migrations/001_oauth_clients.sql
wrangler d1 execute openauth-db --file=./src/migrations/002_add_tenant_support.sql
wrangler d1 execute openauth-db --file=./src/migrations/003_session_management.sql
wrangler d1 execute openauth-db --file=./src/migrations/004_rbac_schema.sql
```

For local development:

```bash
wrangler d1 execute openauth-db --local --file=./src/migrations/001_oauth_clients.sql
# ... repeat for other migrations
```

### Step 3: Update Your Issuer

**Before (Basic OpenAuth):**

```typescript
import { issuer } from "@openauthjs/openauth"
import { GoogleProvider } from "@openauthjs/openauth/provider/google"
import { createSubjects } from "@openauthjs/openauth/subject"

const subjects = createSubjects({
  user: object({
    userId: string(),
    email: string(),
  }),
})

export default issuer({
  storage,
  providers: {
    google: GoogleProvider({ ... }),
  },
  subjects,
  success: async (ctx, value) => {
    const userId = await findOrCreateUser(value)
    return ctx.subject("user", {
      userId,
      email: value.email,
    })
  },
})
```

**After (Enterprise OpenAuth):**

```typescript
import { createMultiTenantIssuer, hexToSecret } from "@openauthjs/openauth/enterprise"
import { createTenantService } from "@openauthjs/openauth/tenant"
import { SessionServiceImpl } from "@openauthjs/openauth/session"
import { RBACServiceImpl, RBACAdapter } from "@openauthjs/openauth/rbac"
import { GoogleProvider } from "@openauthjs/openauth/provider/google"
import { createSubjects } from "@openauthjs/openauth/subject"

// Extended subject schema with enterprise fields
const subjects = createSubjects({
  user: object({
    userId: string(),
    email: string(),
    tenantId: string(),        // NEW: Tenant context
    roles: array(string()),     // NEW: RBAC roles
    permissions: array(string()),  // NEW: RBAC permissions
  }),
})

// Initialize enterprise services
const tenantService = createTenantService(storage, d1Database)
const sessionService = new SessionServiceImpl(storage)
const rbacAdapter = new RBACAdapter(d1Database)
const rbacService = new RBACServiceImpl(rbacAdapter, storage)

const { app } = createMultiTenantIssuer({
  tenantService,
  sessionService,
  rbacService,
  storage,
  sessionSecret: hexToSecret(env.SESSION_SECRET),
  providers: {
    google: GoogleProvider({ ... }),
  },
  subjects,
  tenantResolver: {
    baseDomain: "auth.example.com",
  },
  onSuccess: async (ctx, value, tenant) => {
    const userId = await findOrCreateUser(value, tenant.id)
    return ctx.subject("user", {
      userId,
      email: value.email,
      tenantId: tenant.id,       // NEW
      roles: value.roles,        // NEW
      permissions: value.permissions,  // NEW
    })
  },
})

export default app
```

### Step 4: Create Default Tenant (If Required)

For existing users, create a default tenant:

```typescript
// Migration script
import { createTenantService } from "@openauthjs/openauth/tenant"

async function createDefaultTenant() {
  const tenantService = createTenantService(storage, d1Database)

  try {
    await tenantService.createTenant({
      id: "default",
      name: "Default Tenant",
      settings: {
        allowPublicRegistration: true,
      },
    })
    console.log("Default tenant created")
  } catch (error) {
    if (error.code === "invalid_tenant_id") {
      console.log("Default tenant already exists")
    } else {
      throw error
    }
  }
}
```

### Step 5: Update Client Applications

Update client applications to handle new token claims:

**Before:**

```typescript
interface UserToken {
  sub: string
  userId: string
  email: string
}
```

**After:**

```typescript
interface UserToken {
  sub: string
  userId: string
  email: string
  tenantId: string // NEW
  roles: string[] // NEW
  permissions: string[] // NEW
}
```

### Step 6: Update Session Handling (Optional)

If using the enterprise session features, update your app to use the new session endpoints:

```typescript
// List logged-in accounts
const accounts = await fetch("/session/accounts", {
  credentials: "include",
}).then((r) => r.json())

// Switch account
await fetch("/session/switch", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: "other-user-id" }),
})

// Sign out one account
await fetch(`/session/accounts/${userId}`, {
  method: "DELETE",
  credentials: "include",
})

// Sign out all accounts
await fetch("/session/all", {
  method: "DELETE",
  credentials: "include",
})
```

---

## Feature-by-Feature Adoption

### Adopting Session Management Only

If you only need multi-account sessions:

```typescript
import { issuer } from "@openauthjs/openauth"
import { SessionServiceImpl, createSessionMiddleware } from "@openauthjs/openauth/session"

// Create session service
const sessionService = new SessionServiceImpl(storage)

// Create basic issuer
const app = issuer({
  storage,
  providers: { ... },
  subjects,
  success: async (ctx, value) => { ... },
})

// Add session middleware
app.use("*", createSessionMiddleware(sessionService, sessionSecret))

// Add session routes
app.route("/session", sessionRoutes(sessionService))
```

### Adopting Multi-Tenancy Only

If you only need tenant isolation:

```typescript
import { issuer } from "@openauthjs/openauth"
import { createTenantService, createTenantResolver } from "@openauthjs/openauth/tenant"

// Create tenant service
const tenantService = createTenantService(storage, d1Database)

// Create basic issuer
const app = issuer({
  storage,
  providers: { ... },
  subjects,
  success: async (ctx, value) => { ... },
})

// Add tenant resolver
app.use("*", createTenantResolver({
  service: tenantService,
  storage,
  config: { baseDomain: "auth.example.com" },
}))

// Add tenant API routes
app.route("/tenants", tenantApiRoutes(tenantService))
```

### Adopting RBAC Only

If you only need role-based access control:

```typescript
import { issuer } from "@openauthjs/openauth"
import { RBACServiceImpl, RBACAdapter, enrichTokenWithRBAC } from "@openauthjs/openauth/rbac"

// Create RBAC service
const rbacAdapter = new RBACAdapter(d1Database)
const rbacService = new RBACServiceImpl(rbacAdapter, storage)

// Create issuer with RBAC enrichment
const app = issuer({
  storage,
  providers: { ... },
  subjects,
  success: async (ctx, value) => {
    // Enrich with RBAC claims
    const rbacClaims = await rbacService.enrichTokenClaims({
      userId: value.userID,
      appId: ctx.get("clientId") || "default",
      tenantId: "default",
    })

    return ctx.subject("user", {
      userId: value.userID,
      email: value.email,
      roles: rbacClaims.roles,
      permissions: rbacClaims.permissions,
    })
  },
})

// Add RBAC routes
app.route("/rbac", rbacEndpoints(rbacService))
app.route("/rbac/admin", rbacAdminEndpoints(rbacService))
```

---

## Breaking Changes

### No Breaking Changes in Core Functionality

The enterprise features are **additive** - existing OpenAuth functionality remains unchanged. You can:

- Continue using the basic `issuer()` function
- Continue using existing providers
- Continue using existing storage adapters

### Optional Breaking Changes When Adopting Enterprise

If you adopt enterprise features, these changes may affect your application:

#### 1. Token Payload Changes

**Impact**: Token payload may include additional claims
**Migration**: Update token validation to expect optional `tenantId`, `roles`, `permissions` fields

```typescript
// Old token
{ "sub": "user:123", "userId": "123", "email": "user@example.com" }

// New token (with enterprise)
{
  "sub": "user:123",
  "userId": "123",
  "email": "user@example.com",
  "tenantId": "default",
  "roles": ["user"],
  "permissions": ["read"]
}
```

#### 2. Cookie Name Change (If Using Sessions)

**Impact**: Session cookie name changes from provider-specific to unified `__session`
**Migration**: Update CORS and cookie policies if needed

#### 3. URL Structure Change (If Using Tenant Paths)

**Impact**: URLs may include tenant prefix
**Migration**: Update client redirect URIs if using path-based tenant resolution

```
// Before
https://auth.example.com/authorize

// After (with path-based tenants)
https://auth.example.com/tenants/my-tenant/authorize
```

---

## Configuration Changes

### New Configuration Options

| Option                                 | Type         | Default       | Description                          |
| -------------------------------------- | ------------ | ------------- | ------------------------------------ |
| `sessionSecret`                        | `Uint8Array` | Required      | 256-bit key for session encryption   |
| `sessionConfig.maxAccountsPerSession`  | `number`     | 3             | Max accounts per browser             |
| `sessionConfig.sessionLifetimeSeconds` | `number`     | 604800        | Session lifetime (7 days)            |
| `sessionConfig.slidingWindowSeconds`   | `number`     | 86400         | Sliding window (1 day)               |
| `sessionConfig.cookieName`             | `string`     | `__session`   | Session cookie name                  |
| `rbacConfig.maxPermissionsInToken`     | `number`     | 50            | Max permissions in JWT               |
| `rbacConfig.permissionCacheTTL`        | `number`     | 60            | Permission cache TTL (seconds)       |
| `tenantResolver.baseDomain`            | `string`     | -             | Base domain for subdomain resolution |
| `tenantResolver.headerName`            | `string`     | `X-Tenant-ID` | Header for tenant resolution         |

### Environment Variable Changes

**New Required Variables:**

```bash
# Session encryption key (64 hex characters = 256 bits)
SESSION_SECRET=abcdef0123456789...

# Optional: Override default tenant
DEFAULT_TENANT_ID=default
```

### Cloudflare Workers Binding Changes

If using D1 for RBAC/Tenants, add to `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "openauth-db"
database_id = "your-database-id"
```

---

## Database Migrations

### Migration Order

Migrations must be run in order due to table dependencies:

```
001_oauth_clients.sql     (Foundation)
        |
        v
002_add_tenant_support.sql (Tenants, adds tenant_id to clients)
        |
        +----------------+
        |                |
        v                v
003_session_management.sql  004_rbac_schema.sql
```

### Running Migrations

**Production:**

```bash
wrangler d1 execute openauth-db --file=./src/migrations/001_oauth_clients.sql
wrangler d1 execute openauth-db --file=./src/migrations/002_add_tenant_support.sql
wrangler d1 execute openauth-db --file=./src/migrations/003_session_management.sql
wrangler d1 execute openauth-db --file=./src/migrations/004_rbac_schema.sql
```

**Local Development:**

```bash
wrangler d1 execute openauth-db --local --file=./src/migrations/001_oauth_clients.sql
wrangler d1 execute openauth-db --local --file=./src/migrations/002_add_tenant_support.sql
wrangler d1 execute openauth-db --local --file=./src/migrations/003_session_management.sql
wrangler d1 execute openauth-db --local --file=./src/migrations/004_rbac_schema.sql
```

### Verify Migration Success

```bash
# List all tables
wrangler d1 execute openauth-db --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"

# Expected tables:
# - oauth_clients
# - tenants
# - browser_sessions
# - account_sessions
# - rbac_apps
# - rbac_roles
# - rbac_permissions
# - rbac_role_permissions
# - rbac_user_roles
```

### Data Migration for Existing Users

If you have existing users, you may need to:

1. **Create default tenant:**

```sql
INSERT INTO tenants (id, name, status, branding, settings, created_at, updated_at)
VALUES (
  'default',
  'Default Tenant',
  'active',
  '{}',
  '{"allowPublicRegistration": true}',
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000
);
```

2. **Update existing clients with tenant:**

```sql
UPDATE oauth_clients
SET tenant_id = 'default'
WHERE tenant_id IS NULL;
```

3. **Create default roles:**

```sql
INSERT INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES
  ('role-admin', 'admin', 'default', 'Administrator', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
  ('role-user', 'user', 'default', 'Regular User', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);
```

---

## Testing Your Migration

### 1. Unit Tests

Add tests for enterprise features:

```typescript
import { describe, it, expect } from "vitest"
import { SessionServiceImpl } from "@openauthjs/openauth/session"
import { MemoryStorage } from "@openauthjs/openauth/storage/memory"

describe("Session Service", () => {
  it("should create browser session", async () => {
    const storage = MemoryStorage()
    const service = new SessionServiceImpl(storage)

    const session = await service.createBrowserSession({
      tenantId: "test-tenant",
      userAgent: "test",
      ipAddress: "127.0.0.1",
    })

    expect(session.id).toBeDefined()
    expect(session.tenant_id).toBe("test-tenant")
  })

  it("should enforce max accounts limit", async () => {
    const storage = MemoryStorage()
    const service = new SessionServiceImpl(storage, {
      maxAccountsPerSession: 2,
    })

    const session = await service.createBrowserSession({
      tenantId: "test-tenant",
      userAgent: "test",
      ipAddress: "127.0.0.1",
    })

    // Add 2 accounts (should succeed)
    await service.addAccountToSession({
      browserSessionId: session.id,
      userId: "user-1",
      subjectType: "user",
      subjectProperties: {},
      refreshToken: "token-1",
      clientId: "client",
      ttl: 3600,
    })

    await service.addAccountToSession({
      browserSessionId: session.id,
      userId: "user-2",
      subjectType: "user",
      subjectProperties: {},
      refreshToken: "token-2",
      clientId: "client",
      ttl: 3600,
    })

    // Add 3rd account (should fail)
    await expect(
      service.addAccountToSession({
        browserSessionId: session.id,
        userId: "user-3",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "token-3",
        clientId: "client",
        ttl: 3600,
      }),
    ).rejects.toThrow("max_accounts_exceeded")
  })
})
```

### 2. Integration Tests

Test the full enterprise flow:

```typescript
import { describe, it, expect } from "vitest"
import { createMultiTenantIssuer, hexToSecret } from "@openauthjs/openauth/enterprise"

describe("Enterprise Issuer", () => {
  it("should resolve tenant from subdomain", async () => {
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret: hexToSecret("0".repeat(64)),
      providers: { ... },
      subjects,
      tenantResolver: {
        baseDomain: "auth.example.com",
      },
    })

    const req = new Request("https://acme.auth.example.com/session/check")
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tenantId).toBe("acme")
  })
})
```

### 3. Manual Testing Checklist

- [ ] Create tenant via API
- [ ] Login creates browser session
- [ ] Session cookie is encrypted
- [ ] Add second account works
- [ ] Switch account works
- [ ] Sign out one account works
- [ ] Sign out all accounts works
- [ ] Admin can revoke sessions
- [ ] RBAC permissions are in token
- [ ] Tenant branding is applied
- [ ] Cross-app SSO works

---

## Rollback Procedures

### Quick Rollback (Config-Based)

If issues arise, you can quickly disable enterprise features without code changes:

```typescript
// Set feature flags
const ENABLE_ENTERPRISE = false

// Use conditional exports
export default ENABLE_ENTERPRISE
  ? createMultiTenantIssuer({ ... })
  : issuer({ ... })
```

### Full Rollback

1. **Revert code changes:**

```bash
git revert <enterprise-commit>
```

2. **Database is backward compatible:**

- New tables/columns don't affect basic operation
- No need to rollback migrations

3. **Clear session cookies:**

- Users may need to log in again
- Session cookies from enterprise won't work with basic issuer

### Database Rollback (If Needed)

Only if you need to completely remove enterprise tables:

```sql
-- Rollback RBAC
DROP VIEW IF EXISTS user_permissions;
DROP TABLE IF EXISTS rbac_user_roles;
DROP TABLE IF EXISTS rbac_role_permissions;
DROP TABLE IF EXISTS rbac_permissions;
DROP TABLE IF EXISTS rbac_roles;
DROP TABLE IF EXISTS rbac_apps;

-- Rollback Sessions
DROP VIEW IF EXISTS expired_sessions;
DROP TABLE IF EXISTS account_sessions;
DROP TABLE IF EXISTS browser_sessions;

-- Rollback Tenants
DROP INDEX IF EXISTS idx_oauth_clients_tenant;
DROP TABLE IF EXISTS tenants;
```

---

## Troubleshooting

### Common Issues

#### 1. "sessionSecret must be a 256-bit Uint8Array"

**Cause:** Invalid session secret format

**Solution:** Generate proper secret:

```bash
openssl rand -hex 32
```

Use with `hexToSecret()`:

```typescript
sessionSecret: hexToSecret(process.env.SESSION_SECRET!)
```

#### 2. "Tenant not found"

**Cause:** Tenant resolution failed

**Solution:**

- Check tenant exists in database
- Verify tenant resolver config matches your domain setup
- Create default tenant for existing users

#### 3. "max_accounts_exceeded"

**Cause:** Trying to add more accounts than allowed

**Solution:**

- Sign out an existing account first
- Or increase `maxAccountsPerSession` in config

#### 4. Session cookie not being set

**Cause:** Cookie security attributes blocking

**Solution:**

- Ensure HTTPS in production
- Check SameSite/Domain settings match your setup
- Verify no cookie-blocking extensions

#### 5. RBAC permissions empty in token

**Cause:** User has no roles assigned

**Solution:**

- Assign default role to users
- Check `rbac_user_roles` table has entries
- Verify role has permissions assigned

---

## Support

For additional help:

- **Documentation:** See [ENTERPRISE_FEATURES.md](./ENTERPRISE_FEATURES.md)
- **Architecture:** See [ARCHITECTURE_PLAN.md](./ARCHITECTURE_PLAN.md)
- **Migrations:** See [src/migrations/README.md](../src/migrations/README.md)
- **Issues:** Open an issue on GitHub
