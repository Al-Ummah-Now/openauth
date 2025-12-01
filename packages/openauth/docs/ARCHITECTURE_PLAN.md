# AlUmmahNow Identity Platform - Architecture Plan

## Executive Summary

This document outlines the comprehensive architecture for extending OpenAuth to support enterprise SSO features including multi-account sessions, multi-tenant white-label deployment, and role-based access control.

---

## Current OpenAuth Architecture Analysis

### What Already Exists

1. **Session Management**
   - Cookie-based state storage using encrypted JWE tokens
   - Refresh tokens stored in storage adapter under `["oauth:refresh", subject, tokenId]`
   - Configurable TTLs for access/refresh tokens

2. **Client Registration**
   - D1 adapter with full CRUD for OAuth clients
   - Client authenticator with PBKDF2-SHA256 hashing
   - Support for public and confidential clients

3. **Token Architecture**
   - JWTs signed with ES256 (ECDSA)
   - JWKS endpoint at `/.well-known/jwks.json`
   - Token verification via jose library

4. **Storage Layer**
   - `StorageAdapter` interface with get/set/remove/scan
   - Adapters: DynamoDB, Cloudflare KV, Memory

5. **Provider System**
   - Extensible provider interface
   - OAuth2/OIDC, Password, Code providers

6. **Revocation Service**
   - RFC 7009 token revocation
   - Access token revocation via JTI tracking

### Gaps for Enterprise SSO

| Feature            | Current State | Required                     |
| ------------------ | ------------- | ---------------------------- |
| Session Database   | Cookie-only   | Server-side session store    |
| Session Listing    | None          | Enumerate active sessions    |
| Session Revocation | None          | Invalidate specific sessions |
| Multi-Account      | None          | Up to 3 accounts per browser |
| Tenant Management  | None          | Full tenant CRUD             |
| RBAC               | None          | Roles, permissions, claims   |
| prompt Parameter   | None          | none, login, select_account  |

---

## Architecture Components

### 1. Session Service

**Storage Keys (KV Pattern):**

```
session:browser/{tenant_id}/{browser_session_id}    - Browser session
session:account/{browser_session_id}/{user_id}      - Account session
session:user/{tenant_id}/{user_id}/{browser_session_id} - User index
```

**Data Structures:**

```typescript
interface BrowserSession {
  id: string
  tenant_id: string
  created_at: number
  last_activity: number
  user_agent: string
  ip_address: string
  version: number
  active_user_id: string | null
  account_user_ids: string[]
}

interface AccountSession {
  id: string
  browser_session_id: string
  user_id: string
  is_active: boolean
  authenticated_at: number
  expires_at: number
  subject_type: string
  subject_properties: Record<string, unknown>
  refresh_token: string
  client_id: string
}
```

**Cookie Structure:**

```typescript
interface SessionCookiePayload {
  sid: string // Browser session ID
  tid: string // Tenant ID
  v: number // Version (optimistic concurrency)
  iat: number // Issued at
}
```

### 2. Multi-Tenant Architecture

**Tenant Resolution Priority:**

1. Custom Domain (auth.clientcorp.com)
2. Subdomain (clientcorp.auth.example.com)
3. Path Prefix (/tenants/{tenantId}/\*)
4. HTTP Header (X-Tenant-ID)
5. Query Parameter (?tenant={tenantId})

**Storage Key Prefixing:**

```
t:{tenantId}:oauth:code:{code}
t:{tenantId}:oauth:refresh:{subject}:{token}
t:{tenantId}:client:{clientId}
```

**Tenant Data Model:**

```typescript
interface Tenant {
  id: string
  domain?: string
  name: string
  status: "active" | "suspended" | "pending" | "deleted"
  branding: TenantBranding
  settings: TenantSettings
  createdAt: number
  updatedAt: number
}

interface TenantBranding {
  theme?: Partial<Theme>
  logoLight?: string
  logoDark?: string
  favicon?: string
  customCss?: string
  emailTemplates?: EmailTemplateConfig
}
```

### 3. RBAC System

**Database Schema:**

```sql
rbac_roles (id, name, tenant_id, description, is_system_role)
rbac_permissions (id, name, app_id, description, resource, action)
rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
rbac_user_roles (user_id, role_id, tenant_id, assigned_at, expires_at)
rbac_apps (id, name, tenant_id, description)
```

**Token Claims:**

```json
{
  "sub": "user_123",
  "aud": "app-a",
  "roles": ["editor"],
  "permissions": ["articles:read", "articles:write"]
}
```

---

## API Endpoints

### Session APIs

```
GET    /session/accounts           - List logged-in accounts
POST   /session/switch             - Switch active account
DELETE /session/accounts/:userId   - Sign out one account
DELETE /session/all                - Sign out all accounts
GET    /session/check              - Silent session check (CORS enabled)
```

### Admin Session APIs

```
POST   /admin/sessions/revoke-user   - Revoke all user sessions
POST   /admin/sessions/revoke        - Revoke specific session
```

### Tenant APIs

