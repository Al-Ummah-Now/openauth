# OpenAuth Enterprise Features

Complete guide to implementing enterprise-grade authentication with OpenAuth's multi-tenant, session management, and RBAC capabilities.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Features](#features)
- [Architecture](#architecture)
- [Setup](#setup)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
- [Examples](#examples)
- [Production Deployment](#production-deployment)

## Overview

The OpenAuth Enterprise module provides a complete SSO solution with:

- **Multi-Tenancy**: Isolate users and data per organization with subdomain/domain routing
- **Session Management**: Multiple account support with browser-level sessions
- **RBAC**: Role-Based Access Control with permission checking and token enrichment
- **Audit Logging**: Compliance tracking for all token operations
- **White-Label Branding**: Customizable themes per tenant
- **OIDC Compliance**: Full OpenID Connect support with `prompt`, `max_age`, `login_hint`

## Quick Start

### 1. Choose Your Runtime

**Cloudflare Workers:**

```bash
cd examples/issuer/cloudflare
bun install
wrangler dev
```

**Bun:**

```bash
cd examples/issuer/bun
bun install
bun run enterprise-issuer.ts
```

### 2. Create a Tenant

```bash
curl -X POST http://localhost:3000/tenants \
  -H "Content-Type: application/json" \
  -d '{
    "id": "acme",
    "name": "Acme Corporation",
    "status": "active"
  }'
```

### 3. Test Authentication

Navigate to:

```
http://acme.localhost:3000/authorize?client_id=test&response_type=code&redirect_uri=http://localhost:3001/callback
```

## Features

### Multi-Tenancy

Each tenant gets:

- Isolated storage (prefixed keys)
- Custom subdomain (e.g., `acme.auth.example.com`)
- White-label branding (logo, colors, theme)
- Per-tenant OAuth providers
- Independent user namespaces

**Tenant Resolution Strategies:**

1. **Subdomain** (default): `{tenant}.auth.example.com`
2. **Domain**: `auth.{tenant}.com`
3. **Path**: `auth.example.com/{tenant}`
4. **Header**: `X-Tenant-ID: {tenant}`
5. **Query**: `auth.example.com?tenant={tenant}`

### Session Management

Multi-account browser sessions allow users to:

- Stay logged into multiple accounts simultaneously (default: 3)
- Switch between accounts without re-authentication
- Maintain sessions across browser restarts
- Use sliding window expiration (activity extends lifetime)

**Session Endpoints:**

- `GET /session/accounts` - List all logged-in accounts
- `POST /session/switch` - Switch active account
- `DELETE /session/accounts/:userId` - Sign out one account
- `DELETE /session/all` - Sign out all accounts

**Admin Endpoints:**

- `POST /admin/sessions/revoke-user` - Revoke all sessions for a user
- `POST /admin/sessions/revoke` - Revoke specific session by ID

### RBAC (Role-Based Access Control)

Hierarchical permission system with:

- Apps (top-level applications)
- Roles (collections of permissions)
- Permissions (atomic capabilities)
- User role assignments
- Permission caching (60s TTL)
- Automatic token enrichment

**RBAC Endpoints:**

- `POST /rbac/check` - Check if user has permission
- `POST /rbac/check/batch` - Check multiple permissions
- `GET /rbac/permissions` - Get user's permissions
- `GET /rbac/roles` - Get user's roles

**Admin Endpoints:**

- `POST /rbac/admin/apps` - Create application
- `POST /rbac/admin/roles` - Create role
- `POST /rbac/admin/permissions` - Create permission
- `POST /rbac/admin/users/:userId/roles` - Assign role to user
- `POST /rbac/admin/roles/:roleId/permissions` - Assign permission to role

### Audit Logging

Track all token operations for compliance:

- Token generation (OAuth flows)
- Token refresh
- Token revocation
- Token reuse detection (security incidents)

**Queue-Based Processing** (Cloudflare only):
Async audit logging for high-performance deployments.

### White-Label Branding

Customize per tenant:

```typescript
PUT /tenants/:id/branding
{
  "logoUrl": "https://acme.com/logo.png",
  "faviconUrl": "https://acme.com/favicon.ico",
  "primaryColor": "#007bff",
  "theme": {
    "buttonColor": "#007bff",
    "buttonTextColor": "#ffffff",
    "linkColor": "#0056b3"
  }
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Client Application                    │
└───────────────────┬─────────────────────────────────────┘
                    │
                    │ OAuth/OIDC
                    ▼
┌─────────────────────────────────────────────────────────┐
│           createMultiTenantIssuer (Hono App)            │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────┐   │
│  │        Tenant Resolution Middleware              │   │
│  │  (subdomain → tenant object + isolated storage)  │   │
│  └──────────────────────────────────────────────────┘   │
│                        ↓                                 │
│  ┌──────────────────────────────────────────────────┐   │
│  │          Session Middleware                      │   │
│  │  (decrypt cookie → browser session + accounts)   │   │
│  └──────────────────────────────────────────────────┘   │
│                        ↓                                 │
│  ┌──────────────────────────────────────────────────┐   │
│  │             OAuth Issuer                         │   │
│  │  (/authorize, /token, /userinfo)                │   │
│  └──────────────────────────────────────────────────┘   │
│                        ↓                                 │
│  ┌──────────────────────────────────────────────────┐   │
│  │         RBAC Token Enrichment                    │   │
│  │  (add roles + permissions to JWT claims)         │   │
│  └──────────────────────────────────────────────────┘   │
│                        ↓                                 │
│  ┌──────────────────────────────────────────────────┐   │
│  │            Audit Logging                         │   │
│  │  (log token events to database/queue)            │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │    Storage Layer              │
        ├───────────────────────────────┤
        │  • KV/Memory (tokens)         │
        │  • D1/Postgres (RBAC, audit)  │
        │  • Queue (async audit)        │
        └───────────────────────────────┘
```

## Setup

### Prerequisites

**For Cloudflare Workers:**

- KV namespace for token storage
- D1 database for RBAC and audit logs
- Queue for async audit processing (optional)
- Session secret (32-byte hex string)

**For Bun/Node:**

- Storage adapter (DynamoDB, PostgreSQL, or Memory)
- Database for RBAC and audit logs
- Session secret

### Installation

```bash
npm install @openauthjs/openauth
# or
bun add @openauthjs/openauth
```

### Database Schema

Run the following SQL to create required tables:

```sql
-- Clients table (for client credentials)
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id TEXT,
  tenant_id TEXT,
  metadata TEXT,
  timestamp INTEGER NOT NULL
);

-- RBAC: Apps
CREATE TABLE IF NOT EXISTS rbac_apps (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL
);

-- RBAC: Roles
CREATE TABLE IF NOT EXISTS rbac_roles (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (app_id) REFERENCES rbac_apps(id)
);

-- RBAC: Permissions
CREATE TABLE IF NOT EXISTS rbac_permissions (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (app_id) REFERENCES rbac_apps(id)
);

-- RBAC: User Roles
CREATE TABLE IF NOT EXISTS rbac_user_roles (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (role_id) REFERENCES rbac_roles(id)
);

-- RBAC: Role Permissions
CREATE TABLE IF NOT EXISTS rbac_role_permissions (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES rbac_roles(id),
  FOREIGN KEY (permission_id) REFERENCES rbac_permissions(id)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_rbac_apps_tenant ON rbac_apps(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rbac_roles_app ON rbac_roles(app_id);
CREATE INDEX IF NOT EXISTS idx_rbac_permissions_app ON rbac_permissions(app_id);
CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_user ON rbac_user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_tenant ON rbac_user_roles(tenant_id);
```

## Configuration

### Environment Variables

```bash
# Required
SESSION_SECRET=<32-byte-hex-string>  # Generate with: openssl rand -hex 32

# Optional: Base domain for tenant resolution
BASE_DOMAIN=auth.example.com

# Optional: OAuth providers
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
GITHUB_CLIENT_ID=<your-client-id>
GITHUB_CLIENT_SECRET=<your-client-secret>

# Optional: Database (if not using Cloudflare bindings)
DATABASE_URL=postgresql://user:pass@host:5432/db
```

### Generate Session Secret

```bash
# Using OpenSSL
openssl rand -hex 32

# Using Node
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Using Bun
bun -e "console.log(crypto.randomBytes(32).toString('hex'))"
```

### Cloudflare Workers Configuration

**wrangler.toml:**

```toml
name = "auth-server"
main = "enterprise-issuer.ts"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "AUTH_KV"
id = "your-kv-namespace-id"

[[d1_databases]]
binding = "AUTH_DB"
database_name = "auth-db"
database_id = "your-d1-database-id"

[[queues.producers]]
binding = "AUDIT_QUEUE"
queue = "audit-queue"

[vars]
BASE_DOMAIN = "auth.example.com"
```

**Set secrets:**

```bash
wrangler secret put SESSION_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
```

## API Endpoints

### OAuth/OIDC Endpoints

Standard OAuth 2.0 and OpenID Connect endpoints:

| Method | Endpoint                                  | Description                    |
| ------ | ----------------------------------------- | ------------------------------ |
| GET    | `/authorize`                              | Authorization endpoint         |
| POST   | `/token`                                  | Token endpoint                 |
| GET    | `/userinfo`                               | UserInfo endpoint              |
| GET    | `/.well-known/openid-configuration`       | OIDC discovery                 |
| GET    | `/.well-known/oauth-authorization-server` | OAuth discovery                |
| GET    | `/.well-known/jwks.json`                  | JSON Web Key Set               |
| POST   | `/token/introspect`                       | Token introspection (RFC 7662) |
| POST   | `/token/revoke`                           | Token revocation (RFC 7009)    |

### Session Management

| Method | Endpoint                    | Description             |
| ------ | --------------------------- | ----------------------- |
| GET    | `/session/accounts`         | List logged-in accounts |
| POST   | `/session/switch`           | Switch active account   |
| DELETE | `/session/accounts/:userId` | Sign out one account    |
| DELETE | `/session/all`              | Sign out all accounts   |
| GET    | `/session/check`            | Silent session check    |

**Admin:**
| Method | Endpoint | Description |
|--------|-----------------------------------|--------------------------------|
| POST | `/admin/sessions/revoke-user` | Revoke all sessions for user |
| POST | `/admin/sessions/revoke` | Revoke specific session |

### RBAC Endpoints

| Method | Endpoint            | Description                |
| ------ | ------------------- | -------------------------- |
| POST   | `/rbac/check`       | Check single permission    |
| POST   | `/rbac/check/batch` | Check multiple permissions |
| GET    | `/rbac/permissions` | Get user permissions       |
| GET    | `/rbac/roles`       | Get user roles             |

**Admin:**
| Method | Endpoint | Description |
|--------|---------------------------------------------|------------------------------|
| POST | `/rbac/admin/apps` | Create app |
| GET | `/rbac/admin/apps` | List apps |
| POST | `/rbac/admin/roles` | Create role |
| GET | `/rbac/admin/roles` | List roles |
| POST | `/rbac/admin/permissions` | Create permission |
| GET | `/rbac/admin/permissions` | List permissions |
| POST | `/rbac/admin/users/:userId/roles` | Assign role to user |
| DELETE | `/rbac/admin/users/:userId/roles/:roleId` | Remove role from user |
| POST | `/rbac/admin/roles/:roleId/permissions` | Assign permission to role |
| DELETE | `/rbac/admin/roles/:roleId/permissions/:permissionId` | Remove permission |

### Tenant Management

| Method | Endpoint                | Description     |
| ------ | ----------------------- | --------------- |
| POST   | `/tenants`              | Create tenant   |
| GET    | `/tenants`              | List tenants    |
| GET    | `/tenants/:id`          | Get tenant      |
| PUT    | `/tenants/:id`          | Update tenant   |
| DELETE | `/tenants/:id`          | Delete tenant   |
| PUT    | `/tenants/:id/branding` | Update branding |
| PUT    | `/tenants/:id/settings` | Update settings |

## Examples

### Create a Complete RBAC Setup

```bash
# 1. Create an app
curl -X POST http://localhost:3000/rbac/admin/apps \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-app",
    "tenantId": "acme",
    "name": "My Application",
    "description": "Main application"
  }'

# 2. Create permissions
curl -X POST http://localhost:3000/rbac/admin/permissions \
  -H "Content-Type: application/json" \
  -d '{
    "id": "posts:read",
    "appId": "my-app",
    "tenantId": "acme",
    "name": "posts:read",
    "description": "Read posts"
  }'

curl -X POST http://localhost:3000/rbac/admin/permissions \
  -H "Content-Type: application/json" \
  -d '{
    "id": "posts:write",
    "appId": "my-app",
    "tenantId": "acme",
    "name": "posts:write",
    "description": "Write posts"
  }'

# 3. Create roles
curl -X POST http://localhost:3000/rbac/admin/roles \
  -H "Content-Type: application/json" \
  -d '{
    "id": "reader",
    "appId": "my-app",
    "tenantId": "acme",
    "name": "Reader",
    "description": "Can read posts"
  }'

curl -X POST http://localhost:3000/rbac/admin/roles \
  -H "Content-Type: application/json" \
  -d '{
    "id": "author",
    "appId": "my-app",
    "tenantId": "acme",
    "name": "Author",
    "description": "Can read and write posts"
  }'

# 4. Assign permissions to roles
curl -X POST http://localhost:3000/rbac/admin/roles/reader/permissions \
  -H "Content-Type: application/json" \
  -d '{"permissionId": "posts:read"}'

curl -X POST http://localhost:3000/rbac/admin/roles/author/permissions \
  -H "Content-Type: application/json" \
  -d '{"permissionId": "posts:read"}'

curl -X POST http://localhost:3000/rbac/admin/roles/author/permissions \
  -H "Content-Type: application/json" \
  -d '{"permissionId": "posts:write"}'

# 5. Assign role to user
curl -X POST http://localhost:3000/rbac/admin/users/user-123/roles \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "author",
    "tenantId": "acme"
  }'

# 6. Check permissions
curl -X POST http://localhost:3000/rbac/check \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "appId": "my-app",
    "tenantId": "acme",
    "permission": "posts:write"
  }'
```

### Multi-Account Session Flow

```bash
# 1. User logs in (account 1)
# Browser receives session cookie

# 2. Check current session
curl http://localhost:3000/session/accounts \
  -H "Cookie: session=encrypted-cookie-value"

# Response:
# {
#   "activeUserId": "user-123",
#   "accounts": [
#     {
#       "userId": "user-123",
#       "email": "alice@example.com",
#       "tenantId": "acme",
#       "lastActivity": 1234567890
#     }
#   ]
# }

# 3. User logs in with different account (account 2)
# Session cookie is updated to include both accounts

# 4. Check session again
curl http://localhost:3000/session/accounts \
  -H "Cookie: session=updated-cookie-value"

# Response:
# {
#   "activeUserId": "user-456",
#   "accounts": [
#     {
#       "userId": "user-123",
#       "email": "alice@example.com",
#       "tenantId": "acme",
#       "lastActivity": 1234567890
#     },
#     {
#       "userId": "user-456",
#       "email": "bob@example.com",
#       "tenantId": "contoso",
#       "lastActivity": 1234567900
#     }
#   ]
# }

# 5. Switch to first account
curl -X POST http://localhost:3000/session/switch \
  -H "Content-Type: application/json" \
  -H "Cookie: session=updated-cookie-value" \
  -d '{"userId": "user-123"}'

# 6. Sign out one account
curl -X DELETE http://localhost:3000/session/accounts/user-123 \
  -H "Cookie: session=updated-cookie-value"

# 7. Sign out all accounts
curl -X DELETE http://localhost:3000/session/all \
  -H "Cookie: session=updated-cookie-value"
```

## Production Deployment

### Security Checklist

- [ ] Use a cryptographically secure session secret (32 bytes minimum)
- [ ] Enable HTTPS only (set secure cookie flag)
- [ ] Configure CORS to allow only trusted origins
- [ ] Use production-grade storage (DynamoDB, Postgres, not Memory)
- [ ] Enable audit logging for compliance
- [ ] Set up queue-based audit processing for scale (Cloudflare)
- [ ] Implement rate limiting on authentication endpoints
- [ ] Configure proper session timeouts
- [ ] Review and test tenant isolation
- [ ] Set up monitoring and alerting

### Performance Optimization

1. **Enable Permission Caching**

   ```typescript
   const rbacService = new RBACServiceImpl(adapter, storage, {
     cachePermissionsTTL: 60, // Cache for 60 seconds
   })
   ```

2. **Use Queue-Based Audit Logging** (Cloudflare)

   ```typescript
   const auditService = new AuditService({
     database: env.AUTH_DB,
     queue: env.AUDIT_QUEUE, // Async processing
   })
   ```

3. **Configure Session Sliding Window**
   ```typescript
   const sessionService = new SessionServiceImpl(storage, {
     slidingWindowSeconds: 24 * 60 * 60, // Extend on activity
   })
   ```

### Monitoring

Key metrics to track:

- Authentication success/failure rates
- Session creation/revocation rates
- RBAC cache hit/miss rates
- Audit log processing latency
- Token generation/refresh rates
- Active sessions per tenant

### Scaling

**Horizontal Scaling:**

- Cloudflare Workers scale automatically
- Use edge caching for tenant configuration
- Offload audit processing to queues

**Vertical Scaling:**

- Increase D1 database limits
- Optimize RBAC queries with proper indexes
- Use CDN for static assets (branding)

### Backup and Recovery

1. **KV/Storage Backups:**
   - Export token data periodically
   - Test restore procedures

2. **Database Backups:**
   - Enable automated D1 backups
   - Store backups in separate region

3. **Configuration Backups:**
   - Version control tenant configurations
   - Document RBAC role/permission mappings

## Support

For issues and questions:

- GitHub Issues: https://github.com/openauthjs/openauth/issues
- Documentation: https://openauth.js.org
- Discord: https://discord.gg/openauth
