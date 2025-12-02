# Plan: Unified Theming for Multi-Tenant Issuer

## Problem

The regular `issuer()` and `createMultiTenantIssuer()` handle theming differently:

| Aspect        | Regular Issuer                               | Multi-Tenant Issuer                    |
| ------------- | -------------------------------------------- | -------------------------------------- |
| Theme source  | `config.theme` → `setTheme()` → `globalThis` | `tenant.branding` → HTTP headers       |
| UI reads from | `getTheme()` → `globalThis.OPENAUTH_THEME`   | Same (broken - headers ignored)        |
| Result        | Works                                        | UI shows default theme, ignores tenant |

## Goal

Make multi-tenant issuer theme the same way as regular issuer:

1. If `config.theme` provided → use as default for all tenants
2. If no config theme → pull default from "default" tenant in DB
3. Per-tenant: override with `tenant.branding.theme`
4. UI components render with correct per-request theme

## Current Flow

```
Regular Issuer:
  startup: setTheme(config.theme) → globalThis.OPENAUTH_THEME
  request: Layout → getTheme() → globalThis.OPENAUTH_THEME → render

Multi-Tenant Issuer:
  startup: (nothing)
  request:
    middleware: tenant.branding → HTTP headers (unused by UI)
    Layout → getTheme() → globalThis.OPENAUTH_THEME (empty!) → default theme
```

## Proposed Solution

### Option A: Context-Based Theme (Recommended)

Change `getTheme()` to read from Hono context instead of globalThis, allowing per-request theming.

#### Changes Required:

1. **src/ui/theme.ts** - Add context-aware theme functions:

```typescript
// Keep setTheme/getTheme for backwards compat (regular issuer)
export function setTheme(value: Theme) {
  globalThis.OPENAUTH_THEME = value
}

export function getTheme() {
  return globalThis.OPENAUTH_THEME || THEME_OPENAUTH
}

// New: context-aware version for multi-tenant
export function setRequestTheme(ctx: Context, theme: Theme) {
  ctx.set("theme", theme)
}

export function getRequestTheme(ctx: Context): Theme {
  return ctx.get("theme") || getTheme()
}
```

2. **src/ui/base.tsx** - Accept theme as prop:

```typescript
export function Layout(
  props: PropsWithChildren<{
    size?: "small"
    theme?: Theme // New: optional theme override
  }>,
) {
  const theme = props.theme || getTheme()
  // ... rest unchanged
}
```

3. **src/enterprise/issuer.ts** - Build theme and pass to UI:

```typescript
// In createMultiTenantIssuer, replace createTenantThemeMiddleware with:
app.use("*", async (c, next) => {
  const tenant = getTenant(c)

  // Priority: tenant theme → config theme → default
  let theme: Theme = config.theme || THEME_OPENAUTH

  if (tenant?.branding?.theme) {
    theme = { ...theme, ...tenant.branding.theme }
  }

  // Also set logos, favicon from tenant branding
  if (tenant?.branding) {
    if (tenant.branding.logoLight)
      theme.logo = {
        light: tenant.branding.logoLight,
        dark: tenant.branding.logoDark,
      }
    if (tenant.branding.favicon) theme.favicon = tenant.branding.favicon
  }

  setRequestTheme(c, theme)
  await next()
})
```

4. **Provider UIs** - Pass theme from context:

```typescript
// In provider render functions, get theme from context and pass to Layout
const theme = getRequestTheme(c)
return c.html(<Layout theme={theme}>...</Layout>)
```

### Option B: Middleware Sets Global (Simpler but Race Condition Risk)

Set `globalThis.OPENAUTH_THEME` per-request in middleware.

**Risk**: Race conditions in concurrent requests - one tenant's theme bleeds into another's render.

**Not recommended** for production multi-tenant.

---

## Implementation Steps

### Phase 1: Backwards-Compatible Theme Prop

1. [ ] Modify `Layout` in `src/ui/base.tsx` to accept optional `theme` prop
2. [ ] If `theme` prop provided, use it; otherwise fall back to `getTheme()`
3. [ ] No breaking changes - existing code works unchanged

### Phase 2: Context-Aware Theme in Enterprise Issuer

4. [ ] Add `setRequestTheme()` / `getRequestTheme()` to `src/ui/theme.ts`
5. [ ] Create new theme middleware for enterprise issuer that:
   - Resolves theme from: tenant.branding → config.theme → DB default tenant → THEME_OPENAUTH
   - Sets theme in Hono context via `setRequestTheme()`
6. [ ] Modify `createMultiTenantIssuer` to use new middleware instead of `createTenantThemeMiddleware`

### Phase 3: Provider UI Integration

7. [ ] Update `CodeUI` to read theme from context and pass to Layout
8. [ ] Update `PasswordUI` to read theme from context and pass to Layout
9. [ ] Update `SelectUI` to read theme from context and pass to Layout

### Phase 4: Default Tenant Fallback

10. [ ] Add logic to fetch "default" tenant from DB if no config.theme
11. [ ] Cache default tenant theme to avoid DB hit per request

### Phase 5: Cleanup

12. [ ] Keep HTTP headers for API consumers (they can still read X-Theme-Vars)
13. [ ] Update enterprise types to document theme priority
14. [ ] Add tests for theme resolution

## Theme Priority (Final)

```
1. tenant.branding.theme (if tenant resolved and has branding)
2. config.theme (if provided in createMultiTenantIssuer config)
3. Default tenant from DB (tenant with id="default" or slug="default")
4. THEME_OPENAUTH (hardcoded fallback)
```

## Files to Modify

- `src/ui/theme.ts` - Add context functions
- `src/ui/base.tsx` - Accept theme prop
- `src/ui/code.tsx` - Pass theme to Layout
- `src/ui/password.tsx` - Pass theme to Layout
- `src/ui/select.tsx` - Pass theme to Layout
- `src/enterprise/issuer.ts` - New theme middleware
- `src/enterprise/types.ts` - Document theme in config
- `src/tenant/theme.ts` - Keep for HTTP header fallback

## Testing

- [ ] Regular issuer with theme config still works
- [ ] Multi-tenant issuer with config.theme applies to all tenants
- [ ] Multi-tenant issuer without config.theme uses default tenant from DB
- [ ] Per-tenant branding overrides default
- [ ] Concurrent requests don't have theme bleed
- [ ] HTTP headers still set for API consumers
