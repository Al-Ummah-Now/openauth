# Provider UI Integration - Architectural Plan

## Overview

This plan details the integration of theme support into provider UIs (CodeUI, PasswordUI, SelectUI) by enabling them to receive theme context from the Hono request context and pass it to the Layout component, replacing the current global theme access pattern.

## Current Architecture

### Provider Rendering Flow

```
Issuer Route Handler (Hono Context)
    ↓
Provider.init() (has Hono Context)
    ↓
config.request(c.req.raw, state, form, error) - Raw Request only
    ↓
CodeUI/PasswordUI callback (no context)
    ↓
<Layout /> - reads from globalThis.OPENAUTH_THEME
    ↓
Response with HTML string
```

### Key Current Behaviors

1. **Provider UI Functions**: Return configuration objects with callback functions
   - `CodeUI(options)` → returns `CodeProviderOptions` with `request` callback
   - `PasswordUI(options)` → returns `PasswordConfig` with `login`, `register`, `change` callbacks
   - `Select(props)` → returns async function that receives providers and request

2. **Callback Signatures**:

   ```typescript
   // CodeUI
   request: (req: Request, state, form?, error?) => Promise<Response>

   // PasswordUI
   login: (req: Request, form?, error?) => Promise<Response>
   register: (req: Request, state, form?, error?) => Promise<Response>
   change: (req: Request, state, form?, error?) => Promise<Response>

   // SelectUI
   (providers: Record<string, string>, req: Request) => Promise<Response>
   ```

3. **Invocation Points**:
   - **CodeProvider**: Line 158 - `await config.request(c.req.raw, next, fd, err)`
   - **PasswordProvider**: Lines 278, 284, 318, 337, 432, 446 - `await config.login/register/change(c.req.raw, ...)`
   - **Select**: Line 1233 in issuer.ts - `await select()(providers, c.req.raw)`

4. **Theme Access**:
   - Layout component calls `getTheme()` which reads `globalThis.OPENAUTH_THEME`
   - Set once at issuer initialization via `setTheme(input.theme)` (line 545, issuer.ts)
   - No tenant-specific theme support in current implementation

## Problem Statement

### Multi-Tenant Requirements

- Tenants need different themes (branding, colors, logos)
- Current global theme approach only supports single theme
- Provider UIs need access to tenant-specific theme from context

### Architectural Constraints

1. Provider callbacks only receive `Request` (not Hono `Context`)
2. Layout component has no context awareness
3. Cannot easily pass context through JSX component tree
4. Must maintain backwards compatibility with existing provider UIs

## Proposed Solution

### Architecture Pattern: Theme via Request Headers

Instead of modifying provider callback signatures or using context threading, leverage HTTP headers as a side channel for theme data.

```
Issuer Route Handler (Hono Context with theme)
    ↓
Store theme in context variable
    ↓
Provider.init() - Add theme to Request headers before calling config.request
    ↓
config.request(enriched_req, state, form, error)
    ↓
Provider UI callback - Extract theme from request headers
    ↓
<Layout theme={theme} /> - Use passed theme prop
    ↓
Response with themed HTML
```

### Design Decisions

#### Decision 1: Request Header Transport

**Rationale**: Minimal API surface change while enabling theme propagation

- Preserves existing callback signatures
- No breaking changes to provider interface
- Headers naturally flow with Request object
- Easy to implement fallback for backwards compatibility

**Alternative Considered**: Modify callback signatures to accept Context

- Rejected: Breaking change for all existing custom providers
- Would require version bump and migration guide

#### Decision 2: Layout Component Enhancement

**Rationale**: Support both prop-based and global theme access

```typescript
export function Layout(
  props: PropsWithChildren<{
    size?: "small"
    theme?: Theme // NEW: explicit theme prop
  }>,
) {
  // Priority: props.theme > request header > globalThis
  const theme = props.theme ?? getTheme()
  // ... rest unchanged
}
```

#### Decision 3: Header Name Convention

Use `X-OpenAuth-Theme` header for internal theme transport

- Clear namespace
- Internal implementation detail
- Can be removed in provider before returning Response

