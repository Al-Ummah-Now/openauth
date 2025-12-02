# Testing & Migration Strategy for Theme Unification

**Status**: Planning Phase
**Author**: Architecture Team
**Date**: 2025-12-02
**Related**: Architecture Plans 01-04

## Executive Summary

This document outlines the comprehensive testing strategy and migration guide for unifying theming support between the regular `issuer()` and multi-tenant `createMultiTenantIssuer()`. The goal is to ensure both systems support consistent theming without breaking existing implementations.

## Architecture Context

### Current State

- **Regular Issuer**: Uses `config.theme` with `setTheme()/getTheme()` via global state
- **Multi-Tenant Issuer**: Uses tenant branding with HTTP headers and per-tenant theme resolution
- **Problem**: Two separate systems with different mechanisms and no unified approach

### Target State

- **Regular Issuer**: Continue to support `config.theme` for backward compatibility
- **Multi-Tenant Issuer**:
  - Support `config.theme` as default fallback for all tenants
  - Allow per-tenant branding to override the default
  - Maintain HTTP header injection for API consumers
- **Unified Approach**: Both use theme resolution functions with proper precedence

## Testing Strategy

### 1. Test File Structure

```
test/
├── theme/
│   ├── regular-issuer-theme.test.ts          # Regular issuer theming
│   ├── multi-tenant-theme.test.ts            # Multi-tenant theming
│   ├── theme-resolution.test.ts              # Theme resolution logic
│   ├── theme-concurrency.test.ts             # Race condition tests
│   └── theme-backwards-compat.test.ts        # Backward compatibility
├── integration/
│   └── theme-e2e.test.ts                     # End-to-end theme flows
└── migration/
    └── theme-migration.test.ts               # Migration scenarios
```

### 2. Unit Tests

#### 2.1 Regular Issuer Theme Tests (`regular-issuer-theme.test.ts`)

**Purpose**: Verify that existing `issuer()` theme functionality remains intact.

**Test Cases**:

```typescript
describe("Regular Issuer - Theme Support", () => {
  test("applies theme from config", async () => {
    const auth = issuer({
      theme: THEME_SST,
      storage: MemoryStorage(),
      providers: {
        /* ... */
      },
      subjects,
      // ...
    })

    // Request UI endpoint
    const response = await auth.request("/password/authorize")
    const html = await response.text()

    // Verify theme is applied in HTML
    expect(html).toContain("SST")
    expect(html).toContain("#f3663f") // SST primary color
  })

  test("uses default theme when no theme specified", async () => {
    const auth = issuer({
      storage: MemoryStorage(),
      providers: {
        /* ... */
      },
      subjects,
    })

    const response = await auth.request("/password/authorize")
    const html = await response.text()

    // Verify default OpenAuth theme
    expect(html).toContain("OpenAuth")
  })

  test("custom theme overrides defaults", async () => {
    const customTheme: Theme = {
      title: "My App",
      primary: "#ff0000",
      logo: "https://example.com/logo.png",
    }

    const auth = issuer({
      theme: customTheme,
      storage: MemoryStorage(),
      providers: {
        /* ... */
      },
      subjects,
    })

    const response = await auth.request("/password/authorize")
    const html = await response.text()

    expect(html).toContain("My App")
    expect(html).toContain("#ff0000")
    expect(html).toContain("https://example.com/logo.png")
  })

  test("theme persists across multiple requests", async () => {
    const auth = issuer({
      theme: THEME_TERMINAL,
      storage: MemoryStorage(),
      providers: {
        /* ... */
      },
      subjects,
    })

    // Make multiple requests
    for (let i = 0; i < 5; i++) {
      const response = await auth.request("/password/authorize")
      const html = await response.text()
      expect(html).toContain("terminal")
    }
  })
})
```

#### 2.2 Multi-Tenant Theme Tests (`multi-tenant-theme.test.ts`)

**Purpose**: Verify multi-tenant theme resolution with proper precedence.

**Test Cases**:

