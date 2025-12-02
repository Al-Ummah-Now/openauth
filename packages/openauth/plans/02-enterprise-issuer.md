# Enterprise Issuer Integration Plan

## Executive Summary

This plan outlines the architectural changes needed to unify theme handling between the regular issuer (`createIssuer`) and multi-tenant issuer (`createMultiTenantIssuer`). Currently, the multi-tenant issuer only sets HTTP headers for themes, but UI components read from `globalThis`. We need to create new middleware that resolves the theme and makes it available for SSR using the same mechanism as the regular issuer.

## Current State Analysis

### Regular Issuer Theme Handling

**File**: `src/issuer.ts`

The regular issuer uses a straightforward approach:

```typescript
if (input.theme) {
  setTheme(input.theme) // Sets to globalThis.OPENAUTH_THEME
}
```

**Mechanism**:

- Uses `setTheme()` from `src/ui/theme.ts` (line 308-311)
- Stores theme directly in `globalThis.OPENAUTH_THEME`
- UI components call `getTheme()` which returns `globalThis.OPENAUTH_THEME || THEME_OPENAUTH`
- Works perfectly for single-tenant deployments

**Limitations**:

- Single theme per issuer instance
- No per-request theme resolution
- Not compatible with multi-tenant scenarios

### Multi-Tenant Issuer Theme Handling

**File**: `src/enterprise/issuer.ts` (line 233)

Current implementation:

```typescript
app.use("*", createTenantThemeMiddleware())
```

**Current Behavior**:

- `createTenantThemeMiddleware()` defined in `src/tenant/theme.ts` (lines 85-142)
- Runs AFTER request processing (`await next()`)
- Only sets HTTP response headers:
  - `X-Theme-Vars`: CSS custom properties
  - `X-Custom-CSS`: Custom CSS URL/inline
  - `X-Logo-Light`, `X-Logo-Dark`, `X-Favicon`: Branding assets
- Does NOT set `globalThis.OPENAUTH_THEME`

**Problem**:

- Headers are only useful for client-side applications
- SSR components (like account picker, provider selection) call `getTheme()`
- `getTheme()` reads from `globalThis`, not from headers
- Results in SSR using `THEME_OPENAUTH` fallback instead of tenant theme

### Evidence of SSR Theme Usage

**File**: `src/enterprise/issuer.ts`

Provider selection UI (lines 864-951):

```typescript
function renderProviderSelection(
  ctx: Context,
  providers: Record<string, Provider<any>>,
  tenant: Tenant,
): Response {
  const theme = tenant.branding?.theme || {}

  const html = `
    :root {
      --oa-primary: ${theme.primary || "#007bff"};
      --oa-secondary: ${theme.secondary || "#6c757d"};
      // ...
    }
  `
}
```

Account picker UI (lines 956-1103):

```typescript
function renderAccountPicker(
  ctx: Context,
  accounts: AccountPickerAccount[],
  authorization: EnterpriseAuthorizationState,
): Response {
  const tenant = getTenant(ctx)
  const theme = tenant?.branding?.theme || {}
  // Similar inline CSS generation
}
```

**Current Workaround**:

- SSR functions manually extract theme from tenant object
- Inline CSS generation duplicates logic
- Inconsistent with regular issuer's approach
- Cannot leverage existing UI components that use `getTheme()`

## Theme Priority Chain Design

### Priority Order

When resolving theme for a request:

1. **Tenant Theme** (highest priority)
   - `tenant.branding.theme` - Resolved tenant's theme configuration
   - Per-tenant customization for white-label scenarios

2. **Config Theme**
   - `config.theme` - Theme passed to `createMultiTenantIssuer()`
   - Provides default branding across all tenants

3. **Default Tenant Theme**
   - Fetch tenant with ID "default" from database
   - `defaultTenant.branding.theme`
   - Allows storing default theme in database instead of config

4. **THEME_OPENAUTH** (lowest priority)
   - Hardcoded fallback from `src/ui/theme.ts`
   - Ensures UI always has valid theme

### Rationale

**Why prioritize tenant over config?**

- Multi-tenant issuer's primary purpose is per-tenant isolation
- Tenant-specific branding is the expected behavior
- Config theme serves as fallback when tenant has no branding

**Why include default tenant?**

- Allows runtime theme updates without code deployment
- Consistent with tenant-based architecture
- Provides flexible default management