## Implementation Plan

### Phase 1: Core Provider Integration (CodeUI, PasswordUI)

#### File: `src/provider/code.ts`

**Change Location**: Line 156-159 (transition function)

**Current Code**:

```typescript
async function transition(
  c: Context,
  next: CodeProviderState,
  fd?: FormData,
  err?: CodeProviderError,
) {
  await ctx.set<CodeProviderState>(c, "provider", 60 * 60 * 24, next)
  const resp = ctx.forward(c, await config.request(c.req.raw, next, fd, err))
  return resp
}
```

**Proposed Change**:

```typescript
async function transition(
  c: Context,
  next: CodeProviderState,
  fd?: FormData,
  err?: CodeProviderError,
) {
  await ctx.set<CodeProviderState>(c, "provider", 60 * 60 * 24, next)

  // Extract theme from context if available
  const theme = c.get("theme") || c.get("tenantTheme")

  // Create enriched request with theme header
  const req = theme
    ? new Request(c.req.raw, {
        headers: {
          ...Object.fromEntries(c.req.raw.headers),
          "X-OpenAuth-Theme": JSON.stringify(theme),
        },
      })
    : c.req.raw

  const resp = ctx.forward(c, await config.request(req, next, fd, err))
  return resp
}
```

**Impact**: All CodeUI renders will receive theme through request header

---

#### File: `src/provider/password.ts`

**Change Locations**: Multiple callback invocations

1. **Lines 278, 284** (login routes):

```typescript
// Helper to enrich request with theme
function enrichRequest(c: Context): Request {
  const theme = c.get("theme") || c.get("tenantTheme")
  if (!theme) return c.req.raw

  return new Request(c.req.raw, {
    headers: {
      ...Object.fromEntries(c.req.raw.headers),
      "X-OpenAuth-Theme": JSON.stringify(theme),
    },
  })
}

routes.get("/authorize", async (c) =>
  ctx.forward(c, await config.login(enrichRequest(c))),
)

routes.post("/authorize", async (c) => {
  const fd = await c.req.formData()
  async function error(err: PasswordLoginError) {
    return ctx.forward(c, await config.login(enrichRequest(c), fd, err))
  }
  // ... rest unchanged
})
```

2. **Lines 318, 337** (register route):

```typescript
routes.get("/register", async (c) => {
  // ...
  return ctx.forward(c, await config.register(enrichRequest(c), state))
})

routes.post("/register", async (c) => {
  // ... in error function:
  return ctx.forward(c, await config.register(enrichRequest(c), next, fd, err))
})
```

3. **Lines 432, 446** (change route):

```typescript
routes.get("/change", async (c) => {
  // ...
  return ctx.forward(c, await config.change(enrichRequest(c), state))
})

// ... in transition function:
async function transition(...) {
  await ctx.set<PasswordChangeState>(c, "provider", 60 * 60 * 24, next)
  return ctx.forward(c, await config.change(enrichRequest(c), next, fd, err))
}
```

**Impact**: All PasswordUI renders will receive theme through request header

---

#### File: `src/ui/code.tsx`

**Change Location**: Lines 121, 151 (Layout component calls)

**Add Helper Function** (top of file, after imports):

```typescript
/**
 * Extracts theme from request header if available
 * @internal
 */
function getThemeFromRequest(req: Request): Theme | undefined {
  const themeHeader = req.headers.get("X-OpenAuth-Theme")
  if (!themeHeader) return undefined

  try {
    return JSON.parse(themeHeader) as Theme
  } catch {
    return undefined
  }
}
```

**Update request callback** (lines 121-148):

```typescript
request: async (req, state, _form, error): Promise<Response> => {
  const theme = getThemeFromRequest(req)  // NEW

  if (state.type === "start") {
    const jsx = (
      <Layout theme={theme}>  {/* CHANGED: pass theme prop */}
        <form data-component="form" method="post">
          {/* ... rest unchanged */}
        </form>
      </Layout>
    )
    // ... rest unchanged
  }

  if (state.type === "code") {
    const jsx = (
      <Layout theme={theme}>  {/* CHANGED: pass theme prop */}
        <form data-component="form" class="form" method="post">
          {/* ... rest unchanged */}
        </form>
      </Layout>
    )
    // ... rest unchanged
  }

  throw new UnknownStateError()
}
```

