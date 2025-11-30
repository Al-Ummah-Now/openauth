# Database Schema for OpenAuth Enterprise Features

This directory contains SQL schema files for setting up the D1 databases required for OpenAuth enterprise features.

## Overview

OpenAuth uses two separate D1 databases:

1. **oauth_clients** - Stores OAuth client credentials
2. **token_usage** - Stores audit logs for token lifecycle events

## Setup

### 1. Create D1 Databases

```bash
# Create client credentials database
npx wrangler d1 create openauth-clients

# Create audit logs database
npx wrangler d1 create openauth-audit
```

Save the database IDs from the output.

### 2. Update wrangler.toml

Add the database bindings to your `wrangler.toml`:

```toml
[[d1_databases]]
binding = "AUTH_DB"
database_name = "openauth-clients"
database_id = "your-client-db-id"

[[d1_databases]]
binding = "AUDIT_DB"
database_name = "openauth-audit"
database_id = "your-audit-db-id"
```

### 3. Run Migrations

```bash
# Apply client credentials schema
npx wrangler d1 execute openauth-clients --file=./schema/clients.sql

# Apply audit logs schema
npx wrangler d1 execute openauth-audit --file=./schema/audit.sql
```

### 4. Verify Setup

```bash
# List tables in client database
npx wrangler d1 execute openauth-clients --command="SELECT name FROM sqlite_master WHERE type='table'"

# List tables in audit database
npx wrangler d1 execute openauth-audit --command="SELECT name FROM sqlite_master WHERE type='table'"
```

## Schema Details

### oauth_clients Table

Stores OAuth client credentials with PBKDF2-hashed secrets.

| Column             | Type    | Description                           |
| ------------------ | ------- | ------------------------------------- |
| client_id          | TEXT    | Primary key, unique client identifier |
| client_secret_hash | TEXT    | PBKDF2 hash (format: salt:hash)       |
| client_name        | TEXT    | Human-readable client name            |
| redirect_uris      | TEXT    | JSON array of allowed redirect URIs   |
| grant_types        | TEXT    | JSON array of allowed grant types     |
| scopes             | TEXT    | JSON array of allowed scopes          |
| created_at         | INTEGER | Unix timestamp (milliseconds)         |
| updated_at         | INTEGER | Unix timestamp (milliseconds)         |

**Indexes:**

- `idx_client_name` - Fast lookups by client name
- `idx_created_at` - Sorting/filtering by creation date

### token_usage Table

Stores audit logs for all token lifecycle events.

| Column     | Type    | Description                                       |
| ---------- | ------- | ------------------------------------------------- |
| id         | INTEGER | Auto-increment primary key                        |
| token_id   | TEXT    | Token identifier (refresh token ID or JTI)        |
| subject    | TEXT    | Subject identifier (e.g., "user:abc123")          |
| event_type | TEXT    | Event type: generated, refreshed, revoked, reused |
| client_id  | TEXT    | OAuth client identifier (optional)                |
| ip_address | TEXT    | IP address of the request (optional)              |
| user_agent | TEXT    | User agent string (optional)                      |
| timestamp  | INTEGER | Unix timestamp (milliseconds)                     |
| metadata   | TEXT    | JSON object for additional event data (optional)  |

**Indexes:**

- `idx_token_id` - Track token family history
- `idx_subject` - User activity lookups
- `idx_event_type` - Security monitoring (find all "reused" events)
- `idx_timestamp` - Time-based queries
- `idx_subject_timestamp` - Common query pattern
- `idx_client_id` - Client-specific analytics

## Local Development

For local development, you can use the `--local` flag:

```bash
# Create local D1 databases
npx wrangler d1 create openauth-clients --local
npx wrangler d1 create openauth-audit --local

# Apply schemas locally
npx wrangler d1 execute openauth-clients --local --file=./schema/clients.sql
npx wrangler d1 execute openauth-audit --local --file=./schema/audit.sql
```

## Querying Databases

### Client Database Examples

```bash
# List all clients
npx wrangler d1 execute openauth-clients --command="SELECT client_id, client_name, created_at FROM oauth_clients"

# Get specific client
npx wrangler d1 execute openauth-clients --command="SELECT * FROM oauth_clients WHERE client_id = 'my-app'"

# Count clients
npx wrangler d1 execute openauth-clients --command="SELECT COUNT(*) as total FROM oauth_clients"
```

### Audit Database Examples

```bash
# Get recent audit events
npx wrangler d1 execute openauth-audit --command="SELECT * FROM token_usage ORDER BY timestamp DESC LIMIT 10"

# Count events by type
npx wrangler d1 execute openauth-audit --command="SELECT event_type, COUNT(*) as count FROM token_usage GROUP BY event_type"

# Find token reuse events (security incidents)
npx wrangler d1 execute openauth-audit --command="SELECT * FROM token_usage WHERE event_type = 'reused' ORDER BY timestamp DESC"

# Get user activity
npx wrangler d1 execute openauth-audit --command="SELECT * FROM token_usage WHERE subject = 'user:abc123' ORDER BY timestamp DESC"
```

## Maintenance

### Clean Old Audit Logs

```bash
# Delete logs older than 90 days (example)

# For Linux (GNU date):
CUTOFF_TIMESTAMP=$(date -d '90 days ago' +%s)000

# For macOS/BSD (BSD date):
CUTOFF_TIMESTAMP=$(date -v-90d +%s)000

npx wrangler d1 execute openauth-audit --command="DELETE FROM token_usage WHERE timestamp < $CUTOFF_TIMESTAMP"
```

Or use the built-in cleanup method in code:

```ts
import { AuditService } from "@openauthjs/openauth/services/audit"

const auditService = new AuditService({ database: env.AUDIT_DB })

// Clean logs older than 90 days
const deletedCount = await auditService.cleanExpired(90 * 24 * 60 * 60)
console.log(`Deleted ${deletedCount} old audit entries`)
```

### Backup Databases

```bash
# Backup client database
npx wrangler d1 export openauth-clients --output=backup-clients.sql

# Backup audit database
npx wrangler d1 export openauth-audit --output=backup-audit.sql
```

## Troubleshooting

### "Database not found" error

Make sure you've created the databases and updated `wrangler.toml` with the correct database IDs.

### "Table already exists" error

This is safe to ignore. The schema files use `CREATE TABLE IF NOT EXISTS` so they're idempotent.

### Slow queries

Make sure indexes are created. You can verify with:

```bash
npx wrangler d1 execute openauth-audit --command="SELECT name FROM sqlite_master WHERE type='index'"
```

## Production Considerations

1. **Separate Databases**: Use different D1 databases for clients and audit logs for better isolation and scaling.

2. **Regular Backups**: Set up automated backups for the client database (contains sensitive credentials).

3. **Log Retention**: Implement automated cleanup for audit logs based on your compliance requirements.

4. **Monitoring**: Set up alerts for unusual patterns in the `token_usage` table (e.g., spike in "reused" events).

5. **Access Control**: Restrict access to D1 databases in production using Cloudflare Access or API tokens.

## Further Reading

- [Cloudflare D1 Documentation](https://developers.cloudflare.com/d1/)
- [OpenAuth Enterprise Features](../docs/ENTERPRISE_FEATURES.md)
- [Wrangler CLI Reference](https://developers.cloudflare.com/workers/wrangler/)
