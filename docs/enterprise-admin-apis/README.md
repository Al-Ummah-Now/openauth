# Enterprise Admin APIs

This folder contains the design documentation for OpenAuth Enterprise Admin APIs feature.

## Overview

Enterprise Admin APIs provide machine-to-machine (M2M) authentication and RESTful management APIs for:

- **Users** - CRUD operations, identity linking, session management
- **Roles & Permissions** - RBAC management
- **Identity Providers** - Dynamic provider configuration
- **OAuth Clients** - M2M client management

## Documentation

| Document                                                                     | Description                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------ |
| [PROVIDER_CONFIGURATION_REFERENCE.md](./PROVIDER_CONFIGURATION_REFERENCE.md) | Complete reference for all 18 identity providers |
| [PROVIDER_SCHEMA.json](./PROVIDER_SCHEMA.json)                               | Machine-readable schema for UI/validation        |
| [PROVIDER_TYPES.md](./PROVIDER_TYPES.md)                                     | TypeScript interfaces                            |
| [PROVIDER_QUICK_REFERENCE.md](./PROVIDER_QUICK_REFERENCE.md)                 | Copy-paste examples                              |

## Feature Summary

### 1. M2M Authentication

Standard OAuth2 `client_credentials` grant without requiring a provider.

```bash
POST /token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=my-backend-service
&client_secret=xxx
&scope=users:read roles:write
```

**Token Claims:**

```json
{
  "mode": "m2m",
  "sub": "my-backend-service",
  "client_id": "my-backend-service",
  "tenant_id": "tenant-123",
  "scope": "users:read roles:write",
  "exp": 1234571490
}
```

### 2. User Management APIs

```
GET    /api/users                    # List users
GET    /api/users/:id                # Get user with identities
POST   /api/users                    # Create user
PATCH  /api/users/:id                # Update user
DELETE /api/users/:id                # Soft delete
POST   /api/users/:id/suspend        # Suspend + revoke sessions
DELETE /api/users/:id/sessions       # Revoke all sessions
```

### 3. Roles & Permissions APIs

```
GET    /api/roles                    # List roles
POST   /api/roles                    # Create role
GET    /api/roles/:id                # Get role with permissions
PATCH  /api/roles/:id                # Update role
DELETE /api/roles/:id                # Delete role
POST   /api/roles/:id/permissions    # Assign permissions
DELETE /api/roles/:id/permissions/:permId

GET    /api/users/:id/roles          # Get user's roles
POST   /api/users/:id/roles          # Assign role
DELETE /api/users/:id/roles/:roleId  # Remove role
```

### 4. Dynamic Identity Providers APIs

```
GET    /api/providers                # List tenant providers
POST   /api/providers                # Create provider
GET    /api/providers/:id            # Get (secrets masked)
PATCH  /api/providers/:id            # Update
DELETE /api/providers/:id            # Delete
```

### 5. OAuth Client Management APIs

```
GET    /api/clients                  # List M2M clients
POST   /api/clients                  # Register client
GET    /api/clients/:id              # Get client (no secret)
PATCH  /api/clients/:id              # Update client
DELETE /api/clients/:id              # Delete client
POST   /api/clients/:id/rotate       # Rotate secret
```

## Database Migrations

### 005_user_management.sql

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER,
  deleted_at INTEGER,
  UNIQUE(tenant_id, email) WHERE deleted_at IS NULL
);

CREATE TABLE user_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_data TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(tenant_id, provider, provider_user_id)
);
```

### 006_identity_providers.sql

```sql
CREATE TABLE identity_providers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  client_id TEXT,
  client_secret_encrypted TEXT,
  client_secret_iv TEXT,
  config TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(tenant_id, name)
);
```

## Scopes

| Scope               | Description                    |
| ------------------- | ------------------------------ |
| `users:read`        | List/get users                 |
| `users:write`       | Create/update users            |
| `users:delete`      | Delete/suspend users           |
| `roles:read`        | List/get roles                 |
| `roles:write`       | Create/update roles            |
| `roles:delete`      | Delete roles                   |
| `permissions:read`  | List permissions               |
| `permissions:write` | Create/delete permissions      |
| `providers:read`    | List providers                 |
| `providers:write`   | Create/update/delete providers |
| `clients:read`      | List OAuth clients             |
| `clients:write`     | Create/update/delete clients   |

## File Structure

```
packages/openauth/src/
├── m2m/                          # M2M Authentication
│   ├── index.ts
│   ├── types.ts
│   └── handler.ts
├── user/                         # User Management
│   ├── index.ts
│   ├── types.ts
│   ├── service.ts
│   ├── d1-adapter.ts
│   └── api.ts
├── enterprise/
│   └── identity-provider/        # Dynamic Providers
│       ├── index.ts
│       ├── types.ts
│       ├── service.ts
│       ├── factory.ts
│       ├── loader.ts
│       ├── cache.ts
│       └── api.ts
├── security/
│   └── encryption.ts             # AES-256-GCM for secrets
└── rbac/
    └── admin-endpoints.ts        # Extended CRUD endpoints
```

## Implementation Phases

| Phase | Features                    | Effort |
| ----- | --------------------------- | ------ |
| 1     | M2M token endpoint          | 2 days |
| 2     | User table + CRUD APIs      | 3 days |
| 3     | Complete RBAC REST APIs     | 2 days |
| 4     | Dynamic Providers           | 5 days |
| 5     | Scope-based auth middleware | 1 day  |
| 6     | Secret encryption + audit   | 2 days |

## Security

- **Secrets**: AES-256-GCM encryption at rest
- **M2M Tokens**: 1 hour TTL, no refresh token
- **Client Auth**: HTTP Basic or POST body (RFC 6749 compliant)
- **Scopes**: Validated against client's allowed scopes
- **Tenant Isolation**: All APIs are tenant-scoped