**Impact**: CodeUI will use tenant-specific theme from request header

---

#### File: `src/ui/password.tsx`

**Change Location**: Lines 165, 210, 301 (Layout component calls)

**Add Helper Function** (after imports, same as code.tsx):

```typescript
/**
 * Extracts theme from request header if available
 * @internal
 */
function getThemeFromRequest(req: Request): Theme | undefined {
  const themeHeader = req.headers.get("X-OpenAuth-Theme")
  if (!themeHeader) return undefined

  try {
    return JSON.parse(themeHeader) as Theme
  } catch {
    return undefined
  }
}
```

**Update all three callbacks**:

1. **login callback** (line 165):

```typescript
login: async (req, form, error): Promise<Response> => {
  const theme = getThemeFromRequest(req)  // NEW
  const jsx = (
    <Layout theme={theme}>  {/* CHANGED */}
      <form data-component="form" method="post">
        {/* ... rest unchanged */}
      </form>
    </Layout>
  )
  // ... rest unchanged
}
```

2. **register callback** (line 210):

```typescript
register: async (req, state, form, error): Promise<Response> => {
  const theme = getThemeFromRequest(req)  // NEW
  // ... emailError, passwordError unchanged
  const jsx = (
    <Layout theme={theme}>  {/* CHANGED */}
      <form data-component="form" method="post">
        {/* ... rest unchanged */}
      </form>
    </Layout>
  )
  // ... rest unchanged
}
```

3. **change callback** (line 301):

```typescript
change: async (req, state, form, error): Promise<Response> => {
  const theme = getThemeFromRequest(req)  // NEW
  const passwordError = [/* ... */].includes(error?.type || "")
  const jsx = (
    <Layout theme={theme}>  {/* CHANGED */}
      <form data-component="form" method="post" replace>
        {/* ... rest unchanged */}
      </form>
    </Layout>
  )
  // ... rest unchanged
}
```

**Impact**: PasswordUI will use tenant-specific theme from request header

---

### Phase 2: Select UI Integration

#### File: `src/issuer.ts`

**Change Location**: Line 1233 (select invocation)

**Current Code**:

```typescript
return auth.forward(
  c,
  await select()(
    Object.fromEntries(
      Object.entries(input.providers).map(([key, value]) => [key, value.type]),
    ),
    c.req.raw,
  ),
)
```

**Proposed Change**:

```typescript
// Extract theme from context if available
const theme = c.get("theme") || c.get("tenantTheme")

// Create enriched request with theme header
const req = theme
  ? new Request(c.req.raw, {
      headers: {
        ...Object.fromEntries(c.req.raw.headers),
        "X-OpenAuth-Theme": JSON.stringify(theme),
      },
    })
  : c.req.raw

return auth.forward(
  c,
  await select()(
    Object.fromEntries(
      Object.entries(input.providers).map(([key, value]) => [key, value.type]),
    ),
    req, // Pass enriched request
  ),
)
```

**Impact**: Select UI will receive theme through request header

---

#### File: `src/ui/select.tsx`

**Change Location**: Line 67 (Layout component call)

**Add Helper Function** (after imports):

```typescript
/**
 * Extracts theme from request header if available
 * @internal
 */
function getThemeFromRequest(req: Request): Theme | undefined {
  const themeHeader = req.headers.get("X-OpenAuth-Theme")
  if (!themeHeader) return undefined

  try {
    return JSON.parse(themeHeader) as Theme
  } catch {
    return undefined
  }
}
```

**Add Import**:

```typescript
import type { Theme } from "./theme.js"
```

**Update Select function** (line 62-95):

```typescript
export function Select(props?: SelectProps) {
  return async (
    providers: Record<string, string>,
    req: Request,  // This already receives Request
  ): Promise<Response> => {
    const theme = getThemeFromRequest(req)  // NEW

    const jsx = (
      <Layout theme={theme}>  {/* CHANGED: pass theme prop */}
        <div data-component="form">
          {/* ... rest unchanged */}
        </div>
      </Layout>
    )

    return new Response(jsx.toString(), {
      headers: {
        "Content-Type": "text/html",
      },
    })
  }
}
```