```typescript
describe("Multi-Tenant Issuer - Theme Resolution", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let tenantService: TenantServiceImpl
  let sessionService: SessionServiceImpl
  let tenant: Tenant

  beforeEach(async () => {
    storage = MemoryStorage()
    tenantService = new TenantServiceImpl(storage)
    sessionService = new SessionServiceImpl(storage)

    tenant = await tenantService.createTenant({
      id: "test-tenant",
      name: "Test Tenant",
      domain: "auth.test.com",
    })
  })

  test("uses config.theme as default for all tenants", async () => {
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      theme: THEME_SST, // Default theme
      providers: {
        /* ... */
      },
      subjects,
    })

    const response = await app.request("/password/authorize", {
      headers: { Host: "auth.test.com" },
    })

    const html = await response.text()
    expect(html).toContain("SST") // Default theme applied
  })

  test("per-tenant branding overrides default theme", async () => {
    await tenantService.updateTenant(tenant.id, {
      branding: {
        theme: {
          primary: "#00ff00",
          secondary: "#0000ff",
        },
        logoLight: "https://tenant.com/logo-light.png",
      },
    })

    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      theme: THEME_SST, // Default theme
      providers: {
        /* ... */
      },
      subjects,
    })

    const response = await app.request("/password/authorize", {
      headers: { Host: "auth.test.com" },
    })

    const html = await response.text()
    expect(html).toContain("#00ff00") // Tenant override
    expect(html).toContain("https://tenant.com/logo-light.png")
  })

  test("uses default tenant from DB when no config.theme", async () => {
    const defaultTenant = await tenantService.getTenant("default")
    expect(defaultTenant).toBeDefined()

    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      // No theme specified in config
      providers: {
        /* ... */
      },
      subjects,
    })

    const response = await app.request("/password/authorize", {
      headers: { Host: "auth.test.com" },
    })

    const html = await response.text()
    // Should use default tenant's branding
    expect(html).toBeDefined()
  })

  test("HTTP headers contain theme data for API consumers", async () => {
    await tenantService.updateTenant(tenant.id, {
      branding: {
        theme: {
          primary: "#007bff",
          secondary: "#6c757d",
        },
      },
    })

    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      providers: {
        /* ... */
      },
      subjects,
    })

    const response = await app.request("/authorize", {
      headers: { Host: "auth.test.com" },
    })

    // Verify theme headers
    expect(response.headers.get("X-Theme-Vars")).toContain(
      "--oa-primary: #007bff",
    )
    expect(response.headers.get("X-Theme-Vars")).toContain(
      "--oa-secondary: #6c757d",
    )
  })
})
```

#### 2.3 Theme Resolution Logic Tests (`theme-resolution.test.ts`)

**Purpose**: Test the core theme resolution functions in isolation.

**Test Cases**:

```typescript
describe("Theme Resolution Functions", () => {
  test("resolveTheme - precedence order", () => {
    const configTheme = { primary: "#ff0000", title: "Config" }
    const tenantTheme = { primary: "#00ff00" }
    const defaultTheme = { primary: "#0000ff", title: "Default" }

    const resolved = resolveTheme({
      configTheme,
      tenantTheme,
      defaultTheme,
    })

    // Tenant overrides config, config overrides default
    expect(resolved.primary).toBe("#00ff00") // From tenant
    expect(resolved.title).toBe("Config") // From config
  })

  test("buildCssVars - generates correct CSS variables", () => {
    const theme = {
      primary: "#007bff",
      secondary: "#6c757d",
      background: "#ffffff",
    }

    const cssVars = buildCssVars(theme)

    expect(cssVars).toBe(
      "--oa-primary: #007bff; --oa-secondary: #6c757d; --oa-background: #ffffff",
    )
  })

  test("parseCssVars - parses CSS variables back to theme", () => {
    const cssVars = "--oa-primary: #007bff; --oa-secondary: #6c757d"

    const theme = parseCssVars(cssVars)

    expect(theme.primary).toBe("#007bff")
    expect(theme.secondary).toBe("#6c757d")
  })

  test("mergeThemes - deep merges theme objects", () => {
    const base = {
      primary: "#000000",
      font: { family: "Arial", scale: "1" },
    }
    const override = {
      primary: "#ffffff",
      font: { scale: "1.2" },
      logo: "https://example.com/logo.png",
    }

    const merged = mergeThemes(base, override)

    expect(merged.primary).toBe("#ffffff")
    expect(merged.font.family).toBe("Arial") // Preserved
    expect(merged.font.scale).toBe("1.2") // Overridden
    expect(merged.logo).toBe("https://example.com/logo.png")
  })
})
```