**When to use each level?**

```
Request for tenant "acme":
├─ Has theme? → Use tenant.branding.theme ✓
└─ No theme
   ├─ Has config.theme? → Use config.theme ✓
   └─ No config.theme
      ├─ Has "default" tenant? → Use defaultTenant.branding.theme ✓
      └─ No default tenant → Use THEME_OPENAUTH ✓
```

## Proposed Architecture

### New Middleware: Theme Resolution

**Purpose**: Resolve theme before request processing and set to `globalThis`

**File**: `src/enterprise/issuer.ts` (new middleware function)

```typescript
/**
 * Theme Resolution Middleware
 *
 * Resolves theme using priority chain and sets to globalThis for SSR.
 * Must run AFTER tenant resolution, BEFORE route handlers.
 *
 * Priority Chain:
 * 1. tenant.branding.theme (resolved tenant's theme)
 * 2. config.theme (from createMultiTenantIssuer config)
 * 3. Default tenant from DB (tenant with ID "default")
 * 4. THEME_OPENAUTH (hardcoded fallback)
 */
function createEnterpriseThemeMiddleware(options: {
  tenantService: TenantService
  configTheme?: Theme
}): MiddlewareHandler {
  // Cache for default tenant to avoid repeated DB lookups
  let defaultTenantCache: { tenant: Tenant | null; timestamp: number } | null =
    null
  const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

  return async function enterpriseThemeMiddleware(
    ctx: Context,
    next: Next,
  ): Promise<Response | void> {
    // Get resolved tenant from context (set by tenant resolver)
    const tenant = getTenant(ctx)

    let resolvedTheme: Theme | null = null

    // Priority 1: Tenant's theme
    if (tenant?.branding?.theme) {
      resolvedTheme = tenant.branding.theme
    }

    // Priority 2: Config theme
    if (!resolvedTheme && options.configTheme) {
      resolvedTheme = options.configTheme
    }

    // Priority 3: Default tenant theme
    if (!resolvedTheme) {
      // Check cache
      const now = Date.now()
      if (
        defaultTenantCache &&
        now - defaultTenantCache.timestamp < CACHE_TTL
      ) {
        if (defaultTenantCache.tenant?.branding?.theme) {
          resolvedTheme = defaultTenantCache.tenant.branding.theme
        }
      } else {
        // Fetch default tenant
        const defaultTenant = await options.tenantService.getTenant("default")
        defaultTenantCache = { tenant: defaultTenant, timestamp: now }

        if (defaultTenant?.branding?.theme) {
          resolvedTheme = defaultTenant.branding.theme
        }
      }
    }

    // Priority 4: THEME_OPENAUTH fallback
    if (!resolvedTheme) {
      resolvedTheme = THEME_OPENAUTH
    }

    // Set theme to globalThis for SSR components
    setTheme(resolvedTheme)

    // Store in context for potential programmatic access
    ctx.set("resolvedTheme", resolvedTheme)

    await next()
  }
}
```

### Middleware Order

**Critical**: Middleware must execute in this order:

```typescript
// 1. Tenant Resolution (REQUIRED FIRST)
app.use("*", createTenantResolver(tenantResolverConfig))

// 2. Theme Resolution (NEW - BEFORE ROUTES)
app.use("*", createEnterpriseThemeMiddleware({
  tenantService: config.tenantService,
  configTheme: config.theme
}))

// 3. Session Middleware
app.use("*", createSessionMiddleware(...))

// 4. Routes and handlers
// ...
```

**Why this order?**

1. Tenant resolver must run first (theme depends on tenant)
2. Theme must be set before any route handlers (SSR needs theme)
3. Session middleware can run after theme (no dependency)

### Context Variable Design

**File**: `src/enterprise/types.ts`

Add to `EnterpriseContextVariables`:

```typescript
export interface EnterpriseContextVariables {
  // ... existing properties

  /**
   * Resolved theme for the current request
   * Available after theme resolution middleware
   */
  resolvedTheme?: Theme
}
```

**Usage**:

```typescript
// In route handlers or UI generators
const theme = ctx.get("resolvedTheme")
```

**Benefits**:

- Programmatic access to resolved theme
- Type-safe access via context
- Debugging and introspection
- Fallback if `getTheme()` doesn't work in certain contexts

### Migration Path for Existing SSR Functions

**Current Pattern** (lines 864-951):

