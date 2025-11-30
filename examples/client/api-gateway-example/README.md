# API Gateway with Enterprise Features Example

This example demonstrates how to build an API gateway that uses OpenAuth's optional enterprise features with graceful degradation.

## Features

- **Feature Detection**: Automatically detects if introspection/revocation are available
- **Graceful Degradation**: Works with or without enterprise features
- **Token Validation**: Uses introspection when available, JWT verification when not
- **Caching**: Caches introspection results for performance
- **Express Integration**: Ready-to-use Express middleware

## Use Cases

This pattern is ideal for:

- API Gateways validating tokens for backend services
- Microservices architecture requiring token validation
- Multi-tenant applications with varying security requirements
- Progressive feature rollout (start with JWT, upgrade to introspection)

## Installation

```bash
npm install express @openauthjs/openauth
```

## Configuration

```bash
# Required
OAUTH_ISSUER=https://auth.example.com
OAUTH_CLIENT_ID=api-gateway

# Optional: Enable enterprise features
OAUTH_CLIENT_SECRET=your-client-secret

# Optional: Cache settings
INTROSPECTION_CACHE_TTL=300  # 5 minutes
```

## Usage

### Basic Setup

```typescript
import express from "express"
import { createAuthMiddleware } from "./auth-middleware"

const app = express()

// Create middleware (automatically detects features)
const authMiddleware = await createAuthMiddleware({
  issuer: process.env.OAUTH_ISSUER!,
  clientID: process.env.OAUTH_CLIENT_ID!,
  clientSecret: process.env.OAUTH_CLIENT_SECRET,
})

// Protected routes
app.get("/api/users", authMiddleware, (req, res) => {
  // req.user is populated with subject data
  res.json({ user: req.user })
})

// Sensitive operations - force introspection
app.delete(
  "/api/users/:id",
  authMiddleware({ forceIntrospection: true }),
  (req, res) => {
    res.json({ deleted: req.params.id })
  },
)

app.listen(3001)
```

### Feature Detection

The middleware automatically detects available features on startup:

```typescript
const authMiddleware = await createAuthMiddleware({
  issuer: "https://auth.example.com",
  clientID: "api-gateway",
  clientSecret: "secret", // Optional
})

// Check what's available
console.log(authMiddleware.features)
// {
//   introspection: true,  // Available
//   revocation: true,     // Available
//   validation: "hybrid"  // Uses both methods
// }
```

## How It Works

### 1. Feature Detection on Startup

```typescript
// Check if introspection is available (returns 501 if not)
const response = await fetch(`${issuer}/token/introspect`, {
  method: "POST",
  headers: {
    Authorization: `Basic ${Buffer.from(`${clientID}:${clientSecret}`).toString("base64")}`,
  },
  body: new URLSearchParams({ token: "test" }),
})

const introspectionAvailable = response.status !== 501
```

### 2. Token Validation Strategy

```typescript
if (introspectionAvailable && clientSecret) {
  // Use server-side introspection (more secure)
  const result = await introspectToken(token)
  return result.active ? result : null
} else {
  // Fall back to local JWT verification (still secure)
  const verified = await client.verify(subjects, token)
  return verified.err ? null : verified.subject
}
```

### 3. Caching for Performance

```typescript
// Cache introspection results (5 minute TTL by default)
const cacheKey = `introspection:${token}`
const cached = cache.get(cacheKey)

if (cached) {
  return cached
}

const result = await introspectToken(token)
cache.set(cacheKey, result, ttl)
```

## Validation Methods

### Introspection (Server-Side)

**Pros:**

- Real-time validation
- Detects revoked tokens immediately
- Server controls token validity
- Required for compliance in some industries

**Cons:**

- Requires network request
- Higher latency
- More server load
- Requires client secret

**Use for:**

- Payment processing
- Account changes
- Admin operations
- Data deletion

### JWT Verification (Local)

**Pros:**

- No network request (fast)
- Lower server load
- Works offline
- No client secret needed

**Cons:**

- Can't detect revoked tokens until expiry
- Relies on token expiration
- No real-time validation

**Use for:**

- Regular API requests
- Public data access
- High-throughput operations
- Read-only operations