#### 2.4 Concurrency Tests (`theme-concurrency.test.ts`)

**Purpose**: Ensure no theme bleed between tenants in concurrent scenarios.

**Test Cases**:

```typescript
describe("Theme Concurrency - Race Condition Tests", () => {
  test("concurrent requests to different tenants have isolated themes", async () => {
    const tenantService = new TenantServiceImpl(storage)
    const sessionService = new SessionServiceImpl(storage)

    // Create two tenants with different themes
    const tenant1 = await tenantService.createTenant({
      id: "tenant-1",
      name: "Tenant 1",
      domain: "auth1.test.com",
      branding: { theme: { primary: "#ff0000" } },
    })

    const tenant2 = await tenantService.createTenant({
      id: "tenant-2",
      name: "Tenant 2",
      domain: "auth2.test.com",
      branding: { theme: { primary: "#00ff00" } },
    })

    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      providers: {
        /* ... */
      },
      subjects,
    })

    // Make 100 concurrent requests alternating between tenants
    const requests = []
    for (let i = 0; i < 100; i++) {
      const domain = i % 2 === 0 ? "auth1.test.com" : "auth2.test.com"
      const expectedColor = i % 2 === 0 ? "#ff0000" : "#00ff00"

      requests.push(
        app
          .request("/password/authorize", {
            headers: { Host: domain },
          })
          .then(async (response) => {
            const html = await response.text()
            expect(html).toContain(expectedColor)
            // Should NOT contain the other tenant's color
            const otherColor =
              expectedColor === "#ff0000" ? "#00ff00" : "#ff0000"
            expect(html).not.toContain(otherColor)
          }),
      )
    }

    await Promise.all(requests)
  })

  test("parallel tenant updates don't affect active requests", async () => {
    const tenantService = new TenantServiceImpl(storage)
    const sessionService = new SessionServiceImpl(storage)

    const tenant = await tenantService.createTenant({
      id: "test-tenant",
      name: "Test Tenant",
      domain: "auth.test.com",
      branding: { theme: { primary: "#ff0000" } },
    })

    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      providers: {
        /* ... */
      },
      subjects,
    })

    // Start 50 requests
    const requests = []
    for (let i = 0; i < 50; i++) {
      requests.push(
        app.request("/password/authorize", {
          headers: { Host: "auth.test.com" },
        }),
      )
    }

    // Simultaneously update tenant theme
    await tenantService.updateTenant(tenant.id, {
      branding: { theme: { primary: "#00ff00" } },
    })

    // All requests should complete without errors
    const responses = await Promise.all(requests)
    responses.forEach((response) => {
      expect(response.status).toBeLessThan(500)
    })
  })

  test("theme cache invalidation works correctly", async () => {
    // TODO: Implement if caching is added
  })
})
```

### 3. Integration Tests

#### 3.1 End-to-End Theme Flow (`theme-e2e.test.ts`)

**Purpose**: Test complete authentication flows with different theme configurations.

**Test Cases**:

```typescript
describe("Theme E2E - Complete Flows", () => {
  test("complete OAuth flow with themed UI", async () => {
    const tenantService = new TenantServiceImpl(storage)
    const sessionService = new SessionServiceImpl(storage)

    const tenant = await tenantService.createTenant({
      id: "test-tenant",
      name: "Test Tenant",
      domain: "auth.test.com",
      branding: {
        theme: {
          primary: "#007bff",
          title: "Test App",
        },
        logoLight: "https://test.com/logo.png",
      },
    })

    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      providers: { password: PasswordProvider(PasswordUI({})) },
      subjects,
      onSuccess: async (ctx, value) => {
        return ctx.subject("user", { userId: "123" })
      },
    })

    const cookieJar = new CookieJar()
    const clientId = "test-client"
    const redirectUri = "https://app.test.com/callback"

    // Step 1: Start OAuth flow
    const authorizeUrl = new URL("https://auth.test.com/authorize")
    authorizeUrl.searchParams.set("client_id", clientId)
    authorizeUrl.searchParams.set("redirect_uri", redirectUri)
    authorizeUrl.searchParams.set("response_type", "code")
    authorizeUrl.searchParams.set("provider", "password")

    const response1 = await cookieJar.fetch(app, authorizeUrl.toString())
    const html1 = await response1.text()

    // Verify themed UI
    expect(html1).toContain("Test App")
    expect(html1).toContain("#007bff")
    expect(html1).toContain("https://test.com/logo.png")

    // Step 2: Submit credentials (themed)
    const response2 = await cookieJar.fetch(
      app,
      "https://auth.test.com/password/authorize",
      {
        method: "POST",
        body: new URLSearchParams({
          email: "test@example.com",
          password: "password123",
        }),
      },
    )

    const html2 = await response2.text()
    expect(html2).toContain("#007bff") // Still themed

    // Step 3: Complete flow and verify tokens
    // ...
  })
})
```

### 4. Backward Compatibility Tests (`theme-backwards-compat.test.ts`)

**Purpose**: Ensure existing implementations continue to work.

**Test Cases**:

```typescript
describe("Theme Backward Compatibility", () => {
  test("existing regular issuer code works unchanged", async () => {
    // This is EXACTLY how users currently use the library
    const auth = issuer({
      theme: THEME_SST,
      storage: MemoryStorage(),
      providers: {
        password: PasswordProvider(PasswordUI({})),
      },
      subjects,
      success: async (ctx, value) => {
        return ctx.subject("user", { userID: "123" })
      },
    })

    const response = await auth.request("/password/authorize")
    expect(response.status).toBe(200)

    const html = await response.text()
    expect(html).toContain("SST")
  })

  test("existing multi-tenant code works unchanged", async () => {
    const tenantService = new TenantServiceImpl(storage)
    const sessionService = new SessionServiceImpl(storage)

    // Existing multi-tenant code (no theme in config)
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      providers: { password: PasswordProvider(PasswordUI({})) },
      subjects,
      onSuccess: async (ctx, value) => {
        return ctx.subject("user", { userId: "123" })
      },
    })

    const response = await app.request("/password/authorize")
    expect(response.status).toBe(200)
  })

  test("HTTP headers still set for API consumers", async () => {
    const tenantService = new TenantServiceImpl(storage)
    const sessionService = new SessionServiceImpl(storage)

    const tenant = await tenantService.createTenant({
      id: "test-tenant",
      name: "Test",
      domain: "auth.test.com",
      branding: {
        theme: { primary: "#007bff" },
      },
    })

    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      providers: { password: PasswordProvider(PasswordUI({})) },
      subjects,
    })

    const response = await app.request(
      "/authorize?client_id=test&redirect_uri=https://app.test.com&response_type=code",
      {
        headers: { Host: "auth.test.com" },
      },
    )

    // Verify headers are still set
    expect(response.headers.has("X-Theme-Vars")).toBe(true)
  })
})
```

### 5. Migration Scenario Tests (`theme-migration.test.ts`)

**Purpose**: Test migration paths from old to new architecture.

**Test Cases**:

```typescript
describe("Theme Migration Scenarios", () => {
  test("migration: regular issuer unchanged", () => {
    // Before: Using theme
    const before = issuer({
      theme: THEME_TERMINAL,
      // ...
    })

    // After: Same code, still works
    const after = issuer({
      theme: THEME_TERMINAL,
      // ...
    })

    // Both should produce identical behavior
  })

  test("migration: add default theme to multi-tenant", async () => {
    const tenantService = new TenantServiceImpl(storage)
    const sessionService = new SessionServiceImpl(storage)

    // Before: No default theme (uses default tenant)
    const before = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      providers: {
        /* ... */
      },
      subjects,
    })

    // After: Add default theme (applies to all tenants)
    const after = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      theme: THEME_SST, // NEW: Default theme
      providers: {
        /* ... */
      },
      subjects,
    })

    const response = await after.app.request("/password/authorize")
    const html = await response.text()
    expect(html).toContain("SST")
  })

  test("migration: tenant branding overrides default", async () => {
    const tenantService = new TenantServiceImpl(storage)
    const sessionService = new SessionServiceImpl(storage)

    const tenant = await tenantService.createTenant({
      id: "custom-tenant",
      name: "Custom",
      domain: "auth.custom.com",
      branding: {
        theme: { primary: "#ff0000" }, // Custom theme
      },
    })

    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      theme: THEME_SST, // Default theme
      providers: {
        /* ... */
      },
      subjects,
    })

    const response = await app.request("/password/authorize", {
      headers: { Host: "auth.custom.com" },
    })

    const html = await response.text()
    expect(html).toContain("#ff0000") // Tenant override
    expect(html).not.toContain("#f3663f") // SST color not used
  })
})
```

## Migration Guide for Existing Users

### For Regular Issuer Users

**Good news**: No changes required! Your existing code continues to work exactly as before.

```typescript
// ✅ This code continues to work unchanged
import { issuer } from "@openauthjs/openauth"
import { THEME_SST } from "@openauthjs/openauth/ui/theme"

export default issuer({
  theme: THEME_SST, // Still works!
  storage: /* ... */,
  providers: /* ... */,
  subjects: /* ... */,
  success: /* ... */,
})
```

**No migration needed for**:

- Existing `config.theme` usage
- Built-in themes (THEME_SST, THEME_TERMINAL, etc.)
- Custom theme objects
- UI rendering

### For Multi-Tenant Issuer Users

**Impact**: Low - Additive changes only, existing code continues to work.

#### Option 1: Add Default Theme (Recommended)

Add a default theme that applies to all tenants unless overridden:

```typescript
import { createMultiTenantIssuer } from "@openauthjs/openauth/enterprise"
import { THEME_SST } from "@openauthjs/openauth/ui/theme"

const { app } = createMultiTenantIssuer({
  tenantService,
  sessionService,
  storage,
  sessionSecret,
  theme: THEME_SST, // 🆕 NEW: Default theme for all tenants
  providers: /* ... */,
  subjects,
  onSuccess: /* ... */,
})
```

**Benefits**:

- Consistent branding across all tenants
- Easy to change globally
- Per-tenant overrides still work

#### Option 2: Use Default Tenant (Existing Behavior)

Continue using the default tenant for branding:

```typescript
// No changes needed - existing code works
const { app } = createMultiTenantIssuer({
  tenantService,
  sessionService,
  storage,
  sessionSecret,
  // No theme specified - uses default tenant
  providers: /* ... */,
  subjects,
  onSuccess: /* ... */,
})

// Set up default tenant branding via API
await tenantService.updateTenant("default", {
  branding: {
    theme: { primary: "#007bff", secondary: "#6c757d" },
    logoLight: "https://example.com/logo.png",
  },
})
```

#### Option 3: Per-Tenant Branding Only

Let each tenant define its own theme:

```typescript
// No config.theme specified
const { app } = createMultiTenantIssuer({
  tenantService,
  sessionService,
  storage,
  sessionSecret,
  providers: /* ... */,
  subjects,
  onSuccess: /* ... */,
})

// Each tenant has its own branding
await tenantService.createTenant({
  id: "tenant-a",
  name: "Tenant A",
  domain: "auth.tenant-a.com",
  branding: {
    theme: { primary: "#ff0000" },
    logoLight: "https://tenant-a.com/logo.png",
  },
})

await tenantService.createTenant({
  id: "tenant-b",
  name: "Tenant B",
  domain: "auth.tenant-b.com",
  branding: {
    theme: { primary: "#00ff00" },
    logoLight: "https://tenant-b.com/logo.png",
  },
})
```