```typescript
function renderProviderSelection(
  ctx: Context,
  providers: Record<string, Provider<any>>,
  tenant: Tenant,
): Response {
  const theme = tenant.branding?.theme || {}

  const html = `
    :root {
      --oa-primary: ${theme.primary || "#007bff"};
      ...
    }
  `
}
```

**New Pattern**:

```typescript
function renderProviderSelection(
  ctx: Context,
  providers: Record<string, Provider<any>>,
  tenant: Tenant,
): Response {
  // Theme already resolved by middleware and set to globalThis
  const theme = getTheme() // Returns fully resolved theme

  const html = `
    :root {
      --oa-primary: ${theme.primary};
      ...
    }
  `
}
```

**Benefits**:

- Consistent with regular issuer
- Automatic fallback handling
- Less code duplication
- Can reuse UI components from `src/ui/`

### Deprecation Strategy for Header-Based Middleware

**File**: `src/tenant/theme.ts`

**Current**: `createTenantThemeMiddleware()` (lines 85-142)

**Options**:

1. **Keep Both** (Recommended)
   - Keep `createTenantThemeMiddleware()` for header-based approach
   - Add new `createEnterpriseThemeMiddleware()` for SSR approach
   - Document when to use each
   - Enterprise issuer uses new middleware
   - Header middleware still useful for API-only scenarios

2. **Deprecate Old**
   - Mark `createTenantThemeMiddleware()` as `@deprecated`
   - Add migration guide in JSDoc
   - Remove in next major version

3. **Merge Both**
   - Extend `createTenantThemeMiddleware()` with options
   - Add `setToGlobalThis: boolean` option
   - Backward compatible but more complex

**Recommendation**: Keep Both

Rationale:

- Clear separation of concerns
- No breaking changes
- Different use cases (SSR vs API)
- Enterprise issuer has specific needs

## Configuration Type Updates

### File: `src/enterprise/types.ts`

**Current** (lines 59-171):

```typescript
export interface EnterpriseIssuerConfig<
  Providers extends Record<string, Provider<any>> = Record<
    string,
    Provider<any>
  >,
  Subjects extends SubjectSchema = SubjectSchema,
> {
  // ... existing properties
}
```

**Proposed Addition**:

````typescript
export interface EnterpriseIssuerConfig<
  Providers extends Record<string, Provider<any>> = Record<
    string,
    Provider<any>
  >,
  Subjects extends SubjectSchema = SubjectSchema,
> {
  // ... existing properties

  /**
   * Optional theme configuration for UI customization
   *
   * This theme serves as the default for all tenants that don't have
   * their own branding.theme configured.
   *
   * Theme priority chain:
   * 1. tenant.branding.theme (per-tenant customization)
   * 2. config.theme (this property)
   * 3. Default tenant theme (tenant with ID "default")
   * 4. THEME_OPENAUTH (hardcoded fallback)
   *
   * @example
   * ```typescript
   * import { THEME_TERMINAL } from "@openauthjs/openauth/ui/theme"
   *
   * createMultiTenantIssuer({
   *   theme: THEME_TERMINAL,
   *   // ... other config
   * })
   * ```
   */
  theme?: Theme
}
````

**Notes**:

- Property already exists in types (line 116)
- JSDoc needs enhancement with priority chain explanation
- Example shows usage with built-in theme

## Integration Points

### 1. Tenant Service Integration

**Purpose**: Fetch default tenant for theme fallback

**Method Used**: `tenantService.getTenant("default")`

**Caching Strategy**:

- Cache default tenant for 5 minutes
- Invalidate on write operations (future enhancement)
- In-memory cache per worker/instance
- Separate from HTTP cache layer

**Error Handling**:

```typescript
try {
  const defaultTenant = await options.tenantService.getTenant("default")
  // ...
} catch (error) {
  console.warn("Failed to fetch default tenant for theme fallback:", error)
  // Continue with THEME_OPENAUTH fallback
}
```

### 2. Theme System Integration

**Import Path**: `@openauthjs/openauth/ui/theme`

**Functions Used**:

- `setTheme(theme: Theme)`: Set theme to globalThis
- `getTheme()`: Retrieve theme from globalThis
- `THEME_OPENAUTH`: Default fallback theme

**Type Import**:

```typescript
import type { Theme } from "../ui/theme.js"
import { setTheme, getTheme, THEME_OPENAUTH } from "../ui/theme.js"
```

