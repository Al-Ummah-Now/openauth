# OpenAuth D1 Database Migrations

This directory contains SQL migrations for the OpenAuth enterprise features using Cloudflare D1.

## Migration Order

Migrations must be run in order due to table dependencies:

1. **001_oauth_clients.sql** - Base OAuth clients table (foundation)
2. **002_add_tenant_support.sql** - Multi-tenant support (depends on 001)
3. **003_session_management.sql** - Session tables (depends on 002)
4. **004_rbac_schema.sql** - RBAC tables (depends on 002)

```
001_oauth_clients
       |
       v
002_add_tenant_support
       |
       +----------------+
       |                |
       v                v
003_session_management  004_rbac_schema
```

## Prerequisites

1. Install Wrangler CLI:

   ```bash
   npm install -g wrangler
   ```

2. Authenticate with Cloudflare:
   ```bash
   wrangler login
   ```

## Running Migrations

### Create the D1 Database (First Time Only)

```bash
# Create a new D1 database
wrangler d1 create openauth-db

# Note the database_id from the output and add to wrangler.toml:
# [[d1_databases]]
# binding = "DB"
# database_name = "openauth-db"
# database_id = "<your-database-id>"
```

### Apply All Migrations (Production)

```bash
# Run migrations in order
wrangler d1 execute openauth-db --file=./src/migrations/001_oauth_clients.sql
wrangler d1 execute openauth-db --file=./src/migrations/002_add_tenant_support.sql
wrangler d1 execute openauth-db --file=./src/migrations/003_session_management.sql
wrangler d1 execute openauth-db --file=./src/migrations/004_rbac_schema.sql
```

### Apply Migrations (Local Development)

```bash
# Use --local flag for local D1 database
wrangler d1 execute openauth-db --local --file=./src/migrations/001_oauth_clients.sql
wrangler d1 execute openauth-db --local --file=./src/migrations/002_add_tenant_support.sql
wrangler d1 execute openauth-db --local --file=./src/migrations/003_session_management.sql
wrangler d1 execute openauth-db --local --file=./src/migrations/004_rbac_schema.sql
```

### Verify Migration Success

```bash
# List all tables
wrangler d1 execute openauth-db --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"

# Check table schemas
wrangler d1 execute openauth-db --command=".schema oauth_clients"
wrangler d1 execute openauth-db --command=".schema tenants"
wrangler d1 execute openauth-db --command=".schema browser_sessions"
wrangler d1 execute openauth-db --command=".schema rbac_roles"
```

## Table Reference

### Core Tables

| Table           | Description                    | Primary Key |
| --------------- | ------------------------------ | ----------- |
| `oauth_clients` | OAuth 2.0 client registrations | `client_id` |
| `tenants`       | Multi-tenant organizations     | `id`        |

### Session Tables

| Table              | Description                           | Primary Key |
| ------------------ | ------------------------------------- | ----------- |
| `browser_sessions` | Browser/device sessions               | `id`        |
| `account_sessions` | User account sessions (multi-account) | `id`        |

### RBAC Tables

| Table                   | Description                  | Primary Key                     |
| ----------------------- | ---------------------------- | ------------------------------- |
| `rbac_apps`             | Applications with RBAC       | `id`                            |
| `rbac_roles`            | Named permission collections | `id`                            |
| `rbac_permissions`      | Granular access controls     | `id`                            |
| `rbac_role_permissions` | Role-to-permission mapping   | `(role_id, permission_id)`      |
| `rbac_user_roles`       | User-to-role mapping         | `(user_id, role_id, tenant_id)` |

### Views

| View               | Description                |
| ------------------ | -------------------------- |
| `expired_sessions` | Sessions needing cleanup   |
| `user_permissions` | Flattened user permissions |

## Rollback Strategy

D1 does not support transactional DDL rollbacks. Manual rollback scripts are required.

### Rollback 004_rbac_schema.sql

```sql
DROP VIEW IF EXISTS user_permissions;
DROP TABLE IF EXISTS rbac_user_roles;
DROP TABLE IF EXISTS rbac_role_permissions;
DROP TABLE IF EXISTS rbac_permissions;
DROP TABLE IF EXISTS rbac_roles;
DROP TABLE IF EXISTS rbac_apps;
```

### Rollback 003_session_management.sql

```sql
DROP VIEW IF EXISTS expired_sessions;
DROP TABLE IF EXISTS account_sessions;
DROP TABLE IF EXISTS browser_sessions;
```

### Rollback 002_add_tenant_support.sql

```sql
-- Note: Cannot easily remove column from oauth_clients in SQLite
-- Dropping and recreating the table is required for full rollback
DROP INDEX IF EXISTS idx_oauth_clients_tenant;
DROP TABLE IF EXISTS tenants;

-- To fully remove tenant_id column, recreate oauth_clients:
-- 1. CREATE TABLE oauth_clients_new (without tenant_id)
-- 2. INSERT INTO oauth_clients_new SELECT ... FROM oauth_clients
-- 3. DROP TABLE oauth_clients
-- 4. ALTER TABLE oauth_clients_new RENAME TO oauth_clients
-- 5. Recreate indexes
```