### Theme Resolution Precedence

The theme resolution follows this precedence (highest to lowest):

1. **Per-tenant branding** (`tenant.branding.theme`)
2. **Config default theme** (`config.theme`)
3. **Default tenant branding** (from "default" tenant in DB)
4. **Built-in default** (THEME_OPENAUTH)

```typescript
// Example: All precedence levels
const { app } = createMultiTenantIssuer({
  theme: THEME_SST, // Level 2: Config default
  // ...
})

// Level 1: Per-tenant override (highest priority)
await tenantService.updateTenant("tenant-123", {
  branding: { theme: { primary: "#ff0000" } },
})

// Level 3: Default tenant (if no config.theme)
await tenantService.updateTenant("default", {
  branding: { theme: { primary: "#00ff00" } },
})

// Level 4: Built-in default (THEME_OPENAUTH) - always available
```

### Breaking Changes

**None**. This is a backward-compatible addition.

### API Consumers Using HTTP Headers

**No changes required**. HTTP headers continue to be set:

```http
GET /authorize?client_id=...&redirect_uri=...
Host: auth.tenant.com

HTTP/1.1 200 OK
X-Theme-Vars: --oa-primary: #007bff; --oa-secondary: #6c757d
X-Logo-Light: https://tenant.com/logo-light.png
X-Logo-Dark: https://tenant.com/logo-dark.png
X-Favicon: https://tenant.com/favicon.ico
```

Frontend applications can continue reading these headers to apply branding dynamically.

## Implementation Checklist

### Phase 1: Core Implementation

- [ ] Implement `resolveTheme()` function with proper precedence
- [ ] Update `createMultiTenantIssuer` to accept `theme` config option
- [ ] Modify theme resolution middleware to use new logic
- [ ] Add theme merging utilities
- [ ] Update type definitions

### Phase 2: Testing

- [ ] Write unit tests for regular issuer theming
- [ ] Write unit tests for multi-tenant theming
- [ ] Write theme resolution logic tests
- [ ] Write concurrency tests
- [ ] Write backward compatibility tests
- [ ] Write migration scenario tests
- [ ] Write E2E integration tests

### Phase 3: Documentation

- [ ] Update API documentation
- [ ] Create migration guide
- [ ] Add code examples
- [ ] Update README with new features
- [ ] Create troubleshooting guide

### Phase 4: Validation

- [ ] Run full test suite
- [ ] Performance benchmarks
- [ ] Security review
- [ ] API compatibility check

## Test Execution Plan

### Local Development

```bash
# Run all theme tests
bun test test/theme/

# Run specific test suites
bun test test/theme/regular-issuer-theme.test.ts
bun test test/theme/multi-tenant-theme.test.ts
bun test test/theme/theme-concurrency.test.ts

# Run with coverage
bun test --coverage test/theme/
```

### CI/CD Pipeline

```yaml
# .github/workflows/test-theme.yml
name: Theme Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun test test/theme/ --coverage
      - run: bun test test/integration/theme-e2e.test.ts
      - run: bun test test/migration/theme-migration.test.ts
```

## Performance Considerations

### Theme Resolution Caching

For high-traffic multi-tenant systems, consider caching theme resolution:

```typescript
// Optional: Add theme caching
const themeCache = new Map<string, Theme>()

function getCachedTheme(tenantId: string): Theme | undefined {
  return themeCache.get(tenantId)
}

function setCachedTheme(tenantId: string, theme: Theme): void {
  themeCache.set(tenantId, theme)
}

function invalidateThemeCache(tenantId: string): void {
  themeCache.delete(tenantId)
}
```

**Note**: Caching is out of scope for initial implementation but should be considered for v2.

### Concurrency Safety

