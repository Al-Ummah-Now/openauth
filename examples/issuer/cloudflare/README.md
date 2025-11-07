# Cloudflare Workers Issuer Examples

This directory contains examples showing how to deploy OpenAuth on Cloudflare Workers.

## Examples

### 1. Basic Setup (issuer.ts)

**What it includes:**
- KV storage for tokens ✅
- Password authentication ✅
- Works out of the box ✅

**What it does NOT include:**
- ❌ Client credentials
- ❌ Token introspection endpoint (returns 501)
- ❌ Token revocation endpoint (returns 501)
- ❌ Audit logging

**Use when:**
- Getting started with OpenAuth
- Simple authentication needs
- Development/testing

**Deploy:**
```bash
wrangler deploy
```

### 2. With Enterprise Features (issuer-with-enterprise-features.ts)

**What it includes:**
- KV storage for tokens ✅
- Password authentication ✅
- Client credentials (D1) ✅
- Token introspection endpoint ✅
- Token revocation endpoint ✅
- Audit logging with queue ✅
- Global CORS configuration ✅

**Use when:**
- Production deployments
- Need compliance/audit trail
- Multiple client applications
- High traffic (10,000+ req/sec)

**Deploy:**
```bash
# 1. Create databases
wrangler d1 create openauth-clients
wrangler d1 create openauth-audit

# 2. Create queue
wrangler queues create audit-events-queue

# 3. Update wrangler-with-enterprise.toml with database IDs

# 4. Run migrations
wrangler d1 execute openauth-clients --file=../../../schema/clients.sql
wrangler d1 execute openauth-audit --file=../../../schema/audit.sql

# 5. Deploy
wrangler deploy --config wrangler-with-enterprise.toml
```

## Feature Comparison

| Feature | Basic Setup | With Enterprise Features |
|---------|------------|-------------------------|
| OAuth 2.0 authorization | ✅ | ✅ |
| Token generation | ✅ | ✅ |
| Token refresh | ✅ | ✅ |
| KV storage | ✅ | ✅ |
| **Client credentials** | ❌ | ✅ D1 database |
| **Token introspection** | ❌ (501) | ✅ POST /token/introspect |
| **Token revocation** | ❌ (501) | ✅ POST /token/revoke |
| **Audit logging** | ❌ | ✅ D1 + Queue |
| **Global CORS** | ⚠️ Default | ✅ Configurable |
| **Monthly cost** | ~$5 | ~$5-10 |

## Migration Path

Start with the basic setup, then enable features as needed:

### Step 1: Basic Setup
```typescript
issuer({
  storage: CloudflareStorage({ namespace: env.CloudflareAuthKV }),
  subjects,
  providers,
  success: async (ctx, value) => ctx.subject("user", { userID })
})
```

### Step 2: Add Client Credentials (Optional)
```typescript
issuer({
  storage: CloudflareStorage({ namespace: env.CloudflareAuthKV }),
  clientDb: env.AUTH_DB,  // 👈 Enables introspection & revocation
  subjects,
  providers,
  success: async (ctx, value) => ctx.subject("user", { userID })
})
```

### Step 3: Add Audit Logging (Optional)
```typescript
issuer({
  storage: CloudflareStorage({ namespace: env.CloudflareAuthKV }),
  clientDb: env.AUTH_DB,
  audit: {  // 👈 Enables audit logging
    service: new AuditService({
      database: env.AUDIT_DB,
      queue: env.AUDIT_QUEUE  // Optional: Queue for high performance
    }),
    hooks: { onTokenGenerated: true }
  },
  subjects,
  providers,
  success: async (ctx, value) => ctx.subject("user", { userID })
})
```

## Testing Endpoints

### Basic Setup

```bash
# Authorization works
curl https://your-worker.workers.dev/authorize?...

# Token generation works
curl -X POST https://your-worker.workers.dev/token \
  -d "grant_type=authorization_code&code=..."

# Introspection returns 501 (not enabled)
curl -X POST https://your-worker.workers.dev/token/introspect \
  -H "Authorization: Basic $(echo -n client:secret | base64)" \
  -d "token=..."
# Response: {"error":"unsupported_operation","error_description":"Token introspection is not enabled"}

# Revocation returns 501 (not enabled)
curl -X POST https://your-worker.workers.dev/token/revoke \
  -H "Authorization: Basic $(echo -n client:secret | base64)" \
  -d "token=..."
# Response: {"error":"unsupported_operation","error_description":"Token revocation is not enabled"}
```

### With Enterprise Features

```bash
# All basic endpoints work
curl https://your-worker.workers.dev/authorize?...
curl -X POST https://your-worker.workers.dev/token ...

# Introspection works
curl -X POST https://your-worker.workers.dev/token/introspect \
  -H "Authorization: Basic $(echo -n client:secret | base64)" \
  -d "token=eyJhbGci..."
# Response: {"active":true,"token_type":"Bearer","exp":1704153600,...}

# Revocation works
curl -X POST https://your-worker.workers.dev/token/revoke \
  -H "Authorization: Basic $(echo -n client:secret | base64)" \
  -d "token=user:abc123:token-id"
# Response: {} (success)
```

## Resources

- [OpenAuth Documentation](https://openauth.js.org)
- [Enterprise Features Guide](../../../docs/ENTERPRISE_FEATURES.md)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Cloudflare D1 Docs](https://developers.cloudflare.com/d1/)
- [Cloudflare Queues Docs](https://developers.cloudflare.com/queues/)
