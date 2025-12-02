# UI Theme Core Architecture Plan

## Executive Summary

This document outlines the architectural changes needed to make the OpenAuth UI theming system context-aware and multi-tenant safe. The current implementation uses `globalThis.OPENAUTH_THEME` which causes race conditions in concurrent multi-tenant environments. The solution introduces per-request theme passing while maintaining backwards compatibility with the existing single-tenant issuer.

**Architectural Impact: HIGH**

This change affects:

- Core UI rendering system (`src/ui/base.tsx`)
- Theme management API (`src/ui/theme.ts`)
- All UI components that depend on theming
- Both single-tenant and multi-tenant issuers

---

## Current State Analysis

### 1. Theme Storage Pattern (Anti-Pattern)

**File: `src/ui/theme.ts` (lines 303-319)**

```typescript
// Current implementation - PROBLEMATIC
export function setTheme(value: Theme) {
  // @ts-ignore
  globalThis.OPENAUTH_THEME = value
}

export function getTheme() {
  // @ts-ignore
  return globalThis.OPENAUTH_THEME || THEME_OPENAUTH
}
```

**Problems:**

1. **Race Condition**: Concurrent requests overwrite each other's theme
2. **No Tenant Isolation**: All requests share the same global theme
3. **Tight Coupling**: UI components are tightly coupled to global state
4. **Testing Difficulty**: Global state makes unit testing harder

**Comment Analysis:**

```typescript
// i really don't wanna use async local storage for this so get over it
```

The original author avoided AsyncLocalStorage, which is the correct decision for performance. Our solution avoids AsyncLocalStorage while fixing the race condition.

### 2. UI Component Dependency

**File: `src/ui/base.tsx` (lines 5-18)**

```typescript
export function Layout(
  props: PropsWithChildren<{
    size?: "small"
  }>,
) {
  const theme = getTheme() // ← Reads from globalThis
  function get(key: "primary" | "background" | "logo", mode: "light" | "dark") {
    if (!theme) return
    if (!theme[key]) return
    if (typeof theme[key] === "string") return theme[key]
    return theme[key][mode] as string | undefined
  }
  // ... rest of component
}
```

**Problem:**

- `Layout` component immediately calls `getTheme()` which reads from `globalThis`
- No way to pass theme as a parameter
- Every concurrent request sees the same theme

### 3. Single-Tenant Issuer Usage

**File: `src/issuer.ts` (lines 544-546)**

```typescript
if (input.theme) {
  setTheme(input.theme)
}
```

**Analysis:**

- Single-tenant issuer sets theme once at startup
- Works fine for single-tenant (no concurrency issue)
- Must remain working after our changes

### 4. Multi-Tenant Issuer Attempt

**File: `src/enterprise/issuer.ts` (line 233)**

```typescript
app.use("*", createTenantThemeMiddleware())
```

**File: `src/tenant/theme.ts` (lines 85-142)**

The multi-tenant issuer uses middleware to inject theme via HTTP headers, but this doesn't help with server-side rendering since the UI components still call `getTheme()` which reads from `globalThis`.

**Gap:**

- Middleware sets headers for **client-side** theming
- Server-side rendering still uses `globalThis.OPENAUTH_THEME`
- Race condition remains for SSR components

---

## Proposed Architecture

### Design Principles

1. **Backwards Compatibility**: Single-tenant issuer continues working without changes
2. **No AsyncLocalStorage**: Avoid performance overhead of AsyncLocalStorage
3. **Explicit Context**: Theme passed explicitly through component props
4. **Graceful Fallback**: Falls back to global theme if no prop provided
5. **Zero Breaking Changes**: Existing code continues working

### Solution: Optional Theme Prop with Fallback

The solution is simple: add an optional `theme` prop to the `Layout` component that takes precedence over the global theme.

**Why This Works:**

- **Single-tenant**: Doesn't pass theme prop → falls back to `globalThis` → works as before
- **Multi-tenant**: Passes theme prop per-request → no race condition
- **Simple**: No complex context API or async storage
- **Testable**: Can test with explicit themes