### Rollback 001_oauth_clients.sql

```sql
DROP INDEX IF EXISTS idx_oauth_clients_created;
DROP INDEX IF EXISTS idx_oauth_clients_name;
DROP TABLE IF EXISTS oauth_clients;
```

## Test Data Scripts

### Insert Test Tenant

```sql
INSERT INTO tenants (id, domain, name, status, branding, settings, created_at, updated_at)
VALUES (
    'test-tenant',
    'auth.test.example.com',
    'Test Organization',
    'active',
    '{"theme": {"primary": "#0066cc"}}',
    '{"maxAccountsPerSession": 3, "allowPublicRegistration": true}',
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);
```

### Insert Test OAuth Client

```sql
INSERT INTO oauth_clients (
    client_id, client_secret_hash, client_name,
    redirect_uris, grant_types, scopes,
    tenant_id, created_at, updated_at
)
VALUES (
    'test-client',
    NULL, -- Public client
    'Test Application',
    '["http://localhost:3000/callback"]',
    '["authorization_code", "refresh_token"]',
    '["openid", "profile", "email"]',
    'test-tenant',
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);
```

### Insert Test RBAC App and Permissions

```sql
-- Create test app
INSERT INTO rbac_apps (id, name, tenant_id, description, created_at)
VALUES (
    'app-test',
    'Test Application',
    'test-tenant',
    'Test application for RBAC',
    strftime('%s', 'now') * 1000
);

-- Create test permissions
INSERT INTO rbac_permissions (id, name, app_id, description, resource, action, created_at)
VALUES
    ('perm-docs-read', 'documents:read', 'app-test', 'Read documents', 'documents', 'read', strftime('%s', 'now') * 1000),
    ('perm-docs-write', 'documents:write', 'app-test', 'Write documents', 'documents', 'write', strftime('%s', 'now') * 1000),
    ('perm-docs-delete', 'documents:delete', 'app-test', 'Delete documents', 'documents', 'delete', strftime('%s', 'now') * 1000),
    ('perm-users-read', 'users:read', 'app-test', 'Read users', 'users', 'read', strftime('%s', 'now') * 1000),
    ('perm-users-admin', 'users:admin', 'app-test', 'Administer users', 'users', 'admin', strftime('%s', 'now') * 1000);

-- Create custom role
INSERT INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role-editor',
    'editor',
    'test-tenant',
    'Can read and write documents',
    0,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Assign permissions to role
INSERT INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
VALUES
    ('role-editor', 'perm-docs-read', strftime('%s', 'now') * 1000, 'system'),
    ('role-editor', 'perm-docs-write', strftime('%s', 'now') * 1000, 'system');

-- Assign role to user
INSERT INTO rbac_user_roles (user_id, role_id, tenant_id, assigned_at, expires_at, assigned_by)
VALUES (
    'user-123',
    'role-editor',
    'test-tenant',
    strftime('%s', 'now') * 1000,
    NULL, -- No expiration
    'admin'
);
```

### Query User Permissions

```sql
-- Get all permissions for a user
SELECT * FROM user_permissions
WHERE user_id = 'user-123' AND tenant_id = 'test-tenant';

-- Check specific permission
SELECT COUNT(*) > 0 AS has_permission
FROM user_permissions
WHERE user_id = 'user-123'
  AND tenant_id = 'test-tenant'
  AND app_id = 'app-test'
  AND permission_name = 'documents:write';
```

## Design Notes

### Timestamps

All timestamps use Unix epoch milliseconds (INTEGER) for consistency and timezone independence.

### JSON Columns

JSON data is stored as TEXT columns. Parse with `json()` in queries if needed:

```sql
SELECT json_extract(branding, '$.theme.primary') AS primary_color FROM tenants;
```

### Foreign Keys

Foreign keys are enabled via `PRAGMA foreign_keys = ON` at the start of each migration.
D1 enforces foreign keys, so deletions cascade automatically.

### SQLite Limitations

- `ALTER TABLE ADD COLUMN` cannot add NOT NULL columns without defaults
- `ALTER TABLE DROP COLUMN` is not supported (requires table recreation)
- `ALTER TABLE` cannot add constraints to existing columns

### Indexes

Indexes are created with `IF NOT EXISTS` for idempotency.
Composite indexes support the most common query patterns.

## Troubleshooting

### "table already exists" Error

Migrations use `CREATE TABLE IF NOT EXISTS` - this error should not occur.
If it does, check for partially applied migrations.

### "no such column: tenant_id" Error

Run migrations in order. Migration 002 adds the `tenant_id` column.

### Foreign Key Constraint Failed

Ensure referenced rows exist before inserting. The default tenant is created in migration 002.

### Slow Queries

Check query plans with:

```sql
EXPLAIN QUERY PLAN SELECT * FROM rbac_user_roles WHERE user_id = 'x';
```

Add indexes for frequently queried columns not covered by existing indexes.