## Deployment Scenarios

### Scenario 1: Start Simple

```typescript
// Basic setup - no enterprise features
const authMiddleware = await createAuthMiddleware({
  issuer: "https://auth.example.com",
  clientID: "api-gateway",
  // No clientSecret - uses JWT verification only
})

// Result:
// - Features: { introspection: false, validation: "jwt" }
// - Works perfectly for most use cases
// - Fast and efficient
```

### Scenario 2: Add Security Later

```typescript
// Enable enterprise features by adding client secret
const authMiddleware = await createAuthMiddleware({
  issuer: "https://auth.example.com",
  clientID: "api-gateway",
  clientSecret: process.env.OAUTH_CLIENT_SECRET, // 👈 Added
})

// Result:
// - Features: { introspection: true, validation: "hybrid" }
// - Uses introspection for sensitive operations
// - Falls back to JWT for regular operations
// - No code changes needed!
```

### Scenario 3: Server Not Ready

```typescript
// Client is configured but server doesn't have clientDb yet
const authMiddleware = await createAuthMiddleware({
  issuer: "https://auth.example.com",
  clientID: "api-gateway",
  clientSecret: "secret", // Configured
})

// Result:
// - Features: { introspection: false, validation: "jwt" }
// - Server returns 501, middleware automatically falls back
// - When server adds clientDb, middleware detects it (after restart)
// - Graceful degradation - no errors, no downtime
```

## Testing

### Test with Basic Server (No Enterprise Features)

```bash
# Start basic issuer
cd examples/issuer/cloudflare
wrangler dev issuer.ts

# Start API gateway
cd examples/client/api-gateway-example
npm run dev

# Check features
curl http://localhost:3001/features
# { "introspection": false, "validation": "jwt" }

# Test request (uses JWT verification)
curl -H "Authorization: Bearer <token>" http://localhost:3001/api/users
```

### Test with Enterprise Server

```bash
# Start enterprise issuer
cd examples/issuer/cloudflare
wrangler dev issuer-with-enterprise-features.ts --config wrangler-with-enterprise.toml

# Restart API gateway (detects new features)
npm run dev

# Check features
curl http://localhost:3001/features
# { "introspection": true, "validation": "hybrid" }

# Test request (uses introspection for sensitive ops)
curl -H "Authorization: Bearer <token>" http://localhost:3001/api/admin/delete
```

## Performance Comparison

### JWT Verification (Local)

- **Latency**: ~1-2ms
- **Throughput**: 10,000+ req/sec
- **Server Load**: Minimal (CPU only)

### Introspection (Server-Side)

- **Latency**: ~50-100ms (with cache: ~1-2ms)
- **Throughput**: 1,000 req/sec (with cache: 10,000+ req/sec)
- **Server Load**: Database + network

### Hybrid Approach (Recommended)

- **Regular Operations**: JWT verification (~1-2ms)
- **Sensitive Operations**: Introspection (~50-100ms)
- **Best of Both**: Fast and secure

## Best Practices

1. **Cache Introspection Results**

   ```typescript
   cache.set(token, result, 300) // 5 minutes
   ```

2. **Use JWT for Regular Operations**

   ```typescript
   app.get("/api/data", authMiddleware, handler)
   ```

3. **Use Introspection for Sensitive Operations**

   ```typescript
   app.delete(
     "/api/users/:id",
     authMiddleware({ forceIntrospection: true }),
     handler,
   )
   ```

4. **Monitor Feature Availability**

   ```typescript
   setInterval(async () => {
     const available = await checkIntrospectionAvailability()
     metrics.gauge("introspection.available", available ? 1 : 0)
   }, 60000)
   ```

5. **Handle Failures Gracefully**
   ```typescript
   try {
     return await introspectToken(token)
   } catch (error) {
     console.warn("Introspection failed, falling back to JWT")
     return await verifyJWT(token)
   }
   ```

## See Also

- [Enterprise Features Guide](../../../docs/ENTERPRISE_FEATURES.md)
- [Cloudflare Issuer Examples](../../issuer/cloudflare/README.md)
- [Next.js Client Example](../nextjs/)
