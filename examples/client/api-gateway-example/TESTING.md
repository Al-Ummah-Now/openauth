# Testing API Gateway with Enterprise Features

This guide shows how to test the API gateway with and without enterprise features enabled.

## Test Scenario 1: Basic Server (No Enterprise Features)

### Setup

1. **Start basic issuer** (without `clientDb`):
```bash
cd examples/issuer/cloudflare
wrangler dev issuer.ts
```

2. **Start API gateway** (without client secret):
```bash
cd examples/client/api-gateway-example
cp .env.example .env
# Edit .env - leave OAUTH_CLIENT_SECRET empty
npm install
npm run dev
```

### Expected Behavior

The API gateway should:
- Start successfully
- Detect that introspection is NOT available
- Fall back to JWT verification for all requests
- Work perfectly for all operations

### Testing

```bash
# Check feature availability
curl http://localhost:3001/features

# Expected response:
# {
#   "introspection": false,
#   "revocation": false,
#   "validation": "jwt",
#   "description": {
#     "introspection": "Using local JWT verification",
#     "revocation": "Tokens expire naturally",
#     "validation": "Using local JWT verification only"
#   }
# }

# Get a token first (via OAuth flow or test token)
export TOKEN="your-access-token-here"

# Test regular endpoint (uses JWT)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/users

# Expected response:
# {
#   "user": { ... },
#   "validatedBy": "jwt",
#   "message": "This endpoint uses default validation (fast)"
# }

# Test sensitive endpoint (tries introspection, falls back to JWT)
curl -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/users/123

# Expected response:
# {
#   "deleted": "123",
#   "validatedBy": "jwt",
#   "message": "This endpoint uses introspection when available (secure)"
# }
# Note: Uses JWT because introspection is not available

# Test introspection endpoint
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/introspect

# Expected response (501):
# {
#   "error": "not_implemented",
#   "message": "Introspection not available on auth server",
#   "fallback": "Using JWT verification instead"
# }
```

### Validation

✅ **Success Criteria:**
- Feature detection shows `introspection: false`
- All endpoints work using JWT verification
- No errors or warnings about missing features
- Response times are fast (~1-2ms)

## Test Scenario 2: Enterprise Server (With Enterprise Features)

### Setup

1. **Create D1 databases**:
```bash
cd examples/issuer/cloudflare
wrangler d1 create openauth-clients
wrangler d1 create openauth-audit
wrangler queues create audit-events-queue
```

2. **Update wrangler config** with database IDs:
```bash
# Edit wrangler-with-enterprise.toml
# Replace database_id values with your actual IDs
```

3. **Run migrations**:
```bash
wrangler d1 execute openauth-clients --file=../../../schema/clients.sql
wrangler d1 execute openauth-audit --file=../../../schema/audit.sql
```

4. **Create a test client**:
```bash
# Insert test client credentials
wrangler d1 execute openauth-clients --command="
INSERT INTO oauth_clients (client_id, client_secret_hash, name)
VALUES (
  'api-gateway',
  -- PBKDF2-SHA256 hash of 'test-secret'
  'pbkdf2-sha256\$100000\$...',
  'API Gateway'
)"
```

5. **Start enterprise issuer**:
```bash
wrangler dev issuer-with-enterprise-features.ts --config wrangler-with-enterprise.toml
```

6. **Configure API gateway** with client secret:
```bash
cd examples/client/api-gateway-example
# Edit .env
OAUTH_CLIENT_SECRET=test-secret
npm run dev
```

### Expected Behavior

The API gateway should:
- Start successfully
- Detect that introspection IS available
- Detect that revocation IS available
- Use introspection for sensitive operations
- Use JWT for regular operations
- Cache introspection results for performance

### Testing

```bash
# Check feature availability
curl http://localhost:3001/features

# Expected response:
# {
#   "introspection": true,
#   "revocation": true,
#   "validation": "hybrid",
#   "description": {
#     "introspection": "Server-side token validation available",
#     "revocation": "Token revocation available",
#     "validation": "Using both introspection and JWT based on operation"
#   }
# }

export TOKEN="your-access-token-here"

# Test regular endpoint (uses JWT by default)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/users

# Expected response:
# {
#   "user": { ... },
#   "validatedBy": "jwt",
#   "message": "This endpoint uses default validation (fast)"
# }
# Note: Uses JWT for performance

# Test sensitive endpoint (uses introspection)
curl -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/users/123

# Expected response:
# {
#   "deleted": "123",
#   "validatedBy": "introspection",
#   "message": "This endpoint uses introspection when available (secure)"
# }
# Note: Uses introspection for security

# Test admin endpoint (uses introspection)
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/admin/action

# Expected response:
# {
#   "action": "performed",
#   "performedBy": "user-id",
#   "validatedBy": "introspection",
#   "message": "Admin actions always use strongest validation available"
# }

# Test introspection availability
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/introspect

# Expected response:
# {
#   "available": true,
#   "message": "Introspection is available",
#   "validation": "jwt"
# }
```

### Validation