```
POST   /tenants                      - Create tenant
GET    /tenants                      - List tenants
GET    /tenants/:id                  - Get tenant
PUT    /tenants/:id                  - Update tenant
DELETE /tenants/:id                  - Delete tenant
PUT    /tenants/:id/branding         - Update branding
PUT    /tenants/:id/settings         - Update settings
POST   /tenants/:id/domain/verify    - Verify custom domain
```

### RBAC APIs

```
POST   /rbac/check                   - Check single permission
POST   /rbac/check/batch             - Check multiple permissions
GET    /rbac/permissions             - Get user permissions for app
GET    /rbac/roles                   - Get user roles
```

### RBAC Admin APIs

```
POST   /rbac/admin/apps              - Create app
GET    /rbac/admin/apps              - List apps
POST   /rbac/admin/roles             - Create role
GET    /rbac/admin/roles             - List roles
POST   /rbac/admin/permissions       - Create permission
POST   /rbac/admin/users/:id/roles   - Assign role to user
```

---

## File Structure

```
packages/openauth/src/
├── session/
│   ├── types.ts           # Session data types
│   ├── cookie.ts          # Cookie management
│   ├── service.ts         # SessionService class
│   ├── routes.ts          # Session API endpoints
│   ├── integration.ts     # Issuer integration
│   └── index.ts           # Public exports
├── tenant/
│   ├── types.ts           # Tenant data types
│   ├── resolver.ts        # Tenant resolution middleware
│   ├── storage.ts         # Tenant-scoped storage
│   ├── service.ts         # TenantService class
│   ├── api.ts             # Tenant API endpoints
│   ├── theme.ts           # Tenant theming
│   ├── issuer.ts          # Multi-tenant issuer factory
│   └── index.ts           # Public exports
├── rbac/
│   ├── types.ts           # RBAC data types
│   ├── d1-rbac-adapter.ts # D1 storage adapter
│   ├── token-enricher.ts  # Token claim enrichment
│   ├── permission-check.ts # Permission check service
│   ├── endpoints.ts       # RBAC API endpoints
│   ├── admin-endpoints.ts # Admin API endpoints
│   └── index.ts           # Public exports
└── migrations/
    ├── 002_add_tenant_support.sql
    ├── 003_session_management.sql
    └── 004_rbac_schema.sql
```

---

## Integration Points

### 1. Issuer Success Callback

```typescript
async success(ctx, value, req) {
  // After authentication, add account to session
  await addAccountToSession(ctx, sessionService, {
    tenantId,
    userId,
    subjectType,
    subjectProperties,
    refreshToken,
    clientId,
    ipAddress,
  })

  // Enrich with RBAC claims
  const rbacClaims = await rbacEnricher.enrichForApp(userId, clientId, tenantId)

  return ctx.subject("user", {
    userID,
    tenantID,
    roles: rbacClaims.roles,
    permissions: rbacClaims.permissions,
  })
}
```

### 2. Multi-Tenant Issuer Factory

```typescript
const app = multiTenantIssuer({
  tenantService,
  storage: baseStorage,
  providers: {
    /* ... */
  },
  async allow(input, req, tenant) {
    // Tenant-aware client validation
  },
})
```

### 3. Session Middleware

```typescript
app.use("*", createTenantResolver({ tenantService }))
app.use("*", createTenantThemeMiddleware())
app.use("*", sessionMiddleware(sessionService))
```

---

## Security Considerations

### Session Security

- 256-bit cryptographically random session IDs
- Encrypted session cookies (JWE)
- Session versioning for optimistic concurrency
- Tenant ID in cookie prevents cross-tenant hijacking

### Cookie Security

```
HttpOnly: true      - Prevents XSS
Secure: true        - HTTPS only
SameSite: Lax       - CSRF protection
Domain: .tenant.com - Cross-subdomain sharing
```

### RBAC Security

- SQL injection prevention via SQLValidator
- Cache invalidation on role changes
- JWT signature verification
- Tenant isolation in all queries

---

## Migration Strategy

### Phase 1: Schema Deployment

1. Deploy D1 migrations for new tables
2. No impact on existing sessions

### Phase 2: Feature Flag Rollout

```typescript
const sessionConfig = {
  enabled: env.MULTI_ACCOUNT_SESSIONS === "true",
  maxAccounts: parseInt(env.MAX_ACCOUNTS_PER_SESSION || "3"),
}
```

### Phase 3: Gradual Migration

1. New logins create browser sessions
2. Existing single-account flows continue working
3. Users opting into multi-account get upgraded

---

## Performance Considerations

| Operation        | Primary Store | Rationale                 |
| ---------------- | ------------- | ------------------------- |
| Session Read     | KV            | Low latency (<10ms)       |
| Session Write    | KV + D1       | Dual-write for durability |
| Admin Queries    | D1            | Structured queries needed |
| Permission Check | KV (cached)   | Fast with 60s TTL         |

---

## Constraints & Limits

| Constraint               | Value  | Configurable |
| ------------------------ | ------ | ------------ |
| Max accounts per browser | 3      | Yes          |
| Session lifetime         | 7 days | Yes          |
| Sliding window threshold | 1 day  | Yes          |
| Max permissions in token | 50     | Yes          |
| Permission cache TTL     | 60s    | Yes          |