### 3. Tenant Resolver Integration

**Dependency**: Theme middleware depends on tenant resolver

**Context Variable Used**: `ctx.get("tenant")`

**Helper Function**: `getTenant(ctx)`

**Error Case**: If tenant is null:

```typescript
const tenant = getTenant(ctx)
// tenant may be null for optional tenant resolution
// Middleware should handle gracefully and skip priority 1
```

### 4. UI Component Integration

**Existing Components** (in `src/ui/`):

- Should work automatically with new middleware
- Already use `getTheme()` for theme access
- No changes needed

**SSR Functions** (in `src/enterprise/issuer.ts`):

- `renderProviderSelection()` (lines 864-951)
- `renderAccountPicker()` (lines 956-1103)
- Should be refactored to use `getTheme()` instead of manual extraction

**Future UI Components**:

- Can be shared between regular and enterprise issuer
- Use `getTheme()` for theme access
- No tenant awareness needed

## Implementation Steps

### Phase 1: Middleware Implementation

1. **Create new middleware function** in `src/enterprise/issuer.ts`
   - Implement `createEnterpriseThemeMiddleware()`
   - Include caching logic for default tenant
   - Add comprehensive JSDoc comments

2. **Update middleware order** in `createMultiTenantIssuer()`
   - Add new theme middleware after tenant resolver
   - Keep existing header middleware for now (optional)
   - Document middleware execution order

3. **Add context variable** to `EnterpriseContextVariables`
   - Define `resolvedTheme?: Theme`
   - Update type exports

### Phase 2: SSR Function Refactoring

4. **Refactor `renderProviderSelection()`**
   - Replace manual theme extraction
   - Use `getTheme()` for consistent access
   - Remove fallback logic (handled by middleware)
   - Test with multiple tenants

5. **Refactor `renderAccountPicker()`**
   - Same changes as provider selection
   - Ensure theme consistency across UI

6. **Test SSR rendering**
   - Verify theme loads correctly per tenant
   - Test priority chain (tenant → config → default → fallback)
   - Check caching behavior

### Phase 3: Documentation and Testing

7. **Update type documentation**
   - Enhance JSDoc for `EnterpriseIssuerConfig.theme`
   - Document priority chain
   - Add usage examples

8. **Add integration tests**
   - Test theme resolution with different priority levels
   - Test caching behavior
   - Test fallback scenarios
   - Test with missing default tenant

9. **Update architecture documentation**
   - Document middleware order requirements
   - Explain theme resolution strategy
   - Add troubleshooting guide

## Testing Strategy

### Unit Tests

**Test Cases**:

1. Theme Priority Chain

```typescript
describe("Theme Resolution Priority", () => {
  it("should use tenant theme when available", async () => {
    // tenant.branding.theme = { primary: "red" }
    // config.theme = { primary: "blue" }
    // Expected: red
  })

  it("should fallback to config theme", async () => {
    // tenant.branding.theme = undefined
    // config.theme = { primary: "blue" }
    // Expected: blue
  })

  it("should fallback to default tenant theme", async () => {
    // tenant.branding.theme = undefined
    // config.theme = undefined
    // defaultTenant.branding.theme = { primary: "green" }
    // Expected: green
  })

  it("should fallback to THEME_OPENAUTH", async () => {
    // All sources undefined
    // Expected: THEME_OPENAUTH
  })
})
```

2. Caching Behavior

```typescript
describe("Default Tenant Caching", () => {
  it("should cache default tenant for TTL duration", async () => {
    // First request fetches from DB
    // Second request within TTL uses cache
    // Verify only one DB call
  })

  it("should refresh cache after TTL expires", async () => {
    // First request at T=0
    // Second request at T=6min (TTL=5min)
    // Verify two DB calls
  })
})
```

3. Context Variable

```typescript
describe("Resolved Theme Context", () => {
  it("should set resolvedTheme in context", async () => {
    // Middleware runs
    // ctx.get("resolvedTheme") returns correct theme
  })

  it("should match getTheme() result", async () => {
    // ctx.get("resolvedTheme") === getTheme()
  })
})
```

### Integration Tests

**Test Scenarios**:

1. Multi-Tenant Theme Isolation

```typescript
describe("Multi-Tenant Theme Isolation", () => {
  it("should render different themes for different tenants", async () => {
    // Request to tenant A → Theme A
    // Request to tenant B → Theme B
    // Verify globalThis is properly scoped per request
  })
})
```

