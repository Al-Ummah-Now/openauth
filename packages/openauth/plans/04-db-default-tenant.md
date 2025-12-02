# Database Default Tenant Fallback - Architectural Plan

## Overview

When `createMultiTenantIssuer` is called without a `config.theme`, the system currently has no theme fallback. This plan introduces a database-driven default tenant mechanism that stores default theme configuration in the database, allowing new applications to configure default branding without code changes.

## Problem Statement

Current behavior:

- `createMultiTenantIssuer` accepts optional `config.theme` parameter
- If not provided, the theme middleware falls back to empty theme `{}`
- This requires code changes to update default theme
- Multi-tenant apps have no way to set organization-wide defaults in DB

Desired behavior:

- Support a "default" tenant stored in the database
- When `config.theme` is not provided, fetch default tenant's branding
- Cache the default tenant to avoid DB hits on every request
- Maintain backward compatibility (system works without default tenant)

## Architecture Design

### 1. Default Tenant Identification Strategy

**Option A: Reserved ID** (RECOMMENDED)

```typescript
const DEFAULT_TENANT_ID = "default"
```

**Pros:**

- Simple and explicit
- Easy to query
- No slug normalization issues

**Cons:**

- Blocks "default" as a regular tenant ID
- Less flexible

**Option B: Flag-based**

```typescript
interface Tenant {
  id: string
  is_default: boolean // New field
  // ... existing fields
}
```

**Pros:**

- Any tenant can be marked as default
- More flexible

**Cons:**

- Requires schema change
- More complex queries
- Need uniqueness constraint on is_default

**Decision: Use Option A (Reserved ID)**

- Simpler implementation
- Explicit convention
- Minimal schema impact
- "default" is already a protected keyword in most systems

### 2. Caching Design

**Two-tier caching strategy:**

#### Tier 1: Application Startup Cache (Eager Loading)

```typescript
interface DefaultTenantCache {
  tenant: Tenant | null
  loadedAt: number
  ttl: number // Time-to-live in seconds
}
```

**Loading Strategy:**

- Load default tenant at application startup
- Store in module-level variable
- Use lazy initialization pattern for serverless cold starts

**TTL Strategy:**

- Default: 3600 seconds (1 hour)
- Configurable via `EnterpriseIssuerConfig.defaultTenantCacheTTL`
- Expires after TTL, forces reload on next request

#### Tier 2: Request-level Cache

- Once loaded in a request, reuse for entire request lifecycle
- Avoids multiple fetches in middleware chain
- Stored in Hono context variables

**Cache Invalidation:**

```typescript
// Manual invalidation when default tenant is updated
async function invalidateDefaultTenantCache(): Promise<void> {
  defaultTenantCache.tenant = null
  defaultTenantCache.loadedAt = 0
}
```

**Invalidation Triggers:**

1. Manual API call to `/tenants/default/invalidate` (admin endpoint)
2. TTL expiration (automatic)
3. On `updateTenant("default", ...)` completion (future enhancement)

### 3. TenantService API Additions

**No changes required** - existing API is sufficient:

```typescript
// Use existing method
await tenantService.getTenant("default")
```

**Why no new method needed:**

- "default" is just a regular tenant with special ID
- Existing CRUD operations work as-is
- Simpler architecture with less surface area

### 4. Startup vs Per-Request Loading Tradeoffs

| Approach                       | Pros                                                                          | Cons                                                | Use Case                            |
| ------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------- |
| **Startup Loading**            | - Faster request processing<br>- Predictable performance<br>- Single DB query | - Stale data until restart/TTL<br>- Memory overhead | Long-running servers (Node.js, Bun) |
| **Per-Request Loading**        | - Always fresh data<br>- No memory overhead                                   | - DB hit on every request<br>- Slower response time | Serverless, low-memory              |
| **Lazy + Cache (RECOMMENDED)** | - Best of both worlds<br>- Adapts to runtime                                  | - Slightly complex                                  | Universal (works everywhere)        |

**Decision: Lazy + Cache with TTL**

- First request loads default tenant, caches it
- Subsequent requests use cache until TTL expires
- Works for both long-running and serverless
- Configurable TTL for flexibility

### 5. Implementation Flow

```
┌─────────────────────────────────────────────────────┐
│ createMultiTenantIssuer()                           │
│                                                     │
│ 1. Check config.theme                              │
│    ├─ If provided → Use config.theme               │
│    └─ If null → Continue to default tenant lookup  │
│                                                     │
│ 2. Check defaultTenantCache                        │
│    ├─ Cache hit & not expired → Use cached         │
│    └─ Cache miss/expired → Load from DB            │
│                                                     │
│ 3. await tenantService.getTenant("default")        │
│    ├─ Found → Cache & use default tenant theme     │
│    └─ Not found → Use empty theme {}               │
│                                                     │
│ 4. Apply theme to middleware                       │
│    createTenantThemeMiddleware({                   │
│      defaultTheme: resolvedTheme                   │
│    })                                              │
└─────────────────────────────────────────────────────┘
```

