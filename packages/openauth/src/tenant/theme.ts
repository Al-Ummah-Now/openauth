/**
 * Tenant Theme Middleware
 *
 * Injects tenant branding information into responses via HTTP headers.
 * This allows frontend applications to dynamically apply tenant-specific
 * styling without additional API calls.
 *
 * Headers set:
 * - X-Theme-Vars: CSS custom properties for theme colors/fonts
 * - X-Custom-CSS: URL or inline styles for custom CSS
 * - X-Logo-Light: Light mode logo URL
 * - X-Logo-Dark: Dark mode logo URL
 * - X-Favicon: Favicon URL
 *
 * @packageDocumentation
 */

import type { Context, MiddlewareHandler, Next } from "hono"
import type { Tenant, Theme, TenantBranding } from "../contracts/types.js"
import { THEME_CSS_VARS, THEME_HEADERS } from "./types.js"

/**
 * Options for the tenant theme middleware
 */
export interface TenantThemeOptions {
  /**
   * Default theme to use when tenant has no branding
   */
  defaultTheme?: Theme

  /**
   * Whether to include branding URLs (logos, favicon)
   * @default true
   */
  includeBrandingUrls?: boolean

  /**
   * Whether to include custom CSS
   * @default true
   */
  includeCustomCss?: boolean

  /**
   * Custom header prefix (default: "X-")
   */
  headerPrefix?: string
}

/**
 * Create tenant theme middleware
 *
 * This middleware reads the tenant from context (set by tenant resolver)
 * and injects theme-related headers into the response.
 *
 * Testing checklist:
 * - Theme middleware sets CSS vars when tenant has theme
 * - Theme middleware sets custom CSS when tenant has customCss
 * - Theme middleware sets logo URLs when tenant has logos
 * - Theme middleware sets favicon when tenant has favicon
 * - Theme middleware handles missing tenant gracefully
 * - Theme middleware handles missing branding gracefully
 * - Default theme is used when tenant has no theme
 * - CSS vars are properly formatted
 *
 * @param options - Theme middleware options
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * const app = new Hono()
 *
 * // Apply tenant resolution first
 * app.use("*", createTenantResolver({ service, storage }))
 *
 * // Then apply theme middleware
 * app.use("*", createTenantThemeMiddleware())
 *
 * // Or with options
 * app.use("*", createTenantThemeMiddleware({
 *   defaultTheme: { primary: "#007bff", secondary: "#6c757d" },
 *   includeBrandingUrls: true
 * }))
 * ```
 */
export function createTenantThemeMiddleware(
  options: TenantThemeOptions = {},
): MiddlewareHandler {
  const {
    defaultTheme = {},
    includeBrandingUrls = true,
    includeCustomCss = true,
  } = options

  return async function tenantThemeMiddleware(
    ctx: Context,
    next: Next,
  ): Promise<Response | void> {
    // Continue with the request first
    await next()

    // Get tenant from context (set by tenant resolver middleware)
    const tenant = ctx.get("tenant") as Tenant | undefined

    if (!tenant) {
      // No tenant resolved, apply default theme if any
      if (Object.keys(defaultTheme).length > 0) {
        const cssVars = buildCssVars(defaultTheme)
        if (cssVars) {
          ctx.res.headers.set(THEME_HEADERS.themeVars, cssVars)
        }
      }
      return
    }

    const branding = tenant.branding || {}

    // Set theme CSS variables
    const theme = { ...defaultTheme, ...branding.theme }
    const cssVars = buildCssVars(theme)
    if (cssVars) {
      ctx.res.headers.set(THEME_HEADERS.themeVars, cssVars)
    }

    // Set custom CSS if available
    if (includeCustomCss && branding.customCss) {
      ctx.res.headers.set(THEME_HEADERS.customCss, branding.customCss)
    }

    // Set branding URLs if available
    if (includeBrandingUrls) {
      if (branding.logoLight) {
        ctx.res.headers.set(THEME_HEADERS.logoLight, branding.logoLight)
      }
      if (branding.logoDark) {
        ctx.res.headers.set(THEME_HEADERS.logoDark, branding.logoDark)
      }
      if (branding.favicon) {
        ctx.res.headers.set(THEME_HEADERS.favicon, branding.favicon)
      }
    }
  }
}

