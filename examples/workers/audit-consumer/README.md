# Queue-Based Audit Logging Example

This example shows how to enable optional queue-based audit logging for better performance at high traffic volumes.

## Two Deployment Options

### Option 1: Single Worker (Recommended - Simpler)

One worker handles both:

- OAuth issuer (HTTP requests)
- Queue consumer (audit events)

**Pros**: Simpler deployment, fewer resources
**Cons**: Queue processing shares resources with OAuth

### Option 2: Separate Workers (High Traffic)

Two workers:

- Issuer worker (OAuth only)
- Consumer worker (audit queue only)

**Pros**: Independent scaling, isolated resources
**Cons**: More complex deployment

This example shows **Option 1 (single worker)** - see below for Option 2.

## When to Use Queue-Based Logging

Queue-based logging is **optional**. Use it when you configure your `AuditService` with a queue:

```typescript
// In your issuer worker:
const auditService = new AuditService({
  database: env.DB,
  queue: env.AUDIT_QUEUE, // Optional - enables queue-based audit logging
})
```

**If you don't provide a queue**, the `AuditService` writes directly to D1 (default behavior) and you don't need this consumer worker.

## Benefits of Queue-Based Audit Logging

- **Faster writes**: Queue writes are faster than D1 writes
- **Better scalability**: Consumer can batch multiple events in a single transaction
- **Resilient**: Automatic retries and dead letter queue for failed events
- **Non-blocking**: OAuth flows are never blocked by audit logging

## Setup

### 1. Create D1 Database

```bash
wrangler d1 create openauth-audit
```

Apply the schema:

```sql
CREATE TABLE token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  event_type TEXT NOT NULL,
  client_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  timestamp INTEGER NOT NULL,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_subject ON token_usage(subject);
CREATE INDEX IF NOT EXISTS idx_token_id ON token_usage(token_id);
CREATE INDEX IF NOT EXISTS idx_event_type ON token_usage(event_type);
CREATE INDEX IF NOT EXISTS idx_timestamp ON token_usage(timestamp);
CREATE INDEX IF NOT EXISTS idx_subject_timestamp ON token_usage(subject, timestamp);
CREATE INDEX IF NOT EXISTS idx_client_id ON token_usage(client_id);
```

### 2. Create Queue

```bash
wrangler queues create audit-events-queue
```

### 3. Configure wrangler.toml

Update the database ID in `wrangler.toml` with your D1 database ID:

```toml
[[d1_databases]]
binding = "AUDIT_DB"
database_name = "openauth-audit"
database_id = "your-database-id-here"  # Replace with actual ID
```

### 4. Deploy

```bash
bun install
wrangler deploy
```

### 5. Configure Your Issuer

Update your issuer worker to use the queue:

```typescript
import { AuditService } from "openauth/services/audit"

const auditService = new AuditService({
  database: env.DB, // For analytics queries
  queue: env.AUDIT_QUEUE, // For writing audit events
})
```

Add queue binding to your issuer's `wrangler.toml`:

```toml
[[queues.producers]]
binding = "AUDIT_QUEUE"
queue = "audit-events-queue"
```

## Testing

Send a test message to verify the consumer works:

```bash
wrangler queues producer audit-events-queue send '{
  "version": 1,
  "event": {
    "token_id": "test-token",
    "subject": "user:test",
    "event_type": "generated",
    "timestamp": 1234567890
  },
  "enqueued_at": 1234567890
}'
```

Check if the event was written to D1:

```bash
wrangler d1 execute openauth-audit --command "SELECT * FROM token_usage WHERE token_id = 'test-token'"
```

## Monitoring

Key metrics to monitor:

- **Queue Depth**: Should stay below 1000 under normal load
- **Consumer Error Rate**: Should be < 1%
- **Dead Letter Queue**: Should be empty (messages that failed after 3 retries)

You can view these metrics in the Cloudflare dashboard under Queues.

## Architecture Options

### Option 1: Single Combined Worker (This Example)

```
Single Worker (export default)
├─ fetch() - OAuth issuer (HTTP)
│     ↓ (publishes audit events)
└─ queue() - Audit consumer
       ↓ (batch insert)
   D1 Database
```

**Benefits**:

- One worker to deploy and manage
- Simpler configuration
- Shared environment bindings
- Lower cost (one worker vs two)

**Recommendation**: Use this unless you have **very high traffic** (10,000+ requests/sec)

### Option 2: Separate Workers (High Traffic Only)

If you need independent scaling:

**Issuer Worker** (`issuer/src/index.ts`):

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const auditService = new AuditService({
      database: env.AUDIT_DB,
      queue: env.AUDIT_QUEUE, // Publishes to queue
    })
    // ... issuer config
  },
}
```

**Consumer Worker** (`consumer/src/index.ts`):

```typescript
export default {
  async queue(batch: MessageBatch<AuditEventMessage>, env: Env): Promise<void> {
    await handleAuditBatch(batch, env.AUDIT_DB)
  },
}
```

**When to use separate workers**:

- OAuth issuer needs to scale independently
- Consumer processing is CPU-intensive
- You want different resource limits for each

## Default Behavior (No Queue)

If you don't configure a queue, the `AuditService` writes directly to D1:

```typescript
// No queue = direct D1 writes (default)
const auditService = new AuditService({
  database: env.DB,
})
```

**When to use direct writes**:

- Simple setup needed
- Lower traffic (< 1000 requests/sec)
- You don't need batch processing

**When to use queue-based**:

- High traffic (> 1000 requests/sec)
- You want maximum performance
- You need resilient audit logging with retries