---

## Detailed Implementation Plan

### Phase 1: Extend Theme API

**File: `src/ui/theme.ts`**

**Changes:**

1. Keep existing `setTheme()` and `getTheme()` for backwards compatibility
2. Add new `createTheme()` helper for creating theme objects
3. Add type exports for better IDE support

```typescript
// NEW: No changes to existing functions - they stay for backwards compatibility
// Lines 303-319 remain UNCHANGED

/**
 * @internal
 */
export function setTheme(value: Theme) {
  // @ts-ignore
  globalThis.OPENAUTH_THEME = value
}

/**
 * @internal
 */
export function getTheme() {
  // @ts-ignore
  return globalThis.OPENAUTH_THEME || THEME_OPENAUTH
}

// NEW: Helper to resolve theme with precedence
/**
 * Get theme with explicit precedence.
 *
 * @param explicitTheme - Theme passed explicitly (takes precedence)
 * @returns The resolved theme
 *
 * @internal
 */
export function resolveTheme(explicitTheme?: Theme): Theme {
  // Priority: explicit > global > default
  return explicitTheme || getTheme()
}

// NEW: Type export for component props
/**
 * Props for components that accept theme
 */
export interface ThemeProps {
  /**
   * Optional theme override. If not provided, falls back to global theme.
   */
  theme?: Theme
}
```

**Rationale:**

- No breaking changes to existing API
- `resolveTheme()` encapsulates fallback logic
- Type exports improve developer experience

---

### Phase 2: Enhance Layout Component

**File: `src/ui/base.tsx`**

**Changes:**

```typescript
import { PropsWithChildren } from "hono/jsx"
import css from "./ui.css" assert { type: "text" }
import { resolveTheme, type Theme } from "./theme.js"  // ← Import resolveTheme and Theme type

export function Layout(
  props: PropsWithChildren<{
    size?: "small"
    theme?: Theme  // ← NEW: Optional theme prop
  }>,
) {
  // NEW: Resolve theme with explicit > global precedence
  const theme = resolveTheme(props.theme)

  // Rest of component stays EXACTLY the same
  function get(key: "primary" | "background" | "logo", mode: "light" | "dark") {
    if (!theme) return
    if (!theme[key]) return
    if (typeof theme[key] === "string") return theme[key]
    return theme[key][mode] as string | undefined
  }

  const radius = (() => {
    if (theme?.radius === "none") return "0"
    if (theme?.radius === "sm") return "1"
    if (theme?.radius === "md") return "1.25"
    if (theme?.radius === "lg") return "1.5"
    if (theme?.radius === "full") return "1000000000001"
    return "1"
  })()

  const hasLogo = get("logo", "light") && get("logo", "dark")

  // JSX unchanged...
  return (
    <html
      style={{
        "--color-background-light": get("background", "light"),
        "--color-background-dark": get("background", "dark"),
        "--color-primary-light": get("primary", "light"),
        "--color-primary-dark": get("primary", "dark"),
        "--font-family": theme?.font?.family,
        "--font-scale": theme?.font?.scale,
        "--border-radius": radius,
      }}
    >
      {/* ... rest unchanged ... */}
    </html>
  )
}
```

**Changes Summary:**

- ✅ Add optional `theme` prop to component
- ✅ Replace `getTheme()` with `resolveTheme(props.theme)`
- ✅ All other code remains identical

**Backwards Compatibility:**

- Existing calls without `theme` prop: ✅ Works (falls back to global)
- New calls with `theme` prop: ✅ Works (uses provided theme)

---

### Phase 3: Update UI Component Consumers

**3.1 Password Provider UI**

**File: `src/provider/ui/password.tsx` (estimated)**

```typescript
// Before
export function PasswordUI(props: PasswordUIProps) {
  return (
    <Layout size="small">
      <form>...</form>
    </Layout>
  )
}

// After - ONLY if called from multi-tenant context
export function PasswordUI(props: PasswordUIProps & { theme?: Theme }) {
  return (
    <Layout size="small" theme={props.theme}>
      <form>...</form>
    </Layout>
  )
}
```

