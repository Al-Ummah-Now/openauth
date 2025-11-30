# Client Examples for Enterprise Features

This directory contains client code examples demonstrating how to use OpenAuth's optional enterprise features with graceful degradation.

## Overview

All enterprise features are **OPTIONAL**. Your client code works perfectly whether or not the server has enterprise features enabled. These examples show how to:

1. **Detect available features** - Check if introspection/revocation are enabled
2. **Gracefully degrade** - Fall back to JWT when features aren't available
3. **Use optimal validation** - Introspection for sensitive ops, JWT for regular ops
4. **Handle both scenarios** - Same code works with and without features

## Quick Comparison

| Feature              | Without Enterprise       | With Enterprise                         |
| -------------------- | ------------------------ | --------------------------------------- |
| **Token Validation** | JWT verification (local) | JWT + Introspection (server-side)       |
| **Speed**            | 1-2ms                    | 1-2ms (JWT) or 50-100ms (introspection) |
| **Security**         | Tokens expire naturally  | Can revoke tokens immediately           |
| **Logout**           | Clear local cookies      | Revoke on server + clear cookies        |
| **Code Changes**     | None required            | None required                           |

## Examples

### 1. Next.js with Enterprise Features

**Location**: `examples/client/nextjs/`

**New Files**:

- `app/auth-with-enterprise.ts` - Enhanced auth utilities with feature detection
- `app/actions-with-enterprise.ts` - Server actions with graceful degradation
- `app/enterprise-demo/page.tsx` - Interactive demo page

**Features**:

- Automatic feature detection
- `checkAuth()` with optional introspection
- `logout()` with automatic revocation
- `validateSensitiveOperation()` for admin actions
- Complete working demo page

**Usage**:

```typescript
import { checkAuth, logout, getAuthInfo } from "./auth-with-enterprise"

// Check authentication (uses introspection if available)
const user = await checkAuth({ preferIntrospection: true })

// Get detailed auth info including feature availability
const info = await getAuthInfo()
console.log(info.features.introspection) // true/false
console.log(info.validationMethod) // "introspection" | "local"

// Logout (automatically uses revocation if available)
await logout() // Returns { method: "server" | "local" }
```

**Demo**:

```bash
cd examples/client/nextjs
npm install
npm run dev
# Visit http://localhost:3000/enterprise-demo
```

### 2. API Gateway Example

**Location**: `examples/client/api-gateway-example/`

**Files**:

- `auth-middleware.ts` - Express middleware with feature detection
- `server.ts` - Complete API gateway server
- `README.md` - Detailed usage guide
- `TESTING.md` - Comprehensive testing scenarios

**Features**:

- Express middleware with automatic feature detection
- Result caching for performance
- Force introspection for sensitive endpoints
- Works with any Node.js framework
- Production-ready error handling

**Usage**:

```typescript
import { createAuthMiddleware } from "./auth-middleware"

const authMiddleware = await createAuthMiddleware({
  issuer: "https://auth.example.com",
  clientID: "api-gateway",
  clientSecret: process.env.CLIENT_SECRET, // Optional
})

// Regular endpoint (uses JWT by default)
app.get("/api/data", authMiddleware(), (req, res) => {
  res.json({ user: req.user })
})

// Sensitive endpoint (forces introspection if available)
app.delete(
  "/api/users/:id",
  authMiddleware({ forceIntrospection: true }),
  (req, res) => {
    res.json({ deleted: req.params.id })
  },
)

// Check what features are available
console.log(authMiddleware.features)
// {
//   introspection: true,
//   revocation: true,
//   validation: "hybrid"
// }
```

**Demo**:

```bash
cd examples/client/api-gateway-example
npm install
npm run dev
# Visit http://localhost:3001/features
```

### 3. Documentation

**Location**: `examples/client/ENTERPRISE_FEATURES_USAGE.md`

**Content**:

- Feature detection patterns
- Graceful degradation strategies
- Complete code examples
- Best practices
- Use case scenarios