✅ **Success Criteria:**
- Feature detection shows `introspection: true`, `revocation: true`
- Regular endpoints use JWT verification (fast)
- Sensitive endpoints use introspection (secure)
- No 501 errors
- Caching works (check logs for cache hits)

## Test Scenario 3: Progressive Migration

This scenario tests migrating from basic to enterprise without downtime.

### Setup

1. **Start with basic server** (Scenario 1)
2. **API gateway is running** with JWT verification
3. **Deploy enterprise features** to server (Scenario 2)
4. **Restart API gateway** to detect new features

### Expected Behavior

- No downtime during migration
- API gateway automatically detects new features on restart
- Old tokens continue to work
- New features become available immediately

### Testing

```bash
# Before migration
curl http://localhost:3001/features
# { "introspection": false, "validation": "jwt" }

# Stop basic issuer, start enterprise issuer
# (in another terminal)

# Restart API gateway
# npm run dev

# After migration
curl http://localhost:3001/features
# { "introspection": true, "validation": "hybrid" }

# Test that existing tokens still work
curl -H "Authorization: Bearer $OLD_TOKEN" \
  http://localhost:3001/api/users
# Should work with either JWT or introspection
```

## Test Scenario 4: Server Rollback

Test that API gateway gracefully handles server rollback to basic version.

### Setup

1. **Start with enterprise server** (Scenario 2)
2. **API gateway using introspection**
3. **Rollback server to basic** (remove `clientDb`)
4. **API gateway should auto-detect and fall back**

### Expected Behavior

- Introspection requests return 501
- API gateway falls back to JWT verification
- No errors, warnings, or service interruption
- Users don't notice the change

### Testing

```bash
# With enterprise features
export TOKEN="your-token"
curl -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/users/123
# Uses introspection

# After server rollback
curl -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/users/123
# Falls back to JWT automatically
```

## Performance Testing

### JWT Verification Performance

```bash
# Tool: Apache Bench
ab -n 10000 -c 100 \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/users

# Expected:
# Requests per second: 5000-10000
# Time per request: 0.1-0.2ms (avg)
```

### Introspection Performance (Without Cache)

```bash
# Clear cache first
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/cache/clear

# Test introspection endpoint
ab -n 1000 -c 10 \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/admin/action

# Expected:
# Requests per second: 100-1000
# Time per request: 10-100ms (avg)
```

### Introspection Performance (With Cache)

```bash
# Run twice (second run uses cache)
ab -n 10000 -c 100 \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/admin/action

# Expected:
# Requests per second: 5000-10000
# Time per request: 0.1-0.2ms (avg)
# Similar to JWT performance due to caching
```

## Error Scenarios

### Invalid Token

```bash
curl -H "Authorization: Bearer invalid-token" \
  http://localhost:3001/api/users

# Expected (401):
# {
#   "error": "invalid_token",
#   "error_description": "Token validation failed",
#   "validation_method": "jwt" | "introspection"
# }
```

### Missing Token

```bash
curl http://localhost:3001/api/users

# Expected (401):
# {
#   "error": "unauthorized",
#   "error_description": "Missing Authorization header"
# }
```

### Revoked Token (Enterprise Only)

```bash
# Revoke token on server
curl -X POST \
  -H "Authorization: Basic $(echo -n 'api-gateway:test-secret' | base64)" \
  -d "token=$TOKEN" \
  http://localhost:3000/token/revoke

# Try to use revoked token with introspection
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/admin/action

# Expected (401):
# {
#   "error": "invalid_token",
#   "error_description": "Token validation failed",
#   "validation_method": "introspection"
# }
# Note: Introspection detects revoked token

# Try to use revoked token with JWT verification
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/users

# Expected: Still works (JWT doesn't know about revocation)
# This is why we use introspection for sensitive operations
```

## Troubleshooting

### Issue: API gateway can't detect introspection

**Symptoms:**
- `features.introspection` is always `false`
- Even with client secret configured

**Debug:**
```bash
# Check if server has clientDb
curl http://localhost:3000/token/introspect
# Should NOT return 501

# Check client secret is correct
echo -n 'api-gateway:test-secret' | base64
# Use in Authorization header

# Check API gateway logs
# Should see: "Introspection: ✓ Available"
```

**Solutions:**
- Verify server has `clientDb` configured
- Check client credentials in database
- Verify client secret in `.env`
- Restart API gateway after server changes

### Issue: Introspection is slow

**Symptoms:**
- Response times > 100ms
- High server load

**Debug:**
```bash
# Check cache TTL
echo $INTROSPECTION_CACHE_TTL
# Should be 300 (5 minutes)

# Check if caching is working
# Look for repeated requests with same token
# Second request should be faster
```

**Solutions:**
- Increase cache TTL (e.g., 600 = 10 minutes)
- Use JWT for non-sensitive endpoints
- Check network latency between gateway and auth server
- Consider using a distributed cache (Redis)

## Next Steps

After testing, you can:
1. Deploy to production with basic features
2. Enable enterprise features later without downtime
3. Monitor feature usage and performance
4. Adjust cache TTL based on security requirements
5. Scale gateway horizontally (all instances detect features independently)