**3.2 Code Provider UI**

Similar pattern for `CodeUI` and other provider UIs.

**3.3 Select UI**

**File: `src/ui/select.tsx` (estimated)**

```typescript
export function Select(options?: SelectOptions) {
  return async (providers: Record<string, string>, req: Request, theme?: Theme) => {
    // ... logic ...

    return new Response(
      <Layout theme={theme}>
        <div>
          {Object.entries(providers).map(/* ... */)}
        </div>
      </Layout>
    )
  }
}
```

---

### Phase 4: Multi-Tenant Integration

**File: `src/enterprise/issuer.ts`**

**Pattern for Provider Routes:**

```typescript
// Around line 448-612
for (const [name, provider] of Object.entries(config.providers)) {
  const route = new Hono<any>()

  route.use(async (c, next) => {
    c.set("provider", name)
    await next()
  })

  provider.init(route, {
    name,
    storage: config.storage,
    async success(ctx: Context, properties: any, successOpts) {
      const tenant = getTenant(ctx)
      if (!tenant) {
        throw new Error("Tenant not resolved in success callback")
      }

      // NEW: Build theme from tenant branding
      const theme: Theme | undefined = tenant.branding?.theme
        ? {
            title: tenant.name,
            primary: tenant.branding.theme.primary,
            secondary: tenant.branding.theme.secondary,
            background: tenant.branding.theme.background,
            logo:
              tenant.branding.logoLight && tenant.branding.logoDark
                ? {
                    light: tenant.branding.logoLight,
                    dark: tenant.branding.logoDark,
                  }
                : undefined,
            favicon: tenant.branding.favicon,
            // ... map other branding fields
          }
        : undefined

      // ... existing success logic ...

      // When returning UI responses, pass theme
      // This is provider-specific, example:
      // return <Layout theme={theme}>...</Layout>
    },
    // ... other provider options unchanged ...
  })

  app.route(`/${name}`, route)
}
```

**Pattern for Authorization Endpoint:**

```typescript
// Around line 280-441
app.get("/authorize", async (c) => {
  const tenant = getTenant(c)
  if (!tenant) {
    return c.json(
      { error: "tenant_not_found", error_description: "Tenant not resolved" },
      404,
    )
  }

  // NEW: Build theme from tenant
  const theme = buildThemeFromTenant(tenant)

  // Store theme in context for downstream handlers
  c.set("theme", theme)

  // ... rest of authorization logic ...

  // When rendering provider selection:
  return renderProviderSelection(c, config.providers, tenant, theme)
})
```

**New Helper Function:**

```typescript
/**
 * Build OpenAuth Theme from Tenant branding
 */
function buildThemeFromTenant(tenant: Tenant): Theme | undefined {
  if (!tenant.branding?.theme) {
    return undefined
  }

  const branding = tenant.branding
  const theme: Theme = {
    title: tenant.name,
    primary: branding.theme.primary || "#007bff",
    background: branding.theme.background,
    // ... map other fields
  }

  if (branding.logoLight && branding.logoDark) {
    theme.logo = {
      light: branding.logoLight,
      dark: branding.logoDark,
    }
  }

  if (branding.favicon) {
    theme.favicon = branding.favicon
  }

  return theme
}
```

---

## Migration Guide for Users

### For Single-Tenant Issuer Users

**No changes required!** Your existing code continues working:

```typescript
// Before (still works)
import { issuer } from "@openauthjs/openauth"
import { THEME_SST } from "@openauthjs/openauth/ui/theme"

export default issuer({
  theme: THEME_SST, // ← Still works exactly as before
  providers: {
    /* ... */
  },
  // ...
})
```

**What happens under the hood:**

1. `issuer()` calls `setTheme(input.theme)` at startup
2. UI components call `resolveTheme(undefined)`
3. Falls back to `getTheme()` which returns the global theme
4. Everything works as before

