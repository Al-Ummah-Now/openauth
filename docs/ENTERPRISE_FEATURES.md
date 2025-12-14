# Enterprise Features for OpenAuth

This document describes the enterprise-grade features added to OpenAuth for production deployments. These features provide enhanced security, compliance, and operational visibility for OAuth 2.0 authorization servers.

## Table of Contents

1. [Overview](#overview)
2. [Client Credentials Management](#client-credentials-management)
3. [Token Introspection (RFC 7662)](#token-introspection-rfc-7662)
4. [Token Revocation (RFC 7009)](#token-revocation-rfc-7009)
5. [Audit Logging](#audit-logging)
6. [CORS Configuration](#cors-configuration)
7. [Architecture & Design](#architecture--design)
8. [Configuration Guide](#configuration-guide)
9. [Testing](#testing)
10. [Migration Guide](#migration-guide)
11. [RBAC Security](#rbac-security)

## Overview

The enterprise features extend OpenAuth with:

- **Client Credentials Management**: Secure storage and authentication of OAuth clients using D1 database with PBKDF2 hashing
- **Token Introspection**: RFC 7662-compliant endpoint for validating access tokens
- **Token Revocation**: RFC 7009-compliant endpoint for revoking tokens
- **Audit Logging**: Async, non-blocking audit trail for token lifecycle events
- **Enhanced CORS**: Global CORS configuration for multi-origin deployments

All features are **opt-in** and fully backward compatible with existing deployments.

## Client Credentials Management

### Overview

OAuth 2.0 defines two client types:

| Client Type      | Description                   | Examples                         | Secret Storage               |
| ---------------- | ----------------------------- | -------------------------------- | ---------------------------- |
| **Confidential** | Can securely store secrets    | Backend servers, secure services | `client_secret_hash` is set  |
| **Public**       | Cannot securely store secrets | SPAs, mobile apps, CLI tools     | `client_secret_hash` is NULL |

The D1 Client Adapter provides secure storage for both client types with industry-standard PBKDF2 password hashing for confidential clients.

### Key Features

- **PBKDF2 hashing** with SHA-256 (100,000 iterations, 64-byte keys)
- **Constant-time comparison** to prevent timing attacks
- **D1 database storage** for client metadata
- **Public client support** with `client_secret_hash = NULL`
- **Client authentication** via Basic Auth, form-based credentials, or client_id only (public)

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret_hash TEXT,        -- NULL for public clients
  client_name TEXT NOT NULL,
  redirect_uris TEXT, -- JSON array
  grant_types TEXT,   -- JSON array
  scopes TEXT,        -- JSON array
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_client_name ON oauth_clients(client_name);
```

### Configuration

```ts
import { issuer } from "@openauthjs/openauth"

const app = issuer({
  // ... other config
  clientDb: env.AUTH_DB, // Cloudflare D1 database
})
```

### Creating Clients

#### Confidential Client (with secret)

```ts
import { D1ClientAdapter } from "@openauthjs/openauth/client/d1-adapter"
import { ClientAuthenticator } from "@openauthjs/openauth/client/authenticator"

const adapter = new D1ClientAdapter({ database: env.AUTH_DB })
const authenticator = new ClientAuthenticator({ adapter })

// Create a confidential client (backend service)
await authenticator.createClient(
  "my-backend-service",
  "super-secret-key",
  "Backend Service",
  {
    redirect_uris: ["https://api.example.com/callback"],
    grant_types: ["authorization_code", "refresh_token", "client_credentials"],
    scopes: ["openid", "profile", "email"],
  },
)
```

#### Public Client (no secret)

```sql
-- Create a public client directly in D1 (no secret hash)
INSERT INTO oauth_clients (
  client_id,
  client_secret_hash,  -- NULL for public clients
  client_name,
  redirect_uris,
  grant_types,
  scopes,
  created_at
) VALUES (
  'my-spa-app',
  NULL,
  'My SPA Application',
  '["https://app.example.com/callback", "http://localhost:3000/callback"]',
  '["authorization_code", "refresh_token"]',
  '["openid", "profile"]',
  unixepoch() * 1000
);
```

Or via the adapter:

```ts
// Create a public client programmatically
await adapter.createClient({
  client_id: "my-mobile-app",
  client_secret_hash: null, // Public client
  client_name: "My Mobile App",
  redirect_uris: ["myapp://callback"],
  grant_types: ["authorization_code", "refresh_token"],
  scopes: ["openid", "profile"],
})
```

### Client Authentication

Authentication method depends on client type:

#### Confidential Client: Basic Authentication (Recommended)

```ts
const credentials = btoa("client_id:client_secret")
fetch("https://auth.example.com/token/introspect", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: `Basic ${credentials}`,
  },
  body: new URLSearchParams({
    token: accessToken,
  }),
})
```

#### Confidential Client: Form-based Authentication

```ts
fetch("https://auth.example.com/token/introspect", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    token: accessToken,
    client_id: "my-client",
    client_secret: "my-secret",
  }),
})
```

#### Public Client: client_id Only

```ts
// Public clients authenticate with just client_id (no secret)
fetch("https://auth.example.com/token/revoke", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    token: accessToken,
    client_id: "my-spa-app", // No client_secret needed
    token_type_hint: "access_token",
  }),
})
```

### Authentication Summary

| Client Type      | Introspection                      | Revocation                     |
| ---------------- | ---------------------------------- | ------------------------------ |
| **Confidential** | Basic Auth or Form (id+secret)     | Basic Auth or Form (id+secret) |
| **Public**       | Not supported (use JWT validation) | Form with client_id only       |

> **Note**: Public clients cannot use token introspection because they cannot securely authenticate. They should validate JWTs locally instead. However, public clients CAN revoke their own tokens using just `client_id`.

## Token Introspection (RFC 7662)

### Overview

Token introspection allows clients to query the authorization server about the state of an access token. This is essential for resource servers to validate tokens and make authorization decisions.

**Specification**: [RFC 7662](https://datatracker.ietf.org/doc/html/rfc7662)

### Endpoint

```
POST /token/introspect
```

### Requirements

- Client authentication (Basic Auth or form-based)
- `clientDb` configuration must be provided

### Request Format

```http
POST /token/introspect HTTP/1.1
Host: auth.example.com
Content-Type: application/x-www-form-urlencoded
Authorization: Basic Y2xpZW50X2lkOmNsaWVudF9zZWNyZXQ=

token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
&token_type_hint=access_token
```

### Response Format

#### Active Token

```json
{
  "active": true,
  "scope": "openid profile",
  "client_id": "my-client",
  "username": "user:abc123",
  "token_type": "Bearer",
  "exp": 1704153600,
  "iat": 1704150000,
  "sub": "user:abc123",
  "iss": "https://auth.example.com",
  "aud": "my-client"
}
```

#### Inactive Token

```json
{
  "active": false
}
```

### Use Cases

1. **API Gateway Token Validation**: Validate incoming tokens at the gateway level
2. **Microservices Authorization**: Service-to-service token validation
3. **Real-time Token Status**: Check if tokens have been revoked
4. **Compliance & Auditing**: Verify token scope and expiration

### Example: API Gateway Integration

```ts
async function validateRequest(request: Request) {
  const authHeader = request.headers.get("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 })
  }

  const token = authHeader.slice(7)

  // Introspect the token
  const introspection = await fetch(
    "https://auth.example.com/token/introspect",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa("gateway:gateway-secret")}`,
      },
      body: new URLSearchParams({ token }),
    },
  )

  const result = await introspection.json()

  if (!result.active) {
    return new Response("Invalid token", { status: 401 })
  }

  // Token is valid, proceed with request
  return handleRequest(request, result)
}
```

## Token Revocation (RFC 7009)

### Overview

Token revocation allows clients to notify the authorization server that a token is no longer needed. This is critical for security when users log out or when tokens are compromised.

**Specification**: [RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009)

### Endpoint

```
POST /token/revoke
```

### Client Types

OAuth 2.0 defines two client types with different authentication requirements:

| Client Type      | Description                                          | Authentication                |
| ---------------- | ---------------------------------------------------- | ----------------------------- |
| **Confidential** | Server-side apps that can securely store secrets     | `client_id` + `client_secret` |
| **Public**       | SPAs, mobile apps that cannot store secrets securely | `client_id` only              |

### Requirements

- `client_id` is always required
- `client_secret` is required only for confidential clients
- `clientDb` configuration must be provided
- Token must belong to the requesting client (ownership verification)

### Request Format

#### Confidential Client (with secret)

```http
POST /token/revoke HTTP/1.1
Host: auth.example.com
Content-Type: application/x-www-form-urlencoded
Authorization: Basic Y2xpZW50X2lkOmNsaWVudF9zZWNyZXQ=

token=user:abc123:refresh-token-uuid
&token_type_hint=refresh_token
```

#### Public Client (no secret)

```http
POST /token/revoke HTTP/1.1
Host: auth.example.com
Content-Type: application/x-www-form-urlencoded

token=eyJhbGciOiJSUzI1NiIs...
&client_id=my-spa-app
&token_type_hint=access_token
```

### Response Format

Per RFC 7009, the endpoint always returns success (200 OK with empty body) to prevent information disclosure:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{}
```

### Token Types

#### Refresh Token Revocation

Refresh tokens use the format `subject:token_id` and are removed from storage:

```ts
// Revoke a specific refresh token
await fetch("https://auth.example.com/token/revoke", {
  method: "POST",
  headers: {
    Authorization: `Basic ${btoa("client:secret")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    token: refreshToken,
    token_type_hint: "refresh_token",
  }),
})
```

#### Access Token Revocation

Access tokens (JWTs) are added to a revocation list with TTL matching the token expiration:

```ts
// Revoke an access token (confidential client)
await fetch("https://auth.example.com/token/revoke", {
  method: "POST",
  headers: {
    Authorization: `Basic ${btoa("client:secret")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    token: accessToken,
    token_type_hint: "access_token",
  }),
})
```

### Public Client Examples

#### JavaScript (SPA)

```ts
// Public client revocation helper
async function revokeToken(
  token: string,
  type: "access_token" | "refresh_token" = "access_token",
) {
  const response = await fetch("https://auth.example.com/token/revoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      token,
      client_id: "my-spa-app", // Required for public clients
      token_type_hint: type,
    }),
  })

  // RFC 7009: Always returns 200 OK
  return response.ok
}

// Usage
await revokeToken(accessToken, "access_token")
await revokeToken(refreshToken, "refresh_token")
```

#### React Native / Mobile

```ts
// Mobile app logout with token revocation
async function logout() {
  const accessToken = await SecureStore.getItemAsync("access_token")
  const refreshToken = await SecureStore.getItemAsync("refresh_token")

  // Revoke both tokens
  await Promise.all([
    fetch("https://auth.example.com/token/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: accessToken,
        client_id: "my-mobile-app",
        token_type_hint: "access_token",
      }),
    }),
    fetch("https://auth.example.com/token/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: refreshToken,
        client_id: "my-mobile-app",
        token_type_hint: "refresh_token",
      }),
    }),
  ])

  // Clear local storage
  await SecureStore.deleteItemAsync("access_token")
  await SecureStore.deleteItemAsync("refresh_token")
}
```

#### Complete Auth Client for Public Apps

```ts
// auth-client.ts - Reusable auth client for SPAs/mobile apps
class AuthClient {
  constructor(
    private issuer: string,
    private clientId: string,
  ) {}