### 6. Configuration Schema

```typescript
interface EnterpriseIssuerConfig {
  // ... existing fields

  /**
   * TTL for default tenant cache in seconds.
   * Default: 3600 (1 hour)
   * Set to 0 to disable caching (always fetch from DB)
   * @default 3600
   */
  defaultTenantCacheTTL?: number

  /**
   * Whether to load default tenant at startup.
   * If false, loads on first request (lazy).
   * @default true for long-running servers, false for serverless
   */
  eagerLoadDefaultTenant?: boolean
}
```

### 7. Error Handling Strategy

**Scenario: Default tenant doesn't exist**

```typescript
const defaultTenant = await tenantService.getTenant("default")
if (!defaultTenant) {
  // Graceful degradation - use empty theme
  console.warn("Default tenant not found, using empty theme")
  return {}
}
```

**Scenario: Default tenant is suspended/deleted**

```typescript
if (defaultTenant.status !== "active") {
  console.warn(`Default tenant status: ${defaultTenant.status}, ignoring`)
  return {}
}
```

**Scenario: DB connection failure**

```typescript
try {
  const defaultTenant = await tenantService.getTenant("default")
  // ... use tenant
} catch (error) {
  console.error("Failed to load default tenant:", error)
  // Fallback to empty theme - don't block app startup
  return {}
}
```

**Key Principle: Never block application startup or requests due to default tenant issues**

### 8. Middleware Integration

**Current theme middleware flow:**

```typescript
app.use("*", createTenantResolver(...))
app.use("*", createTenantThemeMiddleware())
```

**Enhanced flow with default tenant:**

```typescript
// In createMultiTenantIssuer()

// 1. Resolve default theme early
const defaultTheme = await resolveDefaultTheme(
  config.theme,
  config.tenantService,
  config.defaultTenantCacheTTL
)

// 2. Apply tenant resolver
app.use("*", createTenantResolver(...))

// 3. Apply theme middleware with default
app.use("*", createTenantThemeMiddleware({
  defaultTheme
}))
```

**Theme resolution priority:**

1. Tenant-specific theme (if tenant resolved)
2. Config-provided theme (if `config.theme` set)
3. Default tenant theme (from DB)
4. Empty theme `{}`

### 9. Cache Module Structure

```typescript
// src/enterprise/default-tenant-cache.ts

interface DefaultTenantCache {
  tenant: Tenant | null
  loadedAt: number
  ttl: number
}

let cache: DefaultTenantCache = {
  tenant: null,
  loadedAt: 0,
  ttl: 3600,
}

export async function getDefaultTenant(
  service: TenantService,
  ttl: number = 3600,
): Promise<Tenant | null> {
  const now = Date.now()

  // Check cache validity
  if (cache.tenant && now - cache.loadedAt < cache.ttl * 1000) {
    return cache.tenant
  }

  // Load from database
  try {
    const tenant = await service.getTenant("default")

    if (tenant && tenant.status === "active") {
      cache.tenant = tenant
      cache.loadedAt = now
      cache.ttl = ttl
      return tenant
    }

    // Invalid or missing default tenant
    cache.tenant = null
    cache.loadedAt = now
    cache.ttl = ttl
    return null
  } catch (error) {
    console.error("Failed to load default tenant:", error)
    // Don't update cache on error - retry next time
    return null
  }
}

export function invalidateDefaultTenantCache(): void {
  cache.tenant = null
  cache.loadedAt = 0
}

export function getDefaultTheme(
  service: TenantService,
  ttl?: number,
): Promise<Theme | null> {
  return getDefaultTenant(service, ttl).then(
    (tenant) => tenant?.branding?.theme || null,
  )
}
```

### 10. Admin API Endpoints

Add to `/tenants` admin routes:

```typescript
// POST /tenants/default/invalidate
// Invalidate default tenant cache
app.post("/tenants/default/invalidate", async (c) => {
  invalidateDefaultTenantCache()
  return c.json({ success: true, message: "Cache invalidated" })
})

// PUT /tenants/default
// Update default tenant and invalidate cache
app.put("/tenants/default", async (c) => {
  const updates = await c.req.json()

  const updated = await tenantService.updateTenant("default", updates)

  // Auto-invalidate cache on update
  invalidateDefaultTenantCache()

  return c.json(updated)
})
```

### 11. Testing Strategy

**Unit Tests:**

1. `getDefaultTenant()` returns cached tenant within TTL
2. `getDefaultTenant()` reloads after TTL expiration
3. `getDefaultTenant()` handles missing default tenant gracefully
4. `getDefaultTenant()` handles suspended default tenant
5. `getDefaultTenant()` handles DB errors gracefully
6. `invalidateDefaultTenantCache()` clears cache
7. TTL=0 disables caching (always fetch)