**Impact**: Select UI will use tenant-specific theme from request header

---

### Phase 3: Layout Component Enhancement

#### File: `src/ui/base.tsx`

**Change Location**: Lines 5-10 (Layout function signature and theme access)

**Current Code**:

```typescript
export function Layout(
  props: PropsWithChildren<{
    size?: "small"
  }>,
) {
  const theme = getTheme()
  // ... rest
}
```

**Proposed Change**:

```typescript
import type { Theme } from "./theme.js"

export function Layout(
  props: PropsWithChildren<{
    size?: "small"
    theme?: Theme // NEW: optional theme prop
  }>,
) {
  // Priority: explicit prop > global theme
  // This maintains backwards compatibility
  const theme = props.theme ?? getTheme()

  function get(key: "primary" | "background" | "logo", mode: "light" | "dark") {
    if (!theme) return
    // ... rest unchanged
  }

  // ... rest unchanged
}
```

**Impact**:

- Backwards compatible - existing code without theme prop continues to work
- New code can pass explicit theme via prop
- Clear precedence: prop > global

---

### Phase 4: Type Updates

#### File: `src/ui/theme.ts`

**No changes needed** - Theme type is already exported and comprehensive

#### File: `src/provider/code.ts`

**No changes needed** - CodeProviderOptions already defined correctly

#### File: `src/provider/password.ts`

**No changes needed** - PasswordConfig already defined correctly

---

## Backwards Compatibility Strategy

### For Library Consumers

1. **No Breaking Changes**: All existing provider UIs continue to work
   - If no theme in context → falls back to global theme
   - If no global theme → uses THEME_OPENAUTH default

2. **Opt-in Enhancement**: Tenant-specific themes work automatically when:
   - Context has `theme` or `tenantTheme` variable set
   - No code changes required in provider UI definitions

### For Custom Provider Implementations

1. **Existing Custom UIs**: Continue to work without modification
   - They receive Request (unchanged)
   - Their Layout calls work (theme prop is optional)
   - Fall back to global theme behavior

2. **New Custom UIs**: Can optionally leverage theme header
   - Copy `getThemeFromRequest` helper
   - Pass theme to Layout component
   - Benefit from tenant-specific theming

## Integration with Multi-Tenant Architecture

### Context Variable Names

The implementation checks for theme in this priority order:

1. `c.get("theme")` - Regular issuer theme
2. `c.get("tenantTheme")` - Tenant-specific theme (set by tenant middleware)

### Flow in Multi-Tenant Scenario

```
Request to tenant subdomain
    ↓
Tenant Middleware (from plan 01)
    ↓
Sets c.set("tenantTheme", tenant.theme)
    ↓
Route Handler (Provider)
    ↓
Enriches Request with X-OpenAuth-Theme header
    ↓
Provider UI callback
    ↓
Extracts theme from header
    ↓
<Layout theme={tenantTheme} />
    ↓
Rendered with tenant branding
```

### Regular Issuer (Non-Tenant)

```
Request to regular issuer
    ↓
issuer() initialization sets globalThis.OPENAUTH_THEME
    ↓
Route Handler (Provider)
    ↓
c.get("theme") returns undefined
    ↓
Request passed without theme header
    ↓
Provider UI callback
    ↓
<Layout theme={undefined} />
    ↓
Layout uses getTheme() → globalThis.OPENAUTH_THEME
    ↓
Rendered with issuer theme
```

## Testing Strategy

### Unit Tests Required

1. **Theme Header Extraction**:
   - Test `getThemeFromRequest` with valid theme header
   - Test with missing header (returns undefined)
   - Test with invalid JSON (returns undefined)

2. **Layout Component**:
   - Test with explicit theme prop
   - Test without theme prop (falls back to global)
   - Test prop precedence (prop overrides global)

3. **Request Enrichment**:
   - Test theme added to request headers
   - Test request without theme (passthrough)
   - Test theme serialization/deserialization