2. SSR Consistency

```typescript
describe("SSR Theme Consistency", () => {
  it("should render provider selection with tenant theme", async () => {
    // Request with tenant having theme
    // Verify HTML contains tenant's colors
  })

  it("should render account picker with tenant theme", async () => {
    // Similar test for account picker
  })
})
```

3. Middleware Order

```typescript
describe("Middleware Execution Order", () => {
  it("should fail if tenant resolver not before theme middleware", async () => {
    // Swap middleware order
    // Verify error or fallback behavior
  })
})
```

### Manual Testing Checklist

- [ ] Create multiple tenants with different themes
- [ ] Verify provider selection UI uses correct theme per tenant
- [ ] Verify account picker UI uses correct theme per tenant
- [ ] Test with tenant missing theme (should fallback)
- [ ] Test with no config theme (should use default tenant)
- [ ] Test with no default tenant (should use THEME_OPENAUTH)
- [ ] Verify theme switching between tenant requests
- [ ] Test custom theme properties (logos, fonts, colors)
- [ ] Verify no theme leakage between concurrent requests

## Performance Considerations

### Caching Strategy

**Default Tenant Cache**:

- **Location**: In-memory, per worker/instance
- **TTL**: 5 minutes (configurable)
- **Invalidation**: Time-based only (future: event-based)
- **Memory**: Minimal (single tenant object)

**Impact**:

- Reduces DB calls for default tenant
- Acceptable staleness for theme updates
- No cross-request contamination

### Request Performance

**Middleware Overhead**:

- Tenant lookup: Already resolved by tenant middleware
- Theme lookup: 1 additional object access
- Default tenant: Cached (only initial request hits DB)
- `setTheme()`: Simple globalThis assignment

**Estimated Impact**: < 1ms per request

**Optimization Opportunities**:

- Pre-load default tenant on startup
- Use edge caching for static themes
- Consider theme CDN for assets

### Memory Considerations

**GlobalThis Usage**:

- Current pattern used by regular issuer
- Single theme object per request context
- Proper scoping in request lifecycle

**Potential Issues**:

- Concurrent requests may overwrite globalThis
- **Mitigation**: Hono's context isolation
- **Alternative**: AsyncLocalStorage (overkill per comment in theme.ts:303)

**Recommendation**: Current approach is acceptable given comment in `src/ui/theme.ts`:

```typescript
// i really don't wanna use async local storage for this so get over it
```

## Security Considerations

### Theme Data Validation

**Input Validation**:

- Theme objects from database should be validated
- Prevent XSS via theme properties (colors, URLs)
- Sanitize custom CSS if supported

**Recommendations**:

```typescript
function sanitizeTheme(theme: unknown): Theme | null {
  // Validate structure
  // Sanitize color values (CSS safe)
  // Validate URLs (protocol whitelist)
  // Escape string values
}
```

### Default Tenant Access Control

**Security Risk**:

- Default tenant theme is public (accessible to all tenants)
- Should not contain sensitive information
- Considered "branding only"

**Recommendations**:

- Document that default tenant is shared
- Ensure default tenant contains only theme data
- Separate secrets from theme configuration

### Cache Poisoning

**Risk**: Malicious default tenant could affect all tenants

**Mitigation**:

- Validate theme data from database
- Implement checksum/version in cache
- Monitor default tenant updates
- Admin-only access to default tenant

## Backwards Compatibility

### Breaking Changes

**None**: This is an additive change

**Existing Behavior**:

- Current multi-tenant issuer has no `theme` config property being used
- Adding it does not break existing deployments
- SSR functions currently work (via manual extraction)

### Migration Required

**No migration needed** for existing deployments:

- Existing code continues to work
- New middleware is additive
- Manual theme extraction still functional

**Optional Improvements**:

- Refactor SSR functions to use `getTheme()`
- Add `theme` config for better defaults
- Create "default" tenant for centralized theming

### Deprecation Timeline

**Phase 1** (Current Release):

- Add new middleware
- Keep existing header middleware
- Document both approaches

**Phase 2** (Next Release):

- Encourage migration to new pattern
- Mark header middleware as legacy

**Phase 3** (Major Version):

- Consider consolidating middleware
- Potential breaking changes with migration guide

## Future Enhancements

### 1. Theme Inheritance