## Key Patterns

### Pattern 1: Feature Detection

Check if features are available before using them:

```typescript
// Check introspection availability
const response = await fetch(`${issuer}/token/introspect`, {
  method: "POST",
  headers: { Authorization: `Basic ${credentials}` },
  body: new URLSearchParams({ token: "test" }),
})

if (response.status === 501) {
  console.log("Introspection not available - using JWT")
} else {
  console.log("Introspection available")
}
```

### Pattern 2: Graceful Degradation

Automatically fall back when features aren't available:

```typescript
async function validateToken(token: string) {
  // Try introspection if available
  if (introspectionAvailable) {
    try {
      return await introspectToken(token)
    } catch {
      // Fall back to JWT on error
    }
  }

  // Use JWT verification
  return await verifyJWT(token)
}
```

### Pattern 3: Hybrid Validation

Use the right method for each operation:

```typescript
// Fast validation for regular operations
const user = await checkAuth({ preferIntrospection: false })

// Secure validation for sensitive operations
const admin = await checkAuth({ preferIntrospection: true })
```

### Pattern 4: Transparent Logout

Logout works the same way regardless of features:

```typescript
async function logout() {
  // Try server revocation if available
  if (revocationAvailable) {
    await revokeOnServer(refreshToken)
  }

  // Always clear local tokens
  clearLocalTokens()
}
```

## Testing Scenarios

All examples include testing for these scenarios:

### Scenario 1: Basic Server (No Enterprise Features)

**Setup**: Server without `clientDb`
**Expected**: Client uses JWT verification for everything
**Result**: ✅ All operations work, fast response times

### Scenario 2: Enterprise Server (With Features)

**Setup**: Server with `clientDb`, `audit`, etc.
**Expected**: Client uses hybrid validation (JWT + introspection)
**Result**: ✅ Regular ops use JWT, sensitive ops use introspection

### Scenario 3: Progressive Migration

**Setup**: Start with basic, deploy enterprise features
**Expected**: Client automatically detects new features
**Result**: ✅ No downtime, seamless migration

### Scenario 4: Server Rollback

**Setup**: Rollback from enterprise to basic
**Expected**: Client falls back to JWT automatically
**Result**: ✅ No errors, graceful degradation

## Performance Comparison

### JWT Verification (Local)

- **Latency**: 1-2ms
- **Throughput**: 10,000+ req/sec
- **Use for**: Regular operations, high-traffic endpoints

### Introspection (Server-Side)

- **Latency**: 50-100ms (without cache), 1-2ms (with cache)
- **Throughput**: 1,000 req/sec (without cache), 10,000+ (with cache)
- **Use for**: Sensitive operations, admin actions, payments

### Hybrid (Recommended)

- **Strategy**: JWT for regular, introspection for sensitive
- **Result**: Fast AND secure
- **Implementation**: Automatic in all examples

## Configuration

### Client Configuration

```typescript
// Basic (JWT only)
const client = createClient({
  issuer: "https://auth.example.com",
  clientID: "my-app",
})

// With enterprise features
const client = createClient({
  issuer: "https://auth.example.com",
  clientID: "my-app",
  clientSecret: process.env.CLIENT_SECRET, // 👈 Enables introspection
})
```

### Environment Variables

```bash
# Required
OAUTH_ISSUER=https://auth.example.com
OAUTH_CLIENT_ID=my-app

# Optional (enables enterprise features)
OAUTH_CLIENT_SECRET=your-secret

# Optional (tuning)
INTROSPECTION_CACHE_TTL=300  # 5 minutes
```

## Best Practices

### 1. Use JWT by Default

```typescript
// ✅ Good - Fast and efficient
app.get("/api/data", authMiddleware(), handler)

// ❌ Bad - Unnecessary overhead
app.get("/api/data", authMiddleware({ forceIntrospection: true }), handler)
```