/**
 * Build CSS custom properties string from theme object
 *
 * @param theme - Theme object
 * @returns CSS custom properties string (e.g., "--oa-primary: #007bff; --oa-secondary: #6c757d;")
 */
export function buildCssVars(theme: Partial<Theme>): string | null {
  const vars: string[] = []

  if (theme.primary) {
    vars.push(`${THEME_CSS_VARS.primary}: ${theme.primary}`)
  }
  if (theme.secondary) {
    vars.push(`${THEME_CSS_VARS.secondary}: ${theme.secondary}`)
  }
  if (theme.background) {
    vars.push(`${THEME_CSS_VARS.background}: ${theme.background}`)
  }
  if (theme.text) {
    vars.push(`${THEME_CSS_VARS.text}: ${theme.text}`)
  }
  if (theme.fontFamily) {
    vars.push(`${THEME_CSS_VARS.fontFamily}: ${theme.fontFamily}`)
  }

  if (vars.length === 0) {
    return null
  }

  return vars.join("; ")
}

/**
 * Parse CSS custom properties string back to theme object
 *
 * @param cssVars - CSS custom properties string
 * @returns Theme object
 */
export function parseCssVars(cssVars: string): Partial<Theme> {
  const theme: Partial<Theme> = {}

  if (!cssVars) {
    return theme
  }

  const pairs = cssVars
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)

  for (const pair of pairs) {
    const [key, value] = pair.split(":").map((s) => s.trim())

    switch (key) {
      case THEME_CSS_VARS.primary:
        theme.primary = value
        break
      case THEME_CSS_VARS.secondary:
        theme.secondary = value
        break
      case THEME_CSS_VARS.background:
        theme.background = value
        break
      case THEME_CSS_VARS.text:
        theme.text = value
        break
      case THEME_CSS_VARS.fontFamily:
        theme.fontFamily = value
        break
    }
  }

  return theme
}

/**
 * Generate inline style tag content from theme
 *
 * @param theme - Theme object
 * @param selector - CSS selector to apply styles to (default: ":root")
 * @returns CSS style content
 *
 * @example
 * ```typescript
 * const css = generateThemeStyles(tenant.branding.theme)
 * // Returns: ":root { --oa-primary: #007bff; --oa-secondary: #6c757d; }"
 * ```
 */
export function generateThemeStyles(
  theme: Partial<Theme>,
  selector: string = ":root",
): string {
  const cssVars = buildCssVars(theme)
  if (!cssVars) {
    return ""
  }
  return `${selector} { ${cssVars}; }`
}

/**
 * Generate complete branding styles including custom CSS
 *
 * @param branding - Tenant branding object
 * @param selector - CSS selector to apply theme styles to (default: ":root")
 * @returns Complete CSS content
 */
export function generateBrandingStyles(
  branding: TenantBranding,
  selector: string = ":root",
): string {
  const parts: string[] = []

  // Add theme CSS variables
  if (branding.theme) {
    const themeStyles = generateThemeStyles(branding.theme, selector)
    if (themeStyles) {
      parts.push(themeStyles)
    }
  }

  // Add custom CSS
  if (branding.customCss) {
    parts.push(branding.customCss)
  }

  return parts.join("\n")
}

/**
 * Helper to read theme from response headers
 *
 * @param headers - Response headers
 * @returns Theme data extracted from headers
 */
export function readThemeFromHeaders(headers: Headers): {
  theme: Partial<Theme>
  customCss?: string
  logoLight?: string
  logoDark?: string
  favicon?: string
} {
  const themeVars = headers.get(THEME_HEADERS.themeVars)
  const theme = themeVars ? parseCssVars(themeVars) : {}

  return {
    theme,
    customCss: headers.get(THEME_HEADERS.customCss) || undefined,
    logoLight: headers.get(THEME_HEADERS.logoLight) || undefined,
    logoDark: headers.get(THEME_HEADERS.logoDark) || undefined,
    favicon: headers.get(THEME_HEADERS.favicon) || undefined,
  }
}