**Concept**: Hierarchical theme overrides

```typescript
interface Theme {
  extends?: string // Reference to parent theme
  // ... overrides
}
```

**Use Case**: Corporate parent theme + subsidiary variations

### 2. Dynamic Theme Switching

**Concept**: Theme updates without restart

**Mechanism**:

- Webhook on theme update
- Invalidate cache
- Next request picks up new theme

### 3. Theme Versioning

**Concept**: A/B testing themes

```typescript
interface TenantBranding {
  theme?: Theme
  themeVersion?: string
  themes?: Record<string, Theme>
}
```

**Use Case**: Gradual rollout of theme changes

### 4. Theme CDN Integration

**Concept**: Serve theme assets via CDN

**Benefits**:

- Faster asset loading
- Reduced origin traffic
- Better caching

### 5. Theme Validation Service

**Concept**: Centralized theme validation

**Features**:

- WCAG contrast checking
- Asset URL validation
- CSS safety scanning

## Open Questions

### 1. AsyncLocalStorage vs GlobalThis

**Question**: Should we use AsyncLocalStorage for better isolation?

**Current Approach**: GlobalThis (per theme.ts:303 comment)

**Trade-offs**:

- AsyncLocalStorage: Better isolation, more complexity
- GlobalThis: Simple, adequate for Hono's request lifecycle

**Decision**: Stick with GlobalThis unless concurrency issues arise

### 2. Default Tenant Convention

**Question**: Should "default" tenant ID be configurable?

**Current Approach**: Hardcoded "default"

**Alternative**:

```typescript
interface EnterpriseIssuerConfig {
  defaultTenantId?: string // Default: "default"
}
```

**Recommendation**: Start with hardcoded, make configurable if needed

### 3. Cache Invalidation Strategy

**Question**: How to invalidate default tenant cache on updates?

**Options**:

1. Time-based only (current)
2. Event-based (webhook/message)
3. Versioning in tenant object
4. No cache (always fetch)

**Recommendation**: Start with time-based, add event-based in future

### 4. Theme Merge Strategy

**Question**: Should themes be shallow or deep merged?

**Example**:

```typescript
// Tenant theme
{ primary: "red", font: { family: "Arial" } }

// Config theme
{ primary: "blue", secondary: "green", font: { family: "Times", scale: "1.2" } }

// Result?
// Shallow: { primary: "red", font: { family: "Arial" } } // font.scale lost
// Deep: { primary: "red", secondary: "green", font: { family: "Arial", scale: "1.2" } }
```

**Recommendation**: Deep merge with priority order respected

## Success Metrics

### Implementation Success

- [ ] All unit tests passing
- [ ] Integration tests passing
- [ ] No performance regression (< 1ms overhead)
- [ ] Documentation complete
- [ ] Zero breaking changes

### Functionality Success

- [ ] Themes render correctly per tenant
- [ ] Priority chain works as designed
- [ ] Caching reduces DB calls
- [ ] SSR functions use resolved theme
- [ ] No theme leakage between tenants

### Developer Experience

- [ ] Clear API documentation
- [ ] Intuitive configuration
- [ ] Helpful error messages
- [ ] Easy to debug theme issues
- [ ] Migration path clear

## Conclusion

This architectural plan provides a comprehensive approach to unifying theme handling between the regular issuer and multi-tenant issuer. The key innovation is the new `createEnterpriseThemeMiddleware()` that resolves themes using a priority chain and sets them to `globalThis` for SSR compatibility.

### Key Benefits

1. **Consistency**: Same pattern as regular issuer
2. **Flexibility**: Four-level priority chain
3. **Performance**: Efficient caching strategy
4. **Compatibility**: No breaking changes
5. **Extensibility**: Clear path for future enhancements

### Critical Success Factors

1. **Middleware Order**: Theme middleware MUST run after tenant resolver
2. **Cache Strategy**: Default tenant caching reduces DB load
3. **Fallback Chain**: Graceful degradation ensures UI always works
4. **Testing**: Comprehensive tests prevent regressions

### Next Steps

1. Review and approve this plan
2. Implement Phase 1 (middleware)
3. Implement Phase 2 (SSR refactoring)
4. Implement Phase 3 (testing and docs)
5. Deploy and monitor

---

**Document Version**: 1.0
**Author**: Software Architect AI
**Date**: 2025-12-02
**Status**: Draft for Review