### 2. Use Introspection for Sensitive Operations

```typescript
// ✅ Good - Maximum security
app.delete(
  "/api/users/:id",
  authMiddleware({ forceIntrospection: true }),
  handler,
)
app.post("/api/payments", authMiddleware({ forceIntrospection: true }), handler)

// ⚠️ Acceptable but less secure
app.delete("/api/users/:id", authMiddleware(), handler)
```

### 3. Cache Introspection Results

```typescript
// ✅ Good - 5 minute cache
const cached = cache.get(token)
if (cached) return cached

const result = await introspectToken(token)
cache.set(token, result, 300)
```

### 4. Handle Failures Gracefully

```typescript
// ✅ Good - Falls back on error
try {
  return await introspectToken(token)
} catch {
  console.warn("Introspection failed, falling back to JWT")
  return await verifyJWT(token)
}

// ❌ Bad - Fails on error
return await introspectToken(token)
```

### 5. Monitor Feature Availability

```typescript
// ✅ Good - Track feature status
setInterval(async () => {
  const available = await checkIntrospectionAvailability()
  metrics.gauge("introspection.available", available ? 1 : 0)
}, 60000)
```

## Migration Guide

### Step 1: Start with Basic Client

```typescript
// Works with basic server
const client = createClient({
  issuer: "https://auth.example.com",
  clientID: "my-app",
})
```

### Step 2: Add Feature Detection (Optional)

```typescript
// Prepare for enterprise features
const client = createClient({
  issuer: "https://auth.example.com",
  clientID: "my-app",
  clientSecret: process.env.CLIENT_SECRET || undefined,
})

// Check availability
const introspectionAvailable = await checkIntrospectionAvailability()
```

### Step 3: Enable on Server

```typescript
// Server adds clientDb
issuer({
  storage: CloudflareStorage({ namespace: env.KV }),
  clientDb: env.AUTH_DB, // 👈 Enables introspection/revocation
  // ...
})
```

### Step 4: Client Automatically Detects

```typescript
// Client code doesn't change!
// Automatically uses introspection when available
const user = await checkAuth({ preferIntrospection: true })
```

## Common Questions

### Q: Do I need to change my client code when enabling enterprise features?

**A**: No! All examples use graceful degradation. Your code works the same way whether or not enterprise features are enabled.

### Q: What happens if I force introspection but it's not available?

**A**: The client automatically falls back to JWT verification. No errors, no service interruption.

### Q: Should I always use introspection if it's available?

**A**: No. Use introspection for sensitive operations (admin, payments, deletions). Use JWT for regular operations (reads, listings) for better performance.

### Q: How do I know if my server has enterprise features enabled?

**A**: Check for HTTP 501 responses:

```typescript
const response = await fetch(`${issuer}/token/introspect`, { ... })
if (response.status === 501) {
  console.log("Not enabled")
} else {
  console.log("Enabled")
}
```

### Q: Can I use these patterns with other frameworks?

**A**: Yes! The patterns work with any framework:

- Next.js ✅ (example provided)
- Express ✅ (example provided)
- Fastify ✅ (adapt Express example)
- Hono ✅ (adapt Express example)
- SvelteKit ✅ (adapt Next.js example)
- Any Node.js framework ✅

### Q: What's the performance impact of introspection?

**A**: Without cache: ~50-100ms per request. With cache: ~1-2ms (same as JWT). Our examples include caching by default.

## Resources

- [Enterprise Features Overview](../issuer/cloudflare/README.md)
- [API Gateway Testing Guide](api-gateway-example/TESTING.md)
- [Feature Usage Documentation](ENTERPRISE_FEATURES_USAGE.md)
- [OpenAuth Documentation](https://openauth.js.org)

## Support

For questions or issues:

1. Check the [Testing Guide](api-gateway-example/TESTING.md)
2. Review [Common Questions](#common-questions)
3. See [Best Practices](#best-practices)
4. Open an issue on GitHub
