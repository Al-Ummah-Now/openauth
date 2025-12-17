/**
 * Tenant Theme Middleware
 *
 * Injects tenant branding information into responses via HTTP headers.
 * This allows frontend applications to dynamically apply tenant-specific
 * styling without additional API calls.
 *
 * Headers set:
 * - X-Theme-Vars: CSS custom properties for theme colors/fonts
 * - X-Custom-CSS: Custom CSS (for font imports, etc.)
 * - X-Logo-Light: Light mode logo URL
 * - X-Logo-Dark: Dark mode logo URL
 * - X-Favicon: Favicon URL
 *
 * @packageDocumentation
 */

import type { Context, MiddlewareHandler, Next } from "hono"
import type {
  Tenant,
  Theme,
  ColorScheme,
  TenantBranding,
} from "../contracts/types.js"
import { THEME_CSS_VARS, THEME_HEADERS } from "./types.js"

/**
 * Helper to get value from string or ColorScheme
 */
function getColorValue(
  value: string | ColorScheme | undefined,
  mode: "light" | "dark" = "light",
): string | undefined {
  if (!value) return undefined
  if (typeof value === "string") return value
  return value[mode]
}

/**
 * Options for the tenant theme middleware
 */
export interface TenantThemeOptions {
  /**
   * Default theme to use when tenant has no branding
   */
  defaultTheme?: Partial<Theme>

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
   * Color mode preference for ColorScheme values
   * @default "light"
   */
  colorMode?: "light" | "dark"
}

/**
 * Create tenant theme middleware
 *
 * This middleware reads the tenant from context (set by tenant resolver)
 * and injects theme-related headers into the response.
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
 *   defaultTheme: { primary: "#007bff" },
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
    colorMode = "light",
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
        const cssVars = buildCssVars(defaultTheme, colorMode)
        if (cssVars) {
          ctx.res.headers.set(THEME_HEADERS.themeVars, cssVars)
        }
      }
      return
    }

    const branding = tenant.branding || {}
    const theme = branding.theme || {}

    // Merge default theme with tenant theme
    const mergedTheme = { ...defaultTheme, ...theme }

    // Set theme CSS variables
    const cssVars = buildCssVars(mergedTheme, colorMode)
    if (cssVars) {
      ctx.res.headers.set(THEME_HEADERS.themeVars, cssVars)
    }

    // Set custom CSS if available (from theme.css)
    if (includeCustomCss && theme.css) {
      ctx.res.headers.set(THEME_HEADERS.customCss, theme.css)
    }

    // Set branding URLs if available (from theme.logo and theme.favicon)
    if (includeBrandingUrls) {
      const logoLight = getColorValue(theme.logo, "light")
      const logoDark = getColorValue(theme.logo, "dark")

      if (logoLight) {
        ctx.res.headers.set(THEME_HEADERS.logoLight, logoLight)
      }
      if (logoDark) {
        ctx.res.headers.set(THEME_HEADERS.logoDark, logoDark)
      }
      if (theme.favicon) {
        ctx.res.headers.set(THEME_HEADERS.favicon, theme.favicon)
      }
    }
  }
}

/**
 * Build CSS custom properties string from theme object
 *
 * @param theme - Theme object (supports ColorScheme for colors)
 * @param colorMode - Which color mode to use for ColorScheme values
 * @returns CSS custom properties string (e.g., "--oa-primary: #007bff;")
 */
export function buildCssVars(
  theme: Partial<Theme>,
  colorMode: "light" | "dark" = "light",
): string | null {
  const vars: string[] = []

  const primary = getColorValue(theme.primary, colorMode)
  if (primary) {
    vars.push(`${THEME_CSS_VARS.primary}: ${primary}`)
  }

  const background = getColorValue(theme.background, colorMode)
  if (background) {
    vars.push(`${THEME_CSS_VARS.background}: ${background}`)
  }

  if (theme.font?.family) {
    vars.push(`${THEME_CSS_VARS.fontFamily}: ${theme.font.family}`)
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
 * @returns Partial theme object
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
    const colonIndex = pair.indexOf(":")
    if (colonIndex === -1) continue

    const key = pair.substring(0, colonIndex).trim()
    const value = pair.substring(colonIndex + 1).trim()

    switch (key) {
      case THEME_CSS_VARS.primary:
        theme.primary = value
        break
      case THEME_CSS_VARS.background:
        theme.background = value
        break
      case THEME_CSS_VARS.fontFamily:
        theme.font = { ...theme.font, family: value }
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
 * @param colorMode - Which color mode to use for ColorScheme values
 * @returns CSS style content
 *
 * @example
 * ```typescript
 * const css = generateThemeStyles(tenant.branding.theme)
 * // Returns: ":root { --oa-primary: #007bff; }"
 * ```
 */
export function generateThemeStyles(
  theme: Partial<Theme>,
  selector: string = ":root",
  colorMode: "light" | "dark" = "light",
): string {
  const cssVars = buildCssVars(theme, colorMode)
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
 * @param colorMode - Which color mode to use for ColorScheme values
 * @returns Complete CSS content
 */
export function generateBrandingStyles(
  branding: TenantBranding,
  selector: string = ":root",
  colorMode: "light" | "dark" = "light",
): string {
  const parts: string[] = []

  // Add theme CSS variables
  if (branding.theme) {
    const themeStyles = generateThemeStyles(branding.theme, selector, colorMode)
    if (themeStyles) {
      parts.push(themeStyles)
    }
  }

  // Add custom CSS from theme
  if (branding.theme?.css) {
    parts.push(branding.theme.css)
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
  css?: string
  logoLight?: string
  logoDark?: string
  favicon?: string
} {
  const themeVars = headers.get(THEME_HEADERS.themeVars)
  const theme = themeVars ? parseCssVars(themeVars) : {}

  return {
    theme,
    css: headers.get(THEME_HEADERS.customCss) || undefined,
    logoLight: headers.get(THEME_HEADERS.logoLight) || undefined,
    logoDark: headers.get(THEME_HEADERS.logoDark) || undefined,
    favicon: headers.get(THEME_HEADERS.favicon) || undefined,
  }
}