**Integration Tests:**

1. Create default tenant, verify theme applied
2. Update default tenant, invalidate cache, verify new theme
3. Delete default tenant, verify graceful fallback
4. Multi-tenant app with config.theme overrides default
5. Concurrent requests share cached default tenant

**Performance Tests:**

1. Cache hit latency < 1ms
2. Cache miss latency < 50ms (single DB query)
3. No memory leak with long-running cache

### 12. Migration Path

**For existing deployments:**

```sql
-- Create default tenant (optional)
INSERT INTO tenants (
  id, name, domain, status,
  branding, settings,
  created_at, updated_at
) VALUES (
  'default',
  'Default Organization',
  NULL,
  'active',
  json_object('theme', json_object(
    'primary', '#007bff',
    'secondary', '#6c757d',
    'background', '#ffffff',
    'text', '#212529'
  )),
  json_object(),
  unixepoch() * 1000,
  unixepoch() * 1000
);
```

**Backward compatibility:**

- Existing apps without default tenant: No changes needed, works as before
- Existing apps with `config.theme`: No changes needed, config takes precedence
- New apps: Can create default tenant via API or SQL

### 13. Documentation Requirements

**User-facing docs:**

1. Concept: Default tenant for organization-wide branding
2. Setup: How to create default tenant via API/SQL
3. Configuration: TTL and caching options
4. Cache management: When and how to invalidate
5. Priority: config.theme > default tenant > empty theme

**Developer docs:**

1. Cache module API documentation
2. Testing guidelines for default tenant features
3. Performance characteristics and benchmarks

### 14. Security Considerations

**Tenant ID collision:**

- Reserve "default" as system tenant ID
- Validate `tenantService.createTenant()` to reject id="default" from user API
- Only allow default tenant creation via admin/setup scripts

**Cache poisoning:**

- Cache stores immutable tenant snapshots
- Cache invalidation requires admin privileges
- No user input in cache key (fixed "default" string)

**Information disclosure:**

- Default tenant branding is public (used in login UI)
- No sensitive data should be in default tenant branding
- Document this security boundary in guidelines

## Open Questions

1. **Should we support multiple fallback tenants?** (e.g., default-light, default-dark)
   - **Decision: No** - Single default keeps architecture simple. Theme variants should be in single tenant's branding.

2. **Should cache be per-worker or shared (Redis)?**
   - **Decision: Per-worker for v1** - Shared cache adds complexity. TTL-based invalidation is sufficient for most use cases.

3. **Should we emit metrics for cache hits/misses?**
   - **Decision: Add in future** - Valuable for observability but not MVP requirement.

## Implementation Checklist

- [ ] Create `src/enterprise/default-tenant-cache.ts` module
- [ ] Add cache functions: `getDefaultTenant()`, `invalidateDefaultTenantCache()`
- [ ] Update `EnterpriseIssuerConfig` interface with cache options
- [ ] Integrate default tenant resolution in `createMultiTenantIssuer()`
- [ ] Pass resolved default theme to `createTenantThemeMiddleware()`
- [ ] Add admin endpoint for cache invalidation
- [ ] Add validation to prevent user-created "default" tenant
- [ ] Write unit tests for cache module
- [ ] Write integration tests for theme resolution
- [ ] Update enterprise documentation
- [ ] Add migration guide for creating default tenant

## Performance Targets

- Cache hit latency: < 1ms
- Cache miss latency: < 50ms
- Memory overhead: < 5KB per cached tenant
- TTL resolution accuracy: ± 1 second
- Startup time impact: < 100ms (with eager loading)

## Risk Mitigation

| Risk                                   | Impact | Mitigation                                     |
| -------------------------------------- | ------ | ---------------------------------------------- |
| Default tenant DB query blocks startup | High   | Lazy load + timeout + graceful fallback        |
| Cache never invalidates                | Medium | TTL + manual invalidation API                  |
| Memory leak in long-running process    | Medium | Bounded cache size (single tenant)             |
| Stale theme after update               | Low    | Document cache invalidation in update workflow |
| "default" ID collision                 | Low    | Validate in createTenant API                   |

## Success Metrics

1. Zero impact on existing deployments without default tenant
2. < 100ms additional latency on first request (cache miss)
3. < 1ms additional latency on subsequent requests (cache hit)
4. Zero failed requests due to default tenant issues
5. 100% backward compatibility with existing theme configuration

## Future Enhancements

1. **Automatic cache invalidation** on default tenant updates
2. **Shared cache** support (Redis/KV) for multi-instance deployments
3. **Metrics and observability** for cache hit rates
4. **Tenant hierarchy** (default > org-level > tenant-level themes)
5. **Theme versioning** with rollback support
6. **A/B testing** for default themes