  async revokeToken(token: string, type: "access_token" | "refresh_token") {
    await fetch(`${this.issuer}/token/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token,
        client_id: this.clientId,
        token_type_hint: type,
      }),
    })
  }

  async logout(accessToken?: string, refreshToken?: string) {
    const revocations = []

    if (accessToken) {
      revocations.push(this.revokeToken(accessToken, "access_token"))
    }
    if (refreshToken) {
      revocations.push(this.revokeToken(refreshToken, "refresh_token"))
    }

    await Promise.all(revocations)
  }
}

// Usage
const auth = new AuthClient("https://auth.example.com", "my-spa-app")
await auth.logout(accessToken, refreshToken)
```

### Revocation Strategy

OpenAuth uses a **hybrid revocation strategy**:

1. **Short-lived access tokens** (default: 15 minutes) minimize exposure
2. **Revocation list** for critical cases (stored in KV with TTL)
3. **Automatic cleanup** of expired revocation entries

This approach balances security with performance and scalability.

### Use Cases

1. **User Logout**: Revoke all tokens when user logs out
2. **Security Incidents**: Immediately invalidate compromised tokens
3. **Account Deactivation**: Revoke all tokens for deactivated accounts
4. **Session Management**: Implement "logout from all devices"

### Example: Logout Implementation

```ts
async function logout(userId: string) {
  // Get all active sessions for user
  const sessions = await getUserSessions(userId)

  // Revoke all refresh tokens
  for (const session of sessions) {
    await fetch("https://auth.example.com/token/revoke", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa("app:secret")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        token: session.refreshToken,
        token_type_hint: "refresh_token",
      }),
    })
  }

  // Clear user sessions
  await clearUserSessions(userId)
}
```

## Audit Logging

### Overview

Audit logging provides a complete trail of token lifecycle events for compliance, security monitoring, and debugging. All logging is **async and non-blocking** to avoid impacting OAuth performance.

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  event_type TEXT NOT NULL, -- generated, refreshed, revoked, reused
  client_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  timestamp INTEGER NOT NULL,
  metadata TEXT -- JSON
);

CREATE INDEX idx_token_id ON token_usage(token_id);
CREATE INDEX idx_subject ON token_usage(subject);
CREATE INDEX idx_event_type ON token_usage(event_type);
CREATE INDEX idx_timestamp ON token_usage(timestamp);
```

### Configuration

```ts
import { AuditService } from "@openauthjs/openauth/services/audit"

const app = issuer({
  // ... other config
  audit: {
    service: new AuditService({
      database: env.AUDIT_DB, // Separate D1 database for audit logs
    }),
    hooks: {
      onTokenGenerated: true, // Log token creation
      onTokenRefreshed: true, // Log token refresh
      onTokenRevoked: true, // Log token revocation
      onTokenReused: true, // Log refresh token reuse detection
    },
  },
})
```

### Event Types

#### Token Generated

Logged when new tokens are issued:

```json
{
  "token_id": "refresh-token-uuid",
  "subject": "user:abc123",
  "event_type": "generated",
  "client_id": "my-app",
  "ip_address": "192.168.1.1",
  "user_agent": "Mozilla/5.0...",
  "timestamp": 1704150000000,
  "metadata": {
    "grant_type": "authorization_code",
    "scope": "openid profile"
  }
}
```

#### Token Refreshed

Logged when tokens are refreshed:

```json
{
  "token_id": "refresh-token-uuid",
  "subject": "user:abc123",
  "event_type": "refreshed",
  "client_id": "my-app",
  "timestamp": 1704153600000
}
```

#### Token Revoked

Logged when tokens are explicitly revoked:

```json
{
  "token_id": "refresh-token-uuid",
  "subject": "user:abc123",
  "event_type": "revoked",
  "client_id": "my-app",
  "timestamp": 1704157200000,
  "metadata": {
    "reason": "user_logout"
  }
}
```

#### Token Reused

Logged when refresh token reuse is detected (potential security incident):

```json
{
  "token_id": "refresh-token-uuid",
  "subject": "user:abc123",
  "event_type": "reused",
  "client_id": "my-app",
  "ip_address": "10.0.0.1",
  "timestamp": 1704160800000,
  "metadata": {
    "original_use": 1704150000000,
    "reuse_attempt": 1704160800000
  }
}
```

### Querying Audit Logs

#### Get User Activity

```ts
const auditService = new AuditService({ database: env.AUDIT_DB })

// Get all token events for a user
const events = await auditService.getTokenAnalytics("user:abc123", 100)

console.log(events)
// [
//   { token_id: "...", event_type: "generated", timestamp: ... },
//   { token_id: "...", event_type: "refreshed", timestamp: ... },
//   { token_id: "...", event_type: "revoked", timestamp: ... }
// ]
```

#### Track Token Family

```ts
// Track all events for a specific token chain
const family = await auditService.getTokenFamily("refresh-token-uuid")

console.log(family)
// Shows chronological history of token generation, refreshes, and revocation
```

#### Advanced Queries

```ts
// Get audit logs with filters
const logs = await auditService.getAuditLogs({
  subject: "user:abc123",
  event_type: "reused",
  start_timestamp: Date.now() - 86400000, // Last 24 hours
  end_timestamp: Date.now(),
  limit: 50,
})

// Find security incidents
const incidents = await auditService.getAuditLogs({
  event_type: "reused",
  start_timestamp: Date.now() - 7 * 86400000, // Last 7 days
})
```

### Data Retention

```ts
// Clean up logs older than 90 days
const cleaned = await auditService.cleanExpired(90 * 24 * 60 * 60)
console.log(`Deleted ${cleaned} old audit entries`)
```

### Use Cases

1. **Compliance**: SOC 2, HIPAA, GDPR audit trails
2. **Security Monitoring**: Detect abnormal token usage patterns
3. **Debugging**: Investigate token refresh failures
4. **Analytics**: Track authentication patterns and user behavior
5. **Incident Response**: Investigate security incidents

## CORS Configuration

### Overview

Global CORS configuration allows OpenAuth to serve multiple frontend applications from different origins.

### Configuration

```ts
const app = issuer({
  // ... other config
  cors: {
    origins: [
      "https://app.example.com",
      "https://admin.example.com",
      "https://mobile.example.com",
    ],
    credentials: true, // Allow cookies
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    headers: ["Content-Type", "Authorization"],
    maxAge: 3600, // Cache preflight for 1 hour
  },
})
```

### Default Behavior

If `cors` is not configured:

- Individual endpoints (like `/.well-known/jwks.json`) have their own CORS settings
- Most endpoints are open to all origins for public discovery

### Environment-based Configuration

```ts
const app = issuer({
  cors: {
    origins: process.env.ALLOWED_ORIGINS!.split(","),
    credentials: true,
  },
})
```

## Architecture & Design

### Design Principles

1. **D1 for Low-Frequency Writes Only**: Client credentials and audit logs use D1. All tokens use KV storage to avoid D1 concurrency issues.

2. **Fire-and-Forget Audit Logging**: Audit writes are async and never block OAuth flows. Errors are logged but don't fail requests.

3. **Hybrid Revocation**: Short TTL (15min) + revocation list provides security without performance penalties.

4. **Backward Compatibility**: All features are opt-in. Existing deployments work without changes.

5. **Standards Compliance**: RFC 7662 and RFC 7009 implementations for interoperability.

### Storage Architecture

```
┌─────────────────────┐
│   OpenAuth Issuer   │
└──────────┬──────────┘
           │
           ├─────────────────────┐
           │                     │
    ┌──────▼──────┐       ┌─────▼──────┐
    │  KV Storage │       │ D1 Database │
    └─────────────┘       └────────────┘
           │                     │
    - Auth codes          - Client credentials
    - Sessions            - Audit logs
    - Refresh tokens
    - Revocation list
```

### Security Considerations

1. **PBKDF2 Hashing**: 100,000 iterations (OWASP minimum for 2024)
2. **Constant-Time Comparison**: Prevents timing attacks on client secrets
3. **Revocation List TTL**: Matches access token TTL to minimize storage
4. **Client Authentication**: Required for introspection and revocation
5. **Information Disclosure Prevention**: Revocation always returns success per RFC 7009

## Configuration Guide

### Minimal Setup (No Enterprise Features)

```ts
import { issuer } from "@openauthjs/openauth"
import { MemoryStorage } from "@openauthjs/openauth/storage/memory"

const app = issuer({
  storage: MemoryStorage(),
  subjects,
  providers,
  success: async (ctx) => ctx.subject("user", { userID: "123" }),
})
```

### Production Setup (All Features)

```ts
import { issuer } from "@openauthjs/openauth"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"
import { AuditService } from "@openauthjs/openauth/services/audit"

export default {
  async fetch(request: Request, env: Env) {
    const app = issuer({
      // KV storage for tokens
      storage: CloudflareStorage({
        namespace: env.AUTH_KV,
      }),

      // D1 for client credentials
      clientDb: env.AUTH_DB,

      // D1 for audit logging
      audit: {
        service: new AuditService({
          database: env.AUDIT_DB,
        }),
        hooks: {
          onTokenGenerated: true,
          onTokenRefreshed: true,
          onTokenRevoked: true,
          onTokenReused: true,
        },
      },

      // CORS for multiple frontends
      cors: {
        origins: env.ALLOWED_ORIGINS.split(","),
        credentials: true,
      },

      // Standard config
      subjects,
      providers,
      success: async (ctx, value) => {
        // Your user lookup/creation logic
        return ctx.subject("user", { userID })
      },
    })

    return app.fetch(request, env)
  },
}
```

### Cloudflare Workers wrangler.toml

```toml
name = "openauth"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "AUTH_DB"
database_name = "openauth-clients"
database_id = "xxx"

[[d1_databases]]
binding = "AUDIT_DB"
database_name = "openauth-audit"
database_id = "yyy"

[[kv_namespaces]]
binding = "AUTH_KV"
id = "zzz"

[vars]
ALLOWED_ORIGINS = "https://app.example.com,https://admin.example.com"
```

## Testing

### Running Tests

```bash
# Run all tests
bun test

# Run specific test files
bun test test/client-authenticator.test.ts
bun test test/revocation-service.test.ts
bun test test/audit-service.test.ts
bun test test/enterprise-endpoints.test.ts
```

### Test Coverage

The implementation includes comprehensive tests:

- **ClientAuthenticator**: PBKDF2 hashing, validation, constant-time comparison
- **RevocationService**: Token revocation, revocation checks, cleanup
- **AuditService**: Event logging, querying, data retention
- **Enterprise Endpoints**: Introspection, revocation, client auth, audit hooks
- **Integration Tests**: Full OAuth flows with all features enabled

### Example Test

```ts
import { describe, test, expect } from "bun:test"
import { ClientAuthenticator } from "@openauthjs/openauth/client/authenticator"

describe("ClientAuthenticator", () => {
  test("validates client credentials", async () => {
    const authenticator = new ClientAuthenticator({ adapter })

    await authenticator.createClient("test-client", "secret-key", "Test Client")

    const isValid = await authenticator.validateClient(
      "test-client",
      "secret-key",
    )

    expect(isValid).toBe(true)
  })
})
```

## Migration Guide

### Upgrading Existing Deployments

1. **No Breaking Changes**: All enterprise features are opt-in and backward compatible.

2. **Enable Features Incrementally**:

   ```ts
   // Step 1: Add client credentials (optional)
   const app = issuer({
     ...existingConfig,
     clientDb: env.AUTH_DB,
   })

   // Step 2: Add audit logging (optional)
   const app = issuer({
     ...existingConfig,
     audit: {
       service: new AuditService({ database: env.AUDIT_DB }),
       hooks: { onTokenGenerated: true },
     },
   })

   // Step 3: Add CORS (optional)
   const app = issuer({
     ...existingConfig,
     cors: {
       origins: ["https://app.example.com"],
     },
   })
   ```

3. **Database Migrations**: Run SQL schema for D1 databases before enabling features.

4. **Testing**: Test in staging environment before production deployment.

### Database Setup

```bash
# Create D1 databases
npx wrangler d1 create openauth-clients
npx wrangler d1 create openauth-audit

# Run migrations
npx wrangler d1 execute openauth-clients --file=./schema/clients.sql
npx wrangler d1 execute openauth-audit --file=./schema/audit.sql
```

## RBAC Security

### Overview

The RBAC (Role-Based Access Control) system includes built-in security protections to prevent common attack vectors and misconfigurations.

### Security Features

#### 1. System Role Protection

System roles are protected from modification and deletion. This prevents accidental or malicious changes to core roles like `admin` or `super_admin`.

```typescript
// Creating a system role
await rbacService.createRole({
  name: "admin",
  tenantId: "tenant-1",
  description: "Administrator role",
  isSystemRole: true, // Mark as system role
})

// This will throw: cannot_modify_system_role
await rbacService.updateRole({
  roleId: "admin-role-id",
  tenantId: "tenant-1",
  name: "new-name",
})
```

#### 2. Self-Grant Prevention

Users cannot assign roles to themselves, preventing privilege escalation through self-assignment.

```typescript
// This will throw: self_assignment_denied
await rbacService.assignRoleToUser({
  userId: "user-123",
  roleId: "admin-role",
  tenantId: "tenant-1",
  assignedBy: "user-123", // Same as userId - blocked!
})
```

#### 3. Privilege Escalation Prevention

Users can only assign system roles they already possess. This prevents a user with limited privileges from granting themselves (through another account) higher privileges.

```typescript
// User "user-123" does NOT have the "super-admin" role
// This will throw: privilege_escalation_denied
await rbacService.assignRoleToUser({
  userId: "user-456",
  roleId: "super-admin", // System role that user-123 doesn't have
  tenantId: "tenant-1",
  assignedBy: "user-123",
})

// However, if user-123 HAS the "super-admin" role, they can assign it
await rbacService.assignRoleToUser({
  userId: "user-456",
  roleId: "super-admin",
  tenantId: "tenant-1",
  assignedBy: "user-with-super-admin", // Has the role - allowed!
})
```

### Error Codes

| Error Code                    | HTTP Status | Description                                        |
| ----------------------------- | ----------- | -------------------------------------------------- |
| `cannot_modify_system_role`   | 403         | Attempted to update a system role                  |
| `cannot_delete_system_role`   | 403         | Attempted to delete a system role                  |
| `self_assignment_denied`      | 403         | User tried to assign a role to themselves          |
| `privilege_escalation_denied` | 403         | User tried to assign a system role they don't have |

### API Behavior

The admin endpoints return appropriate HTTP status codes:

```bash
# Attempt to modify system role
PATCH /admin/rbac/roles/:roleId
# Returns 403 with: {"error": "cannot_modify_system_role", "message": "Cannot modify system role"}

# Attempt self-assignment
POST /admin/rbac/users/:userId/roles
# Returns 403 with: {"error": "self_assignment_denied", "message": "Cannot assign roles to yourself"}

# Attempt privilege escalation
POST /admin/rbac/users/:userId/roles
# Returns 403 with: {"error": "privilege_escalation_denied", "message": "Cannot assign a system role you do not have"}
```

### Best Practices for RBAC Security

1. **Mark critical roles as system roles** - Use `is_system_role: true` for roles like `admin`, `super_admin`, etc.

2. **Implement role hierarchy** - Design your role structure so that higher-privilege roles include lower-privilege ones

3. **Audit role assignments** - Monitor the audit logs for role assignment events

4. **Use separate service accounts** - For automated role assignments, use dedicated service accounts with appropriate permissions

5. **Regular access reviews** - Periodically review role assignments to ensure least-privilege access

## Best Practices

1. **Separate D1 Databases**: Use different databases for clients and audit logs for better isolation

2. **Audit Log Retention**: Implement regular cleanup based on your compliance requirements

3. **Client Secret Rotation**: Provide tooling for clients to rotate secrets periodically

4. **Monitor Reuse Events**: Set up alerts for `event_type: "reused"` in audit logs

5. **CORS Configuration**: Use environment variables for origins to support multiple environments

6. **Access Token TTL**: Keep short (15 minutes) for better security with revocation support

7. **Refresh Token Family**: Track token chains using `getTokenFamily()` for forensics

## Support & Resources

- **Documentation**: https://openauth.js.org
- **GitHub Issues**: https://github.com/toolbeam/openauth/issues
- **Discord Community**: https://sst.dev/discord
- **RFC 7662 Spec**: https://datatracker.ietf.org/doc/html/rfc7662
- **RFC 7009 Spec**: https://datatracker.ietf.org/doc/html/rfc7009