### For Multi-Tenant Issuer Users

**Automatic!** The multi-tenant issuer passes themes automatically:

```typescript
// Your code
import { createMultiTenantIssuer } from "@openauthjs/openauth/enterprise"

const { app } = createMultiTenantIssuer({
  tenantService,
  providers: {
    /* ... */
  },
  // Theme is automatically resolved from tenant.branding
})
```

**What happens under the hood:**

1. Tenant resolver middleware sets `tenant` in context
2. Request handler extracts `tenant.branding.theme`
3. Passes theme to `Layout` component via prop
4. No race condition - each request has its own theme

### For Custom UI Component Authors

**If you create custom UI components:**

```typescript
import { Layout, type Theme } from "@openauthjs/openauth/ui"

// Before
export function MyCustomUI(props: MyProps) {
  return (
    <Layout>
      <div>{props.content}</div>
    </Layout>
  )
}

// After (optional - only if you need theme override)
export function MyCustomUI(props: MyProps & { theme?: Theme }) {
  return (
    <Layout theme={props.theme}>
      <div>{props.content}</div>
    </Layout>
  )
}
```

---

## Edge Cases & Considerations

### Edge Case 1: Provider UIs with Custom Themes

**Scenario:** Password provider needs to render UI in multi-tenant context

**Solution:**

```typescript
// Provider should accept and forward theme
provider.init(route, {
  async success(ctx, properties) {
    const theme = ctx.get("theme") as Theme | undefined

    // Pass to UI component
    return <PasswordUI theme={theme} {...otherProps} />
  }
})
```

### Edge Case 2: Nested Layouts

**Scenario:** Component renders multiple `Layout` instances

**Solution:** Each `Layout` should receive the same theme prop

```typescript
function ComplexUI(props: { theme?: Theme }) {
  return (
    <>
      <Layout theme={props.theme}>
        <div>Page 1</div>
      </Layout>
      <Layout theme={props.theme}>
        <div>Page 2</div>
      </Layout>
    </>
  )
}
```

### Edge Case 3: Theme in Error Handlers

**Scenario:** Error pages need theming

**Solution:**

```typescript
app.onError(async (err, c) => {
  const theme = c.get("theme") as Theme | undefined

  return c.html(
    <Layout theme={theme}>
      <div>Error: {err.message}</div>
    </Layout>
  )
})
```

### Edge Case 4: SSR vs Client-Side Rendering

**Scenario:** Some pages are SSR, others client-side

**Solution:**

- **SSR**: Use `theme` prop (per-request)
- **Client-side**: Use HTTP headers (already handled by `createTenantThemeMiddleware`)

Both approaches work together - SSR gets immediate theme, client-side can override from headers.

### Edge Case 5: Testing

**Before (harder):**

```typescript
test("renders with theme", () => {
  setTheme(THEME_SST)  // Pollutes global state
  const result = render(<Layout><div>Test</div></Layout>)
  expect(result).toMatchSnapshot()
})
```

**After (easier):**

```typescript
test("renders with theme", () => {
  const result = render(
    <Layout theme={THEME_SST}>
      <div>Test</div>
    </Layout>
  )
  expect(result).toMatchSnapshot()
  // No global state pollution
})
```

---

## Performance Considerations

### Memory Impact

**Before:**

- 1 global theme object shared by all requests
- Memory: O(1)

**After:**

- Still 1 global theme object (backwards compat)
- Multi-tenant: 1 theme object per request (garbage collected)
- Memory: O(1) for single-tenant, O(concurrent_requests) for multi-tenant

**Analysis:** Acceptable - theme objects are small (~1KB) and short-lived

### CPU Impact

**Before:**

```typescript
const theme = getTheme() // Simple property access
```

**After:**

```typescript
const theme = resolveTheme(props.theme) // One additional null check
```

**Overhead:** Negligible - single `||` operator

### No AsyncLocalStorage

**Decision Rationale:**