- Use immutable data structures for theme objects
- Avoid shared state between requests
- Each request gets its own theme resolution
- No global state pollution

## Success Criteria

### Functional Requirements

- ✅ Regular issuer continues to work without changes
- ✅ Multi-tenant issuer supports config.theme as default
- ✅ Per-tenant branding overrides default theme
- ✅ HTTP headers continue to be set for API consumers
- ✅ No theme bleed between concurrent requests
- ✅ Theme resolution follows documented precedence

### Non-Functional Requirements

- ✅ Test coverage > 95% for theme code
- ✅ No performance degradation (< 5ms overhead)
- ✅ Zero breaking changes for existing code
- ✅ Clear migration path documented
- ✅ All concurrency tests pass

## Troubleshooting Guide

### Issue: Theme not applying to tenant

**Symptoms**: Tenant shows default theme instead of custom theme.

**Diagnosis**:

1. Check tenant branding in database
2. Verify domain resolution is working
3. Check theme resolution precedence
4. Look for conflicting config

**Solution**:

```typescript
// Debug theme resolution
const tenant = await tenantService.getTenant(tenantId)
console.log("Tenant branding:", tenant.branding)

const resolved = resolveTheme({
  configTheme: config.theme,
  tenantTheme: tenant.branding?.theme,
  defaultTheme: THEME_OPENAUTH,
})
console.log("Resolved theme:", resolved)
```

### Issue: Theme bleed between tenants

**Symptoms**: One tenant's theme appears in another tenant's requests.

**Diagnosis**:

1. Check for global state usage
2. Verify request isolation
3. Review concurrency test failures

**Solution**:

- Ensure theme is resolved per-request
- Avoid storing theme in global variables
- Use context variables for theme data

### Issue: HTTP headers not set

**Symptoms**: API consumers not receiving theme headers.

**Diagnosis**:

1. Check if theme middleware is applied
2. Verify middleware order
3. Check header keys

**Solution**:

```typescript
// Ensure middleware is applied AFTER tenant resolution
app.use(
  "*",
  createTenantResolver({
    /* ... */
  }),
)
app.use(
  "*",
  createTenantThemeMiddleware({
    /* ... */
  }),
)
```

## Appendix A: Test Data Fixtures

```typescript
// test/fixtures/themes.ts
export const TEST_THEMES = {
  default: THEME_OPENAUTH,
  sst: THEME_SST,
  terminal: THEME_TERMINAL,
  custom: {
    title: "Test App",
    primary: "#007bff",
    secondary: "#6c757d",
    background: "#ffffff",
    logo: "https://test.com/logo.png",
    favicon: "https://test.com/favicon.ico",
  },
}

export const TEST_TENANTS = {
  tenant1: {
    id: "tenant-1",
    name: "Tenant 1",
    domain: "auth1.test.com",
    branding: {
      theme: { primary: "#ff0000" },
      logoLight: "https://tenant1.com/logo-light.png",
    },
  },
  tenant2: {
    id: "tenant-2",
    name: "Tenant 2",
    domain: "auth2.test.com",
    branding: {
      theme: { primary: "#00ff00" },
      logoLight: "https://tenant2.com/logo-light.png",
    },
  },
}
```

## Appendix B: Performance Benchmarks

Target performance metrics:

| Operation                    | Target         | Threshold      |
| ---------------------------- | -------------- | -------------- |
| Theme resolution (cached)    | < 1ms          | < 5ms          |
| Theme resolution (uncached)  | < 5ms          | < 10ms         |
| HTTP header injection        | < 0.5ms        | < 2ms          |
| CSS variable generation      | < 0.1ms        | < 1ms          |
| Concurrent request isolation | No degradation | < 10% overhead |

## References

- **Related Plans**: 01-architecture.md, 02-api-design.md, 03-theme-resolution.md, 04-ui-integration.md
- **OpenAuth Issues**: [Link to related issues]
- **Testing Framework**: Bun Test
- **Type Safety**: TypeScript 5.x
- **Test Patterns**: AAA (Arrange-Act-Assert)