### Integration Tests Required

1. **CodeUI Flow**:
   - Render with tenant theme in context
   - Render with global theme only
   - Verify correct theme applied in HTML

2. **PasswordUI Flow**:
   - Test login page with tenant theme
   - Test register page with tenant theme
   - Test change page with tenant theme

3. **SelectUI Flow**:
   - Render provider list with tenant theme
   - Verify theme in rendered HTML

4. **Multi-Tenant Scenario**:
   - Set tenant theme in context
   - Verify provider UIs receive tenant theme
   - Verify different tenants have different themes

## Security Considerations

1. **Theme Header is Internal**:
   - Header added just before provider callback
   - Removed/ignored in response
   - Never exposed to external requests

2. **JSON Serialization Safety**:
   - Try-catch around JSON.parse prevents crashes
   - Invalid theme data gracefully falls back to default

3. **Theme Object Validation**:
   - Consider adding Zod schema validation for theme objects
   - Prevent injection of malicious data through theme

## Performance Considerations

1. **Request Cloning Overhead**:
   - Only done when theme exists in context
   - Single shallow clone per request
   - Negligible impact (< 1ms)

2. **JSON Serialization**:
   - Theme objects are small (~1-2KB)
   - Serialization is fast
   - Could cache serialized theme if needed

3. **Header Parsing**:
   - Only done once per provider UI render
   - Minimal CPU overhead
   - Error handling prevents performance degradation

## Migration Path

### Phase 1: Internal Changes (Non-Breaking)

1. Update Layout component to accept theme prop
2. Add helper functions to provider UIs
3. Update provider calls to enrich requests
4. Deploy and test with existing setups

### Phase 2: Enable Multi-Tenant (Additive)

1. Tenant middleware sets theme in context
2. Provider UIs automatically pick it up
3. No changes to provider definitions

### Phase 3: Documentation (Informative)

1. Document theme prop in Layout
2. Show examples of custom provider UIs with theming
3. Explain theme precedence

## Success Criteria

1. ✅ All existing provider UIs render with global theme (no regression)
2. ✅ Multi-tenant issuer can render different themes per tenant
3. ✅ No breaking changes to public API
4. ✅ Custom provider UIs work without modification
5. ✅ Theme changes reflect immediately without restart
6. ✅ All unit and integration tests pass

## Files Modified Summary

### Core Provider Files

- `src/provider/code.ts` - Add request enrichment in transition function
- `src/provider/password.ts` - Add request enrichment helper and use in all routes

### UI Component Files

- `src/ui/base.tsx` - Add optional theme prop to Layout
- `src/ui/code.tsx` - Extract theme from request, pass to Layout
- `src/ui/password.tsx` - Extract theme from request, pass to Layout
- `src/ui/select.tsx` - Extract theme from request, pass to Layout

### Issuer File

- `src/issuer.ts` - Enrich request with theme before calling select()

### Type Files

- `src/ui/theme.ts` - Export Theme type (already done)

**Total Files**: 7 files
**Lines of Code Added**: ~150 lines
**Lines of Code Modified**: ~15 lines
**Breaking Changes**: 0

## Open Questions

1. **Should theme header be removed before response?**
   - Current: No, but it's in request, not response
   - Decision: No action needed, headers don't leak to response

2. **Should we validate theme structure?**
   - Current: No validation, just pass-through
   - Recommendation: Add Zod validation in future PR

3. **Should theme be cached in provider scope?**
   - Current: Extracted on every render
   - Recommendation: Premature optimization, revisit if perf issue

4. **Alternative header name?**
   - Current: `X-OpenAuth-Theme`
   - Alternative: `X-OpenAuth-Tenant-Theme` (more specific)
   - Decision: Keep short, context determines tenant vs global

## Next Steps

After implementing this plan:

1. Review and test all provider UI flows
2. Add comprehensive unit tests
3. Update integration tests for multi-tenant scenarios
4. Document theme prop in Layout component
5. Create example of custom provider UI with theming
6. Consider extracting `getThemeFromRequest` to shared utility