- AsyncLocalStorage has measurable overhead (~5-10% in some benchmarks)
- Our solution uses explicit prop passing - zero overhead
- Maintains author's original performance goal

---

## Testing Strategy

### Unit Tests

**File: `src/ui/theme.test.ts` (new)**

```typescript
import { describe, test, expect } from "vitest"
import { resolveTheme, setTheme, THEME_OPENAUTH } from "./theme"

describe("resolveTheme", () => {
  test("returns explicit theme when provided", () => {
    const explicit = { primary: "red" }
    expect(resolveTheme(explicit)).toBe(explicit)
  })

  test("falls back to global theme when no explicit theme", () => {
    const global = { primary: "blue" }
    setTheme(global)
    expect(resolveTheme()).toEqual(global)
  })

  test("explicit theme takes precedence over global", () => {
    setTheme({ primary: "blue" })
    const explicit = { primary: "red" }
    expect(resolveTheme(explicit)).toBe(explicit)
  })

  test("returns default when no theme set", () => {
    // Reset global
    delete globalThis.OPENAUTH_THEME
    expect(resolveTheme()).toEqual(THEME_OPENAUTH)
  })
})
```

**File: `src/ui/base.test.tsx` (new)**

```typescript
import { describe, test, expect } from "vitest"
import { render } from "@testing-library/react"
import { Layout } from "./base"
import { THEME_SST } from "./theme"

describe("Layout", () => {
  test("uses theme prop when provided", () => {
    const { container } = render(
      <Layout theme={THEME_SST}>
        <div>Test</div>
      </Layout>
    )

    const html = container.querySelector("html")
    expect(html?.style.getPropertyValue("--color-primary-light"))
      .toBe(THEME_SST.primary.light)
  })

  test("falls back to global theme when no prop", () => {
    setTheme(THEME_SST)
    const { container } = render(
      <Layout>
        <div>Test</div>
      </Layout>
    )

    const html = container.querySelector("html")
    expect(html?.style.getPropertyValue("--color-primary-light"))
      .toBe(THEME_SST.primary.light)
  })
})
```

### Integration Tests

**File: `test/multi-tenant-theme.test.ts` (new)**

```typescript
import { describe, test, expect } from "vitest"
import { createMultiTenantIssuer } from "../src/enterprise/issuer"

describe("Multi-tenant theming", () => {
  test("concurrent requests use different themes", async () => {
    const { app } = createMultiTenantIssuer({
      // ... config ...
    })

    // Simulate concurrent requests
    const [response1, response2] = await Promise.all([
      app.request("/authorize?tenant=tenant1"),
      app.request("/authorize?tenant=tenant2"),
    ])

    const html1 = await response1.text()
    const html2 = await response2.text()

    // Themes should be different
    expect(html1).toContain("tenant1-primary-color")
    expect(html2).toContain("tenant2-primary-color")
    expect(html1).not.toContain("tenant2-primary-color")
  })
})
```

---

## Rollout Plan

### Phase 1: Core Changes (Week 1)

- ✅ Update `src/ui/theme.ts` with `resolveTheme()`
- ✅ Update `src/ui/base.tsx` with optional `theme` prop
- ✅ Write unit tests
- ✅ Verify backwards compatibility with single-tenant tests

### Phase 2: Component Updates (Week 2)

- ✅ Update password provider UI
- ✅ Update code provider UI
- ✅ Update select UI
- ✅ Update any other UI components

### Phase 3: Multi-Tenant Integration (Week 3)

- ✅ Update enterprise issuer to pass themes
- ✅ Add `buildThemeFromTenant()` helper
- ✅ Update provider route handlers
- ✅ Write integration tests

### Phase 4: Documentation & Release (Week 4)

- ✅ Update API documentation
- ✅ Write migration guide
- ✅ Update examples in docs
- ✅ Release as minor version (non-breaking)

---

## Success Criteria

### Functional Requirements

