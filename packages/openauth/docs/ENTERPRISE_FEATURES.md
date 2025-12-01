# OpenAuth Enterprise Features

## Executive Summary

OpenAuth Enterprise extends the core authentication library with enterprise-grade features designed for multi-tenant SaaS applications. This document provides comprehensive documentation for:

- **Multi-Account Sessions**: Allow users to be logged into multiple accounts simultaneously (up to 3 per browser)
- **Multi-Tenant Architecture**: Complete tenant isolation with white-label branding support
- **Role-Based Access Control (RBAC)**: Granular permission management with token enrichment
- **OIDC Compliance**: Support for `prompt`, `max_age`, `login_hint`, and `account_hint` parameters

These features integrate seamlessly with OpenAuth's existing OAuth 2.0/OIDC implementation, adding enterprise capabilities while maintaining backward compatibility.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Quick Start](#quick-start)
3. [Session Management](#session-management)
4. [Multi-Tenant Architecture](#multi-tenant-architecture)
5. [Role-Based Access Control (RBAC)](#role-based-access-control-rbac)
6. [Enterprise Issuer](#enterprise-issuer)
7. [API Reference](#api-reference)
8. [Security Considerations](#security-considerations)
9. [Configuration Reference](#configuration-reference)

---

## Architecture Overview

### Component Diagram

```
+-------------------+     +-------------------+     +-------------------+
|                   |     |                   |     |                   |
|  Tenant Service   |     | Session Service   |     |  RBAC Service     |
|                   |     |                   |     |                   |
+--------+----------+     +--------+----------+     +--------+----------+
         |                         |                         |
         |                         |                         |
         v                         v                         v
+------------------------------------------------------------------------+
|                                                                        |
|                      Enterprise Multi-Tenant Issuer                    |
|                                                                        |
|  +----------------+  +----------------+  +----------------+             |
|  | Tenant         |  | Session        |  | RBAC           |             |
|  | Resolver       |  | Middleware     |  | Enricher       |             |
|  +----------------+  +----------------+  +----------------+             |
|                                                                        |
+------------------------------------------------------------------------+
         |                         |                         |
         v                         v                         v
+-------------------+     +-------------------+     +-------------------+
|  Storage Adapter  |     | Cookie Manager    |     | D1 Database       |
|  (KV/Dynamo)      |     | (JWE Encrypted)   |     | (RBAC Tables)     |
+-------------------+     +-------------------+     +-------------------+
```

### Data Flow

1. **Request arrives** at the enterprise issuer
2. **Tenant Resolution**: Determine tenant from domain/subdomain/header/path
3. **Session Loading**: Decrypt session cookie, load browser/account sessions
4. **Authentication**: Process login via configured providers
5. **RBAC Enrichment**: Add roles and permissions to token claims
6. **Session Update**: Add/update account in browser session
7. **Response**: Issue tokens with tenant-scoped data

---

## Quick Start

### Installation

```bash
npm install @openauthjs/openauth
```

### Basic Enterprise Setup

```typescript
import {
  createMultiTenantIssuer,
  hexToSecret,
} from "@openauthjs/openauth/enterprise"
import { createTenantService } from "@openauthjs/openauth/tenant"
import { SessionServiceImpl } from "@openauthjs/openauth/session"
import { RBACServiceImpl, RBACAdapter } from "@openauthjs/openauth/rbac"
import { DynamoStorage } from "@openauthjs/openauth/storage/dynamo"
import { GoogleProvider } from "@openauthjs/openauth/provider/google"
import { createSubjects } from "@openauthjs/openauth/subject"
import { object, string, array } from "valibot"

// 1. Define subject schema
const subjects = createSubjects({
  user: object({
    userId: string(),
    email: string(),
    tenantId: string(),
    roles: array(string()),
    permissions: array(string()),
  }),
})

// 2. Initialize storage
const storage = DynamoStorage({ table: "auth-storage" })

// 3. Initialize services
const tenantService = createTenantService(storage)
const sessionService = new SessionServiceImpl(storage, {
  maxAccountsPerSession: 3,
  sessionLifetimeSeconds: 7 * 24 * 60 * 60, // 7 days
})

// 4. Optional: Initialize RBAC (requires D1 database)
const rbacAdapter = new RBACAdapter(d1Database)
const rbacService = new RBACServiceImpl(rbacAdapter, storage)

// 5. Create enterprise issuer
const { app } = createMultiTenantIssuer({
  tenantService,
  sessionService,
  rbacService, // Optional
  storage,
  sessionSecret: hexToSecret(process.env.SESSION_SECRET!),
  providers: {
    google: GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  },
  subjects,
  tenantResolver: {
    baseDomain: "auth.example.com",
  },
  onSuccess: async (ctx, value, tenant) => {
    return ctx.subject("user", {
      userId: value.userID,
      email: value.email,
      tenantId: tenant.id,
      roles: value.roles,
      permissions: value.permissions,
    })
  },
})

export default app
```

---

## Session Management

### Overview

The session management system allows users to be logged into multiple accounts within the same browser, similar to Google's multi-account feature. Each browser session can hold up to 3 accounts, with one being "active" at any time.

### Key Concepts

| Concept             | Description                                                  |
| ------------------- | ------------------------------------------------------------ |
| **Browser Session** | Represents a browser instance, stored in encrypted cookie    |
| **Account Session** | Represents a logged-in user account within a browser session |
| **Active Account**  | The currently selected account for the session               |
| **Sliding Window**  | Sessions automatically extend when activity is detected      |

### Browser Session Structure

```typescript
interface BrowserSession {
  id: string // UUID
  tenant_id: string // Tenant this session belongs to
  created_at: number // Unix timestamp (ms)
  last_activity: number // Unix timestamp (ms)
  user_agent: string // Browser user agent
  ip_address: string // Client IP address
  version: number // Optimistic concurrency control
  active_user_id: string | null // Currently active account
  account_user_ids: string[] // All logged-in accounts (max 3)
}
```

### Account Session Structure

```typescript
interface AccountSession {
  id: string // UUID
  browser_session_id: string // Parent browser session
  user_id: string // User identifier
  is_active: boolean // Is this the active account?
  authenticated_at: number // When user authenticated
  expires_at: number // Session expiration
  subject_type: string // Subject type (e.g., "user")
  subject_properties: Record<string, unknown> // User data
  refresh_token: string // Associated refresh token
  client_id: string // Client that initiated auth
}
```

### Storage Keys

Sessions use a hierarchical key structure for efficient lookups:

```
session:browser/{tenant_id}/{session_id}     - Browser session data
session:account/{browser_session_id}/{user_id} - Account session data
session:user/{tenant_id}/{user_id}/{browser_session_id} - User lookup index
```

### Session Configuration

```typescript
interface SessionConfig {
  maxAccountsPerSession: number // Default: 3
  sessionLifetimeSeconds: number // Default: 604800 (7 days)
  slidingWindowSeconds: number // Default: 86400 (1 day)
  cookieName: string // Default: "__session"
}
```

### Cookie Security

Session cookies are encrypted using JWE (JSON Web Encryption):

```typescript
interface SessionCookiePayload {
  sid: string // Browser session ID
  tid: string // Tenant ID
  v: number // Version (optimistic concurrency)
  iat: number // Issued at
}
```

Cookie attributes:

- `HttpOnly: true` - Prevents XSS attacks
- `Secure: true` - HTTPS only (in production)
- `SameSite: Lax` - CSRF protection while allowing redirects
- `Max-Age: 604800` - 7 days

### Using SessionService

```typescript
import { SessionServiceImpl } from "@openauthjs/openauth/session"

// Initialize
const sessionService = new SessionServiceImpl(storage, {
  maxAccountsPerSession: 3,
  sessionLifetimeSeconds: 7 * 24 * 60 * 60,
  slidingWindowSeconds: 24 * 60 * 60,
})

// Create browser session
const browserSession = await sessionService.createBrowserSession({
  tenantId: "tenant-123",
  userAgent: "Mozilla/5.0...",
  ipAddress: "192.168.1.1",
})

// Add account to session
const accountSession = await sessionService.addAccountToSession({
  browserSessionId: browserSession.id,
  userId: "user-456",
  subjectType: "user",
  subjectProperties: { email: "user@example.com" },
  refreshToken: "refresh-token-xyz",
  clientId: "my-app",
  ttl: 7 * 24 * 60 * 60,
})

// Switch active account
await sessionService.switchActiveAccount(browserSession.id, "user-789")

// Remove single account
await sessionService.removeAccount(browserSession.id, "user-456")

// Sign out all accounts
await sessionService.removeAllAccounts(browserSession.id)

// Admin: Revoke all sessions for a user
const revokedCount = await sessionService.revokeUserSessions(
  "tenant-123",
  "user-456",
)

// Admin: Revoke specific session
const revoked = await sessionService.revokeSpecificSession(
  "session-id",
  "tenant-123",
)
```

### Session Middleware

```typescript
import {
  createSessionMiddleware,
  getBrowserSession,
  getActiveAccount,
  requireSession,
  requireActiveAccount,
} from "@openauthjs/openauth/session"

const app = new Hono()

// Apply session middleware
app.use(
  "*",
  createSessionMiddleware(sessionService, sessionSecret, {
    cookieName: "__session",
    autoRefresh: true,
  }),
)

// Access session in routes
app.get("/profile", async (c) => {
  const browserSession = getBrowserSession(c)
  const activeAccount = getActiveAccount(c)

  if (!activeAccount) {
    return c.redirect("/login")
  }

  return c.json({
    userId: activeAccount.user_id,
    email: activeAccount.subject_properties.email,
  })
})

// Require session middleware
app.use("/protected/*", requireSessionMiddleware())
app.use("/api/*", requireActiveAccountMiddleware())
```

### Session API Endpoints

When using the enterprise issuer, these endpoints are automatically mounted:

#### User Session Routes (`/session/*`)

| Endpoint                    | Method | Description                         |
| --------------------------- | ------ | ----------------------------------- |
| `/session/accounts`         | GET    | List all logged-in accounts         |
| `/session/switch`           | POST   | Switch active account               |
| `/session/accounts/:userId` | DELETE | Sign out one account                |
| `/session/all`              | DELETE | Sign out all accounts               |
| `/session/check`            | GET    | Silent session check (CORS enabled) |

#### Admin Session Routes (`/admin/sessions/*`)

| Endpoint                      | Method | Description                    |
| ----------------------------- | ------ | ------------------------------ |
| `/admin/sessions/revoke-user` | POST   | Revoke all sessions for a user |
| `/admin/sessions/revoke`      | POST   | Revoke a specific session      |

---

## Multi-Tenant Architecture

### Overview

Multi-tenancy enables a single OpenAuth deployment to serve multiple organizations with complete data isolation and customizable branding.

### Tenant Resolution Strategies

Tenants are resolved from requests using multiple strategies (in priority order):

1. **Custom Domain**: `auth.clientcorp.com` -> tenant "clientcorp"
2. **Subdomain**: `clientcorp.auth.example.com` -> tenant "clientcorp"
3. **Path Prefix**: `/tenants/clientcorp/authorize` -> tenant "clientcorp"
4. **HTTP Header**: `X-Tenant-ID: clientcorp` -> tenant "clientcorp"
5. **Query Parameter**: `?tenant=clientcorp` -> tenant "clientcorp"

### Tenant Data Model

```typescript
interface Tenant {
  id: string // Unique identifier
  domain?: string // Custom domain (optional)
  name: string // Display name
  status: TenantStatus // "active" | "suspended" | "pending" | "deleted"
  branding: TenantBranding // White-label customization
  settings: TenantSettings // Tenant-specific settings
  created_at: number // Unix timestamp (ms)
  updated_at: number // Unix timestamp (ms)
}

interface TenantBranding {
  theme?: {
    primary?: string // Primary color
    secondary?: string // Secondary color
    background?: string // Background color
    text?: string // Text color
    fontFamily?: string // Font family
  }
  logoLight?: string // Logo URL (light theme)
  logoDark?: string // Logo URL (dark theme)
  favicon?: string // Favicon URL
  customCss?: string // Custom CSS injection
  emailTemplates?: {
    welcome?: string
    verification?: string
    passwordReset?: string
    magicLink?: string
  }
}

interface TenantSettings {
  maxAccountsPerSession?: number // Override default
  sessionLifetime?: number // Override default
  allowPublicRegistration?: boolean // Allow self-registration
  requireEmailVerification?: boolean // Require email verification
  allowedProviders?: string[] // Restrict auth providers
  mfaRequired?: boolean // Require MFA
}
```

### Using TenantService

```typescript
import {
  createTenantService,
  TenantServiceImpl,
} from "@openauthjs/openauth/tenant"

// Initialize
const tenantService = createTenantService(storage, d1Database)

// Create tenant
const tenant = await tenantService.createTenant({
  id: "acme-corp",
  name: "Acme Corporation",
  domain: "auth.acme.com",
  branding: {
    theme: { primary: "#007bff" },
    logoLight: "https://acme.com/logo.png",
  },
  settings: {
    allowPublicRegistration: true,
    requireEmailVerification: true,
  },
})

// Get tenant
const tenant = await tenantService.getTenant("acme-corp")

// Get tenant by domain
const tenant = await tenantService.getTenantByDomain("auth.acme.com")

// Update tenant
const updated = await tenantService.updateTenant("acme-corp", {
  name: "Acme Corp Inc.",
  branding: {
    theme: { primary: "#0066cc" },
  },
})

// Delete tenant (soft delete)
await tenantService.deleteTenant("acme-corp")

// List tenants
const tenants = await tenantService.listTenants({
  status: "active",
  limit: 100,
  offset: 0,
})
```

### Tenant Resolver Middleware

```typescript
import {
  createTenantResolver,
  getTenant,
  getTenantStorage,
  requireTenant,
} from "@openauthjs/openauth/tenant"

const app = new Hono()

// Apply tenant resolver
app.use(
  "*",
  createTenantResolver({
    service: tenantService,
    storage,
    config: {
      baseDomain: "auth.example.com",
      headerName: "X-Tenant-ID",
      queryParam: "tenant",
    },
    optional: false, // Tenant is required
  }),
)

// Access tenant in routes
app.get("/info", async (c) => {
  const tenant = getTenant(c)
  const tenantStorage = getTenantStorage(c)

  return c.json({
    tenantId: tenant.id,
    tenantName: tenant.name,
  })
})

// Require tenant middleware
app.use("/api/*", requireTenant())
```

### Theme Middleware

```typescript
import {
  createTenantThemeMiddleware,
  buildCssVars,
  generateThemeStyles,
} from "@openauthjs/openauth/tenant"

// Apply theme middleware (after tenant resolver)
app.use("*", createTenantThemeMiddleware())

// Theme CSS variables are available in responses
// --oa-primary, --oa-secondary, --oa-background, --oa-text, --oa-font-family
```

### Tenant-Scoped Storage

All OAuth data is automatically prefixed with the tenant ID:

```
t:{tenantId}:oauth:code:{code}
t:{tenantId}:oauth:refresh:{subject}:{token}
t:{tenantId}:client:{clientId}
```

### Tenant API Endpoints

| Endpoint                | Method | Description                 |
| ----------------------- | ------ | --------------------------- |
| `/tenants`              | POST   | Create tenant               |
| `/tenants`              | GET    | List tenants                |
| `/tenants/:id`          | GET    | Get tenant by ID            |
| `/tenants/:id`          | PUT    | Update tenant               |
| `/tenants/:id`          | DELETE | Delete tenant (soft delete) |
| `/tenants/:id/branding` | PUT    | Update branding only        |
| `/tenants/:id/settings` | PUT    | Update settings only        |

---

## Role-Based Access Control (RBAC)

### Overview

RBAC provides fine-grained authorization by organizing permissions into roles that are assigned to users. Permissions are scoped to applications, and roles are scoped to tenants.

### Key Concepts

| Concept        | Description                                          |
| -------------- | ---------------------------------------------------- |
| **App**        | An application that defines its own permissions      |
| **Permission** | A specific action on a resource (e.g., `posts:read`) |
| **Role**       | A named collection of permissions                    |
| **User Role**  | Assignment of a role to a user (may have expiration) |

### Data Models

```typescript
interface App {
  id: string // Unique identifier (e.g., "admin-dashboard")
  name: string // Display name
  tenant_id: string // Owner tenant
  description?: string
  created_at: number
}

interface Permission {
  id: string // UUID
  name: string // Format: "resource:action" (e.g., "posts:read")
  app_id: string // App that owns this permission
  description?: string
  resource: string // Resource being protected (e.g., "posts")
  action: string // Action being permitted (e.g., "read")
  created_at: number
}

interface Role {
  id: string // UUID
  name: string // Unique within tenant (e.g., "editor")
  tenant_id: string // Owner tenant
  description?: string
  is_system_role: boolean // Cannot be deleted
  created_at: number
  updated_at: number
}

interface UserRole {
  user_id: string
  role_id: string
  tenant_id: string
  assigned_at: number
  expires_at?: number // Optional expiration
  assigned_by: string // Admin who assigned
}
```

### Permission Checking

```typescript
import { RBACServiceImpl, RBACAdapter } from "@openauthjs/openauth/rbac"

// Initialize
const rbacAdapter = new RBACAdapter(d1Database)
const rbacService = new RBACServiceImpl(rbacAdapter, storage, {
  maxPermissionsInToken: 50,
  permissionCacheTTL: 60, // seconds
})

// Check single permission
const allowed = await rbacService.checkPermission({
  userId: "user-123",
  appId: "my-app",
  tenantId: "tenant-1",
  permission: "posts:read",
})

// Check multiple permissions
const results = await rbacService.checkPermissions({
  userId: "user-123",
  appId: "my-app",
  tenantId: "tenant-1",
  permissions: ["posts:read", "posts:write", "posts:delete"],
})
// { "posts:read": true, "posts:write": true, "posts:delete": false }

// Get all permissions for user in app
const permissions = await rbacService.getUserPermissions({
  userId: "user-123",
  appId: "my-app",
  tenantId: "tenant-1",
})
// ["posts:read", "posts:write", "users:read"]

// Get user roles
const roles = await rbacService.getUserRoles("user-123", "tenant-1")
```

### Token Enrichment

RBAC claims are automatically added to tokens when `rbacService` is configured:

```typescript
// Token payload includes:
{
  "sub": "user-123",
  "aud": "my-app",
  "roles": ["editor", "viewer"],
  "permissions": ["posts:read", "posts:write", "users:read"],
  "tenant_id": "tenant-1"
}
```

Manual enrichment:

```typescript
import { enrichTokenWithRBAC } from "@openauthjs/openauth/rbac"

const claims = await enrichTokenWithRBAC(rbacService, {
  userId: "user-123",
  appId: "my-app",
  tenantId: "tenant-1",
})
// { roles: ["editor"], permissions: ["posts:read", "posts:write"] }
```

### Admin Operations

```typescript
// Create app
const app = await rbacService.createApp({
  id: "my-app",
  name: "My Application",
  tenantId: "tenant-1",
  description: "A sample application",
})

// Create role
const role = await rbacService.createRole({
  name: "editor",
  tenantId: "tenant-1",
  description: "Can edit content",
  isSystemRole: false,
})

// Create permission
const permission = await rbacService.createPermission({
  name: "posts:write",
  appId: "my-app",
  resource: "posts",
  action: "write",
  description: "Write blog posts",
})

// Assign permission to role
await rbacService.assignPermissionToRole({
  roleId: role.id,
  permissionId: permission.id,
  grantedBy: "admin-user",
})

// Assign role to user
await rbacService.assignRoleToUser({
  userId: "user-123",
  roleId: role.id,
  tenantId: "tenant-1",
  assignedBy: "admin-user",
  expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
})

// Remove role from user
await rbacService.removeRoleFromUser({
  userId: "user-123",
  roleId: role.id,
  tenantId: "tenant-1",
})
```

### Permission Caching

Permissions are cached with a configurable TTL (default 60 seconds) for performance:

```typescript
const rbacService = new RBACServiceImpl(rbacAdapter, storage, {
  permissionCacheTTL: 120, // 2 minutes
})
```

Cache is automatically invalidated when:

- Role is assigned/removed from user
- Permission is assigned/removed from role

### RBAC API Endpoints

#### Permission Check Routes (`/rbac/*`)

| Endpoint            | Method | Description                  |
| ------------------- | ------ | ---------------------------- |
| `/rbac/check`       | POST   | Check single permission      |
| `/rbac/check/batch` | POST   | Check multiple permissions   |
| `/rbac/permissions` | GET    | Get user permissions for app |
| `/rbac/roles`       | GET    | Get user roles               |

#### Admin RBAC Routes (`/rbac/admin/*`)

| Endpoint                                              | Method | Description                     |
| ----------------------------------------------------- | ------ | ------------------------------- |
| `/rbac/admin/apps`                                    | POST   | Create app                      |
| `/rbac/admin/apps`                                    | GET    | List apps                       |
| `/rbac/admin/roles`                                   | POST   | Create role                     |
| `/rbac/admin/roles`                                   | GET    | List roles                      |
| `/rbac/admin/permissions`                             | POST   | Create permission               |
| `/rbac/admin/permissions`                             | GET    | List permissions (query: appId) |
| `/rbac/admin/users/:userId/roles`                     | POST   | Assign role to user             |
| `/rbac/admin/users/:userId/roles/:roleId`             | DELETE | Remove role from user           |
| `/rbac/admin/users/:userId/roles`                     | GET    | List user's role assignments    |
| `/rbac/admin/roles/:roleId/permissions`               | POST   | Assign permission to role       |
| `/rbac/admin/roles/:roleId/permissions/:permissionId` | DELETE | Remove permission from role     |
| `/rbac/admin/roles/:roleId/permissions`               | GET    | List role's permissions         |

---

## Enterprise Issuer

### Overview

The `createMultiTenantIssuer` factory function creates a complete OAuth/OIDC server with all enterprise features integrated.

### Configuration

```typescript
interface EnterpriseIssuerConfig {
  // Required
  tenantService: TenantService
  sessionService: SessionService
  storage: StorageAdapter
  sessionSecret: Uint8Array // 256-bit key
  providers: Record<string, Provider>
  subjects: SubjectSchema

  // Optional
  rbacService?: RBACService
  sessionConfig?: Partial<SessionConfig>
  clientDb?: D1Database
  theme?: Theme
  ttl?: {
    access?: number
    refresh?: number
    reuse?: number
    retention?: number
  }

  // Callbacks
  onSuccess?: (ctx, value, tenant) => Promise<Response>
  onAllow?: (input, req, tenant) => Promise<boolean>

  // Tenant resolver config
  tenantResolver?: {
    baseDomain?: string
    pathPrefix?: string
    headerName?: string // Default: "X-Tenant-ID"
    queryParam?: string // Default: "tenant"
    customDomains?: Map<string, string>
  }

  // CORS config
  cors?: {
    origins: string[]
    credentials?: boolean
    methods?: string[]
    headers?: string[]
    maxAge?: number
  }
}
```

### OIDC Parameters Support

The enterprise issuer supports these OIDC parameters:

| Parameter      | Values                                       | Description                         |
| -------------- | -------------------------------------------- | ----------------------------------- |
| `prompt`       | `none`, `login`, `consent`, `select_account` | Control auth UI behavior            |
| `login_hint`   | email or user ID                             | Pre-fill login form                 |
| `account_hint` | user ID                                      | Select specific logged-in account   |
| `max_age`      | seconds                                      | Force re-auth if session older than |
| `nonce`        | string                                       | For ID token replay protection      |

#### prompt=none (Silent Authentication)

Returns error if user is not already authenticated:

```
GET /authorize?
  client_id=my-app&
  redirect_uri=https://myapp.com/callback&
  response_type=code&
  prompt=none

// If authenticated: redirects with code
// If not authenticated: redirects with error=login_required
```

#### prompt=login (Force Re-authentication)

Always shows login UI, even if user is authenticated:

```
GET /authorize?
  client_id=my-app&
  redirect_uri=https://myapp.com/callback&
  response_type=code&
  prompt=login
```

#### prompt=select_account (Account Picker)

Shows account picker if multiple accounts are logged in:

```
GET /authorize?
  client_id=my-app&
  redirect_uri=https://myapp.com/callback&
  response_type=code&
  prompt=select_account
```

### Well-Known Endpoints

| Endpoint                                  | Description                  |
| ----------------------------------------- | ---------------------------- |
| `/.well-known/openid-configuration`       | OIDC Discovery document      |
| `/.well-known/oauth-authorization-server` | OAuth 2.0 Discovery document |
| `/.well-known/jwks.json`                  | JSON Web Key Set             |

---

## API Reference

### Session Service Interface

```typescript
interface SessionService {
  // Browser session operations
  createBrowserSession(params: {
    tenantId: string
    userAgent: string
    ipAddress: string
  }): Promise<BrowserSession>

  getBrowserSession(
    sessionId: string,
    tenantId: string,
  ): Promise<BrowserSession | null>

  updateBrowserSession(session: BrowserSession): Promise<void>

  // Account session operations
  addAccountToSession(params: {
    browserSessionId: string
    userId: string
    subjectType: string
    subjectProperties: Record<string, unknown>
    refreshToken: string
    clientId: string
    ttl: number
  }): Promise<AccountSession>

  getAccountSession(
    browserSessionId: string,
    userId: string,
  ): Promise<AccountSession | null>

  listAccounts(browserSessionId: string): Promise<AccountSession[]>

  switchActiveAccount(browserSessionId: string, userId: string): Promise<void>

  removeAccount(browserSessionId: string, userId: string): Promise<void>

  removeAllAccounts(browserSessionId: string): Promise<void>

  // Admin operations
  revokeUserSessions(tenantId: string, userId: string): Promise<number>

  revokeSpecificSession(sessionId: string, tenantId: string): Promise<boolean>
}
```

### Tenant Service Interface

```typescript
interface TenantService {
  createTenant(params: {
    id: string
    name: string
    domain?: string
    branding?: TenantBranding
    settings?: TenantSettings
  }): Promise<Tenant>

  getTenant(tenantId: string): Promise<Tenant | null>

  getTenantByDomain(domain: string): Promise<Tenant | null>

  updateTenant(tenantId: string, updates: Partial<Tenant>): Promise<Tenant>

  deleteTenant(tenantId: string): Promise<void>

  listTenants(params?: {
    status?: TenantStatus
    limit?: number
    offset?: number
  }): Promise<Tenant[]>
}
```

### RBAC Service Interface

```typescript
interface RBACService {
  // Permission checking
  checkPermission(params: {
    userId: string
    appId: string
    tenantId: string
    permission: string
  }): Promise<boolean>

  checkPermissions(params: {
    userId: string
    appId: string
    tenantId: string
    permissions: string[]
  }): Promise<Record<string, boolean>>

  getUserPermissions(params: {
    userId: string
    appId: string
    tenantId: string
  }): Promise<string[]>

  getUserRoles(userId: string, tenantId: string): Promise<Role[]>

  // Token enrichment
  enrichTokenClaims(params: {
    userId: string
    appId: string
    tenantId: string
  }): Promise<RBACClaims>

  // Admin operations
  createApp(params): Promise<App>
  createRole(params): Promise<Role>
  createPermission(params): Promise<Permission>
  assignRoleToUser(params): Promise<UserRole>
  removeRoleFromUser(params): Promise<void>
  assignPermissionToRole(params): Promise<RolePermission>
  removePermissionFromRole(params): Promise<void>

  // Listing
  listApps(tenantId: string): Promise<App[]>
  listRoles(tenantId: string): Promise<Role[]>
  listPermissions(appId: string): Promise<Permission[]>
  listRolePermissions(roleId: string): Promise<Permission[]>
  listUserRoles(userId: string, tenantId: string): Promise<UserRole[]>
}
```

---

## Security Considerations

### Session Security

1. **Encrypted Cookies**: Session cookies use JWE encryption with AES-256-GCM
2. **Random Session IDs**: 256-bit cryptographically random session IDs
3. **Version Control**: Optimistic concurrency prevents replay attacks
4. **Tenant Isolation**: Session cookies include tenant ID to prevent cross-tenant hijacking

### Cookie Configuration

```typescript
{
  HttpOnly: true,      // Prevents XSS
  Secure: true,        // HTTPS only (production)
  SameSite: "Lax",     // CSRF protection
  Domain: ".tenant.com", // Cross-subdomain sharing
  MaxAge: 604800       // 7 days
}
```

### RBAC Security

1. **SQL Injection Prevention**: Parameterized queries via D1
2. **Cache Invalidation**: Permissions are invalidated on role/permission changes
3. **JWT Signature Verification**: All tokens are cryptographically verified
4. **Tenant Isolation**: All RBAC queries are scoped to tenant

### Session Secret Management

Generate a secure session secret:

```typescript
import { generateCookieSecret, secretToHex } from "@openauthjs/openauth/session"

// Generate new secret
const secret = generateCookieSecret()
console.log("SESSION_SECRET=" + secretToHex(secret))

// Use in production
const secret = hexToSecret(process.env.SESSION_SECRET!)
```

---

## Configuration Reference

### Default Session Configuration

```typescript
const DEFAULT_SESSION_CONFIG = {
  maxAccountsPerSession: 3,
  sessionLifetimeSeconds: 7 * 24 * 60 * 60, // 7 days
  slidingWindowSeconds: 24 * 60 * 60, // 1 day
  cookieName: "__session",
}
```

### Default RBAC Configuration

```typescript
const DEFAULT_RBAC_CONFIG = {
  maxPermissionsInToken: 50,
  permissionCacheTTL: 60, // seconds
}
```

### Environment Variables

| Variable               | Description                        | Required        |
| ---------------------- | ---------------------------------- | --------------- |
| `SESSION_SECRET`       | 64-character hex string (256 bits) | Yes             |
| `GOOGLE_CLIENT_ID`     | Google OAuth client ID             | If using Google |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret         | If using Google |

### Database Migrations

Run migrations in order:

```bash
wrangler d1 execute openauth-db --file=./src/migrations/001_oauth_clients.sql
wrangler d1 execute openauth-db --file=./src/migrations/002_add_tenant_support.sql
wrangler d1 execute openauth-db --file=./src/migrations/003_session_management.sql
wrangler d1 execute openauth-db --file=./src/migrations/004_rbac_schema.sql
```

---

## Error Handling

### Session Errors

```typescript
type SessionErrorCode =
  | "max_accounts_exceeded" // Trying to add 4th account
  | "session_not_found" // Browser session doesn't exist
  | "account_not_found" // Account not in session
  | "session_expired" // Session has expired
  | "version_conflict" // Concurrent modification
  | "invalid_cookie" // Cookie decryption failed
```

### Tenant Errors

```typescript
type TenantErrorCode =
  | "tenant_not_found" // Tenant doesn't exist
  | "tenant_suspended" // Tenant is suspended
  | "tenant_deleted" // Tenant was deleted
  | "domain_already_exists" // Domain in use by another tenant
  | "invalid_tenant_id" // Invalid tenant ID format
```

### RBAC Errors

```typescript
type RBACErrorCode =
  | "role_not_found" // Role doesn't exist
  | "permission_not_found" // Permission doesn't exist
  | "app_not_found" // App doesn't exist
  | "role_already_assigned" // Role already assigned to user
  | "permission_denied" // User lacks permission
```

---

## Appendix: Complete Endpoint Reference

### OAuth/OIDC Endpoints

| Endpoint                                  | Method | Description            |
| ----------------------------------------- | ------ | ---------------------- |
| `/authorize`                              | GET    | Authorization endpoint |
| `/token`                                  | POST   | Token endpoint         |
| `/userinfo`                               | GET    | UserInfo endpoint      |
| `/.well-known/openid-configuration`       | GET    | OIDC discovery         |
| `/.well-known/oauth-authorization-server` | GET    | OAuth discovery        |
| `/.well-known/jwks.json`                  | GET    | JSON Web Key Set       |

### Session Endpoints

| Endpoint                      | Method | Description              |
| ----------------------------- | ------ | ------------------------ |
| `/session/accounts`           | GET    | List logged-in accounts  |
| `/session/switch`             | POST   | Switch active account    |
| `/session/accounts/:userId`   | DELETE | Sign out one account     |
| `/session/all`                | DELETE | Sign out all accounts    |
| `/session/check`              | GET    | Silent session check     |
| `/admin/sessions/revoke-user` | POST   | Revoke all user sessions |
| `/admin/sessions/revoke`      | POST   | Revoke specific session  |

### Tenant Endpoints

| Endpoint                | Method | Description     |
| ----------------------- | ------ | --------------- |
| `/tenants`              | POST   | Create tenant   |
| `/tenants`              | GET    | List tenants    |
| `/tenants/:id`          | GET    | Get tenant      |
| `/tenants/:id`          | PUT    | Update tenant   |
| `/tenants/:id`          | DELETE | Delete tenant   |
| `/tenants/:id/branding` | PUT    | Update branding |
| `/tenants/:id/settings` | PUT    | Update settings |

### RBAC Endpoints

| Endpoint                                | Method          | Description             |
| --------------------------------------- | --------------- | ----------------------- |
| `/rbac/check`                           | POST            | Check permission        |
| `/rbac/check/batch`                     | POST            | Batch check permissions |
| `/rbac/permissions`                     | GET             | Get user permissions    |
| `/rbac/roles`                           | GET             | Get user roles          |
| `/rbac/admin/apps`                      | POST/GET        | Manage apps             |
| `/rbac/admin/roles`                     | POST/GET        | Manage roles            |
| `/rbac/admin/permissions`               | POST/GET        | Manage permissions      |
| `/rbac/admin/users/:userId/roles`       | POST/GET/DELETE | Manage user roles       |
| `/rbac/admin/roles/:roleId/permissions` | POST/GET/DELETE | Manage role permissions |
