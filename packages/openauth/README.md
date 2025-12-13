# @al-ummah-now/openauth

OpenAuth with enterprise features for the AlUmmahNow Identity Platform.

## Installation

```bash
npm install @al-ummah-now/openauth
# or
pnpm add @al-ummah-now/openauth
```

**Note:** This package is published to GitHub Packages. Configure your `.npmrc`:

```
@al-ummah-now:registry=https://npm.pkg.github.com
```

## Features

This fork extends [OpenAuth](https://github.com/openauthjs/openauth) with enterprise capabilities:

- **Multi-tenant Support** - Full tenant isolation with configurable strategies
- **RBAC (Role-Based Access Control)** - Roles, permissions, and token enrichment
- **User Management** - Complete user lifecycle with D1 storage
- **Dynamic Providers** - Runtime-configurable identity providers
- **M2M Authentication** - Machine-to-machine token support with scopes
- **Client Management** - OAuth client registration and secrets
- **Enterprise Middleware** - Rate limiting, tenant isolation, bearer auth with JWKS

## Quick Start

### Basic Issuer

```typescript
import { issuer } from "@al-ummah-now/openauth"
import { PasswordProvider } from "@al-ummah-now/openauth/provider/password"
import { PasswordUI } from "@al-ummah-now/openauth/ui/password"
import { MemoryStorage } from "@al-ummah-now/openauth/storage/memory"
import { createSubjects } from "@al-ummah-now/openauth/subject"
import { object, string } from "valibot"

const subjects = createSubjects({
  user: object({
    userId: string(),
    tenantId: string(),
  }),
})

const app = issuer({
  providers: {
    password: PasswordProvider(
      PasswordUI({
        sendCode: async (email, code) => {
          console.log(`Code for ${email}: ${code}`)
        },
      }),
    ),
  },
  subjects,
  storage: MemoryStorage(),
  async success(ctx, value) {
    // Lookup or create user
    return ctx.subject("user", {
      userId: "user-123",
      tenantId: "tenant-1",
    })
  },
})

export default app
```

### Multi-tenant Enterprise Issuer

```typescript
import { createMultiTenantIssuer } from "@al-ummah-now/openauth/enterprise"

const app = createMultiTenantIssuer({
  // ... providers and subjects
  tenantResolver: async (ctx) => {
    return ctx.req.header("x-tenant-id") || "default"
  },
  rbac: {
    enabled: true,
    adapter: rbacAdapter,
    storage: storage,
  },
})
```

## RBAC Usage

### Setup

```typescript
import { RBACAdapter, RBACServiceImpl } from "@al-ummah-now/openauth/rbac"

const adapter = new RBACAdapter(env.DB)
const rbacService = new RBACServiceImpl(adapter, storage)
```

### Admin API Routes

```
POST   /admin/rbac/roles                              - Create role
GET    /admin/rbac/roles                              - List roles
GET    /admin/rbac/roles/:roleId                      - Get role
PATCH  /admin/rbac/roles/:roleId                      - Update role
DELETE /admin/rbac/roles/:roleId                      - Delete role

POST   /admin/rbac/clients/:clientId/permissions      - Create permission
GET    /admin/rbac/clients/:clientId/permissions      - List permissions
DELETE /admin/rbac/clients/:clientId/permissions/:id  - Delete permission

POST   /admin/rbac/users/:userId/roles                - Assign role
GET    /admin/rbac/users/:userId/roles                - List user roles
DELETE /admin/rbac/users/:userId/roles/:roleId        - Remove role

POST   /admin/rbac/roles/:roleId/permissions          - Assign permission
GET    /admin/rbac/roles/:roleId/permissions          - List role permissions
DELETE /admin/rbac/roles/:roleId/permissions/:id      - Remove permission
```

### Check Permissions

```typescript
const hasPermission = await rbacService.checkPermission({
  userId: "user-123",
  clientId: "my-app",
  tenantId: "tenant-1",
  permission: "posts:read",
})
```

## Middleware

```typescript
import {
  bearerAuth,
  requireScope,
  rateLimit,
  enterpriseAuth,
} from "@al-ummah-now/openauth/middleware"

// Bearer token validation
app.use("/api/*", bearerAuth({ issuer: "https://auth.example.com" }))

// Require specific scope
app.use("/api/admin/*", requireScope("admin:write"))

// Rate limiting
app.use(
  "/api/*",
  rateLimit({
    requests: 100,
    window: 60000,
    storage,
  }),
)

// Combined enterprise auth
app.use(
  "/api/*",
  enterpriseAuth({
    issuer: "https://auth.example.com",
    rateLimit: { requests: 100, window: 60000, storage },
  }),
)
```

## User Management

```typescript
import {
  createUserService,
  createD1UserAdapter,
} from "@al-ummah-now/openauth/user"

const userAdapter = createD1UserAdapter(env.DB)
const userService = createUserService(userAdapter, storage)

// Create user
const user = await userService.createUser({
  tenantId: "tenant-1",
  email: "user@example.com",
  profile: { name: "John Doe" },
})

// Find by email
const found = await userService.findByEmail("tenant-1", "user@example.com")
```

## M2M Authentication

```typescript
import { generateM2MToken, validateScopes } from "@al-ummah-now/openauth/m2m"

const token = await generateM2MToken({
  clientId: "service-client",
  clientSecret: "secret",
  scopes: ["read:users", "write:users"],
  issuer: "https://auth.example.com",
  signingKey: privateKey,
})
```

## Database Migrations

Run migrations using the CLI:

```bash
npx openauth migrate --db ./path/to/d1.db
```

## Documentation

- [OpenAuth Documentation](https://openauth.js.org)
- [API Reference](https://github.com/Al-Ummah-Now/openauth)

## License

MIT