- ✅ Single-tenant issuer works without changes
- ✅ Multi-tenant issuer has no race conditions
- ✅ Each tenant gets correct theme per request
- ✅ Theme type remains unchanged
- ✅ All existing tests pass

### Non-Functional Requirements

- ✅ Zero breaking changes (backwards compatible)
- ✅ No performance degradation
- ✅ No AsyncLocalStorage overhead
- ✅ Clear migration path documented
- ✅ Edge cases handled

### Quality Metrics

- ✅ Unit test coverage > 90% for new code
- ✅ Integration tests for multi-tenant scenarios
- ✅ Documentation covers all use cases
- ✅ Examples demonstrate both patterns

---

## Risk Assessment

### Risk 1: Provider UIs Missing Theme Prop

**Severity:** Medium
**Mitigation:** Comprehensive audit of all UI components, add theme prop to all

### Risk 2: Third-Party Providers

**Severity:** Low
**Mitigation:** Fallback to global theme ensures compatibility

### Risk 3: Performance Regression

**Severity:** Low
**Mitigation:** Benchmark before/after, solution adds minimal overhead

### Risk 4: Type Incompatibilities

**Severity:** Low
**Mitigation:** Theme type unchanged, only adding optional prop

---

## Alternative Approaches Considered

### Alternative 1: AsyncLocalStorage

**Pros:** No prop drilling
**Cons:** Performance overhead, complexity
**Decision:** Rejected due to performance concerns

### Alternative 2: React Context API

**Pros:** Idiomatic React pattern
**Cons:** Doesn't work with Hono JSX, adds complexity
**Decision:** Rejected - not compatible with Hono

### Alternative 3: Middleware State

**Pros:** Centralized theme management
**Cons:** Still uses global-like state, race conditions possible
**Decision:** Rejected - doesn't solve core problem

### Alternative 4: Separate Theme Function per Request

**Pros:** Complete isolation
**Cons:** Major breaking change, complex API
**Decision:** Rejected - too invasive

### Chosen Solution: Optional Theme Prop

**Pros:** Simple, backwards compatible, no overhead
**Cons:** Minor prop drilling needed
**Decision:** ✅ Best balance of simplicity and correctness

---

## Conclusion

This architecture plan provides a **simple, backwards-compatible solution** to the race condition problem in OpenAuth's theming system. By adding an optional `theme` prop to the `Layout` component and using a fallback pattern, we achieve:

1. **Zero breaking changes** for single-tenant users
2. **Race-condition-free** multi-tenant support
3. **No performance overhead** from AsyncLocalStorage
4. **Better testability** with explicit theme passing
5. **Clear migration path** for all users

The solution respects the original author's concerns about AsyncLocalStorage while providing a robust foundation for multi-tenant theming.

**Next Steps:**

1. Review and approve this plan
2. Implement Phase 1 (core changes)
3. Validate with existing tests
4. Proceed to subsequent phases

---

## Appendix: Code Diff Summary

### `src/ui/theme.ts`

```diff
+/**
+ * Get theme with explicit precedence.
+ * @internal
+ */
+export function resolveTheme(explicitTheme?: Theme): Theme {
+  return explicitTheme || getTheme()
+}
+
+/**
+ * Props for components that accept theme
+ */
+export interface ThemeProps {
+  theme?: Theme
+}
```

### `src/ui/base.tsx`

```diff
-import { getTheme } from "./theme.js"
+import { resolveTheme, type Theme } from "./theme.js"

 export function Layout(
   props: PropsWithChildren<{
     size?: "small"
+    theme?: Theme
   }>,
 ) {
-  const theme = getTheme()
+  const theme = resolveTheme(props.theme)
   // ... rest unchanged
```

### Total Lines Changed

- **Added:** ~50 lines (helpers, types, tests)
- **Modified:** 3 lines (base.tsx)
- **Deleted:** 0 lines
- **Impact:** Minimal, surgical changes

---

**Document Version:** 1.0
**Author:** Claude (Software Architect)
**Date:** 2025-12-02
**Status:** DRAFT - Awaiting Review
