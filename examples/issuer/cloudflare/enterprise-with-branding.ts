/**
 * Enterprise Multi-Tenant Issuer with Per-Tenant Branding
 *
 * This example demonstrates how to configure per-tenant branding/theming
 * with the enterprise issuer. It shows:
 *
 * 1. Default theme configuration in `config.theme`
 * 2. Per-tenant branding that overrides the default
 * 3. API calls to create tenants with custom branding
 * 4. Theme resolution priority chain
 *
 * THEME PRIORITY CHAIN (highest to lowest):
 * 1. tenant.branding.theme - Specific tenant's theme
 * 2. config.theme - Default theme from issuer config
 * 3. Default tenant from DB - (prepared for future use)
 * 4. THEME_OPENAUTH - Built-in fallback theme
 *
 * This allows:
 * - A default look for all tenants via config.theme
 * - Per-tenant customization via tenant.branding
 * - Graceful fallback to OpenAuth defaults
 *
 * @packageDocumentation
 */

import {
  createMultiTenantIssuer,
  hexToSecret,
  type Tenant,
} from "@openauthjs/openauth/enterprise"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"
import { SessionServiceImpl } from "@openauthjs/openauth/session"
import { TenantServiceImpl } from "@openauthjs/openauth/tenant"
import { RBACServiceImpl, RBACAdapter } from "@openauthjs/openauth/rbac"
import { PasswordProvider } from "@openauthjs/openauth/provider/password"
import { PasswordUI } from "@openauthjs/openauth/ui/password"
import type { Theme } from "@openauthjs/openauth/ui/theme"
import type { TenantBranding } from "@openauthjs/openauth/contracts/types"
import { subjects } from "../../subjects.js"
import {
  type ExecutionContext,
  type KVNamespace,
  type D1Database,
} from "@cloudflare/workers-types"

/**
 * Environment variables
 */
interface Env {
  AUTH_KV: KVNamespace
  AUTH_DB: D1Database
  SESSION_SECRET: string
  BASE_DOMAIN?: string
}

// ============================================
// THEME CONFIGURATION EXAMPLES
// ============================================

/**
 * Default theme applied to ALL tenants that don't have custom branding.
 *
 * This is set in the `config.theme` option of createMultiTenantIssuer.
 * It establishes your platform's default look and feel.
 */
const DEFAULT_PLATFORM_THEME: Theme = {
  // Platform name shown in title and headers
  title: "AlUmmahNow",

  // Primary color used for buttons, links, accents
  primary: {
    light: "#1e40af", // Blue-700
    dark: "#60a5fa", // Blue-400
  },

  // Background colors for light/dark mode
  background: {
    light: "#f8fafc", // Slate-50
    dark: "#0f172a", // Slate-900
  },

  // Platform favicon
  favicon: "https://example.com/favicon.ico",

  // Platform logo (different for light/dark mode)
  logo: {
    light: "https://example.com/logo-dark.svg",
    dark: "https://example.com/logo-light.svg",
  },

  // Typography
  font: {
    family: "Inter, system-ui, sans-serif",
    scale: "1",
  },

  // Border radius for UI elements
  radius: "md",

  // Custom CSS (e.g., font imports)
  css: `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  `,
}

// ============================================
// TENANT BRANDING EXAMPLES
// ============================================

/**
 * Example: Corporate tenant branding (Acme Corp)
 *
 * This shows how a tenant can completely customize their login experience.
 * The branding includes theme colors, logos, and custom styling.
 */
const ACME_CORP_BRANDING: TenantBranding = {
  // Theme settings override the default platform theme
  theme: {
    // Acme's brand red
    primary: "#dc2626",
    // White background
    background: "#ffffff",
    // Company name in title
    title: "Acme Corp",
  },

  // Logos for light and dark mode
  logoLight: "https://acme-corp.example.com/logo.svg",
  logoDark: "https://acme-corp.example.com/logo-white.svg",

  // Company favicon
  favicon: "https://acme-corp.example.com/favicon.ico",

  // Additional custom CSS
  customCss: `
    /* Acme's corporate font */
    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap');

    body {
      font-family: 'Roboto', sans-serif;
    }

    /* Custom button styling */
    .oa-button-primary {
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
  `,

  // Email template customization
  emailTemplates: {
    welcome: "acme-welcome",
    verification: "acme-verify",
    passwordReset: "acme-reset",
  },
}

/**
 * Example: Startup tenant branding (Contoso)
 *
 * A more minimal branding that just tweaks colors but keeps
 * most of the platform defaults.
 */
const CONTOSO_BRANDING: TenantBranding = {
  theme: {
    // Contoso's purple brand color
    primary: "#7c3aed",
    // Gradient-ready background
    background: {
      light: "#faf5ff",
      dark: "#1e1b4b",
    },
    title: "Contoso",
    // Modern rounded corners
    radius: "lg",
  },

  // Just use their logo
  logoLight: "https://contoso.example.com/logo.png",
  logoDark: "https://contoso.example.com/logo-white.png",
}

/**
 * Example: White-label tenant with complete rebrand
 *
 * This tenant has purchased a white-label package and wants
 * no trace of the parent platform branding.
 */
const WHITE_LABEL_BRANDING: TenantBranding = {
  theme: {
    primary: "#059669", // Emerald
    background: {
      light: "#ecfdf5",
      dark: "#022c22",
    },
    title: "GreenTech Portal",
    radius: "full",
    font: {
      family: "Poppins, sans-serif",
      scale: "1.1", // Slightly larger text
    },
    css: `
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
    `,
    favicon: "https://greentech.example.com/favicon.svg",
    logo: {
      light: "https://greentech.example.com/logo.svg",
      dark: "https://greentech.example.com/logo-white.svg",
    },
  },

  logoLight: "https://greentech.example.com/logo.svg",
  logoDark: "https://greentech.example.com/logo-white.svg",
  favicon: "https://greentech.example.com/favicon.svg",

  // Custom email templates for complete white-labeling
  emailTemplates: {
    welcome: "greentech-welcome",
    verification: "greentech-verify",
    passwordReset: "greentech-reset",
    magicLink: "greentech-magic",
  },
}

// ============================================
// CLOUDFLARE WORKER EXPORT
// ============================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const storage = CloudflareStorage({
      namespace: env.AUTH_KV,
    })

    const tenantService = new TenantServiceImpl(storage)
    const sessionService = new SessionServiceImpl(storage, {
      maxAccountsPerSession: 3,
      sessionLifetimeSeconds: 7 * 24 * 60 * 60,
      slidingWindowSeconds: 24 * 60 * 60,
    })

    const rbacAdapter = new RBACAdapter(env.AUTH_DB)
    const rbacService = new RBACServiceImpl(rbacAdapter, storage, {
      cachePermissionsTTL: 60,
      includeRolesInToken: true,
      includePermissionsInToken: true,
    })

    // ============================================
    // CREATE ENTERPRISE ISSUER WITH DEFAULT THEME
    // ============================================
    // The `theme` option sets the default theme for all tenants.
    // Individual tenants can override this with their own branding.

    const { app } = createMultiTenantIssuer({
      storage,
      tenantService,
      sessionService,
      rbacService,
      sessionSecret: hexToSecret(env.SESSION_SECRET),

      tenantResolver: {
        baseDomain: env.BASE_DOMAIN || "auth.example.com",
      },

      // ============================================
      // DEFAULT THEME CONFIGURATION
      // ============================================
      // This theme is applied to ALL tenants that don't have
      // their own branding.theme configuration.
      //
      // Theme Resolution Priority:
      // 1. tenant.branding.theme (if tenant has custom branding)
      // 2. config.theme (this setting - platform default)
      // 3. THEME_OPENAUTH (built-in fallback)
      //
      // This means:
      // - New tenants automatically get your platform's look
      // - Enterprise tenants can fully customize their experience
      // - You always have a consistent fallback
      theme: DEFAULT_PLATFORM_THEME,

      cors: {
        origins: ["https://app.example.com", "https://*.example.com"],
        credentials: true,
      },

      providers: {
        password: PasswordProvider(
          PasswordUI({
            sendCode: async (email, code) => {
              console.log(`Verification code for ${email}: ${code}`)
            },
          }),
        ),
      },

      subjects,

      onSuccess: async (ctx, authValue, tenant: Tenant) => {
        console.log("Auth success for tenant:", tenant.id)
        console.log("Tenant branding:", tenant.branding)

        // The tenant object includes the resolved branding
        // You can use this for custom email templates, etc.
        const emailTemplate =
          tenant.branding?.emailTemplates?.welcome || "default-welcome"
        console.log("Using email template:", emailTemplate)

        return ctx.subject("user", {
          id: "user-123",
          email:
            authValue.provider === "password" ? authValue.email : "unknown",
          tenantId: tenant.id,
          roles: [],
          permissions: [],
        })
      },
    })

    // ============================================
    // HANDLE TENANT CREATION WITH BRANDING
    // ============================================
    // The /tenants API endpoints allow creating tenants with branding.
    // Below are example API calls you would make to set up tenants.

    return app.fetch(request, env, ctx)
  },
}

// ============================================
// API USAGE EXAMPLES
// ============================================

/**
 * Example: Create a tenant with default branding
 *
 * When no branding is specified, the tenant will use config.theme.
 *
 * @example
 * ```bash
 * curl -X POST https://auth.example.com/tenants \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "id": "startup-xyz",
 *     "name": "Startup XYZ"
 *   }'
 * ```
 *
 * Result: Tenant uses DEFAULT_PLATFORM_THEME
 */

/**
 * Example: Create a tenant with custom branding
 *
 * @example
 * ```bash
 * curl -X POST https://auth.example.com/tenants \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "id": "acme",
 *     "name": "Acme Corporation",
 *     "domain": "login.acme-corp.com",
 *     "branding": {
 *       "theme": {
 *         "primary": "#dc2626",
 *         "background": "#ffffff",
 *         "title": "Acme Corp",
 *         "radius": "md",
 *         "font": {
 *           "family": "Roboto, sans-serif"
 *         }
 *       },
 *       "logoLight": "https://acme-corp.com/logo.svg",
 *       "logoDark": "https://acme-corp.com/logo-white.svg",
 *       "favicon": "https://acme-corp.com/favicon.ico",
 *       "customCss": "@import url(\"https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap\");"
 *     }
 *   }'
 * ```
 *
 * Result: Tenant uses custom ACME_CORP_BRANDING theme
 */

/**
 * Example: Update tenant branding
 *
 * @example
 * ```bash
 * curl -X PATCH https://auth.example.com/tenants/acme \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "branding": {
 *       "theme": {
 *         "primary": "#2563eb"
 *       }
 *     }
 *   }'
 * ```
 *
 * Result: Updates just the primary color, other settings remain
 */

/**
 * Example: Create white-label tenant
 *
 * @example
 * ```bash
 * curl -X POST https://auth.example.com/tenants \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "id": "greentech",
 *     "name": "GreenTech Portal",
 *     "domain": "auth.greentech.io",
 *     "branding": {
 *       "theme": {
 *         "primary": "#059669",
 *         "background": {
 *           "light": "#ecfdf5",
 *           "dark": "#022c22"
 *         },
 *         "title": "GreenTech Portal",
 *         "radius": "full",
 *         "font": {
 *           "family": "Poppins, sans-serif",
 *           "scale": "1.1"
 *         },
 *         "css": "@import url(\"https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap\");",
 *         "favicon": "https://greentech.io/favicon.svg",
 *         "logo": {
 *           "light": "https://greentech.io/logo.svg",
 *           "dark": "https://greentech.io/logo-white.svg"
 *         }
 *       },
 *       "logoLight": "https://greentech.io/logo.svg",
 *       "logoDark": "https://greentech.io/logo-white.svg",
 *       "favicon": "https://greentech.io/favicon.svg",
 *       "emailTemplates": {
 *         "welcome": "greentech-welcome",
 *         "verification": "greentech-verify",
 *         "passwordReset": "greentech-reset"
 *       }
 *     },
 *     "settings": {
 *       "allowPublicRegistration": true,
 *       "requireEmailVerification": true
 *     }
 *   }'
 * ```
 *
 * Result: Fully white-labeled tenant with no platform branding
 */

// ============================================
// THEME RESOLUTION VISUALIZATION
// ============================================

/**
 * How theme resolution works:
 *
 * Request to acme.auth.example.com/authorize
 *    |
 *    v
 * 1. Tenant Resolver: Resolves "acme" tenant from subdomain
 *    |
 *    v
 * 2. Theme Middleware runs:
 *    |
 *    +--> Check: Does tenant.branding.theme exist?
 *    |     |
 *    |     +--> YES: Use tenant.branding.theme (ACME_CORP_BRANDING.theme)
 *    |     |
 *    |     +--> NO: Continue to next priority
 *    |
 *    +--> Check: Does config.theme exist?
 *    |     |
 *    |     +--> YES: Use config.theme (DEFAULT_PLATFORM_THEME)
 *    |     |
 *    |     +--> NO: Continue to next priority
 *    |
 *    +--> Check: Does "default" tenant exist with branding?
 *    |     |
 *    |     +--> YES: Use default tenant's theme
 *    |     |
 *    |     +--> NO: Continue to next priority
 *    |
 *    +--> Use THEME_OPENAUTH (built-in fallback)
 *    |
 *    v
 * 3. setTheme(resolvedTheme) - Makes theme available to SSR
 *    |
 *    v
 * 4. Route handler renders UI with resolved theme
 *
 *
 * EXAMPLES:
 *
 * Tenant "acme" (has branding):
 *   Theme = ACME_CORP_BRANDING.theme (red primary, Roboto font)
 *
 * Tenant "startup-xyz" (no branding):
 *   Theme = DEFAULT_PLATFORM_THEME (blue primary, Inter font)
 *
 * Tenant "greentech" (white-label):
 *   Theme = WHITE_LABEL_BRANDING.theme (emerald, Poppins font)
 *
 * Unknown/new tenant (no config):
 *   Theme = THEME_OPENAUTH (black/white, IBM Plex Sans)
 */

// ============================================
// TYPESCRIPT HELPERS
// ============================================

/**
 * Helper function to create tenant branding with type safety
 */
export function createTenantBranding(options: {
  primaryColor: string
  companyName: string
  logoUrl: string
  logoDarkUrl?: string
  faviconUrl?: string
  fontFamily?: string
  customCss?: string
}): TenantBranding {
  return {
    theme: {
      primary: options.primaryColor,
      title: options.companyName,
      font: options.fontFamily
        ? {
            family: options.fontFamily,
          }
        : undefined,
    },
    logoLight: options.logoUrl,
    logoDark: options.logoDarkUrl || options.logoUrl,
    favicon: options.faviconUrl,
    customCss: options.customCss,
  }
}

/**
 * Helper to merge tenant branding with defaults
 */
export function mergeBrandingWithDefaults(
  tenantBranding: TenantBranding | undefined,
  defaultTheme: Theme,
): Theme {
  if (!tenantBranding?.theme) {
    return defaultTheme
  }

  // Merge tenant theme on top of defaults
  return {
    ...defaultTheme,
    ...tenantBranding.theme,
    font: {
      ...defaultTheme.font,
      ...tenantBranding.theme.font,
    },
  }
}

/**
 * DEPLOYMENT NOTES:
 *
 * 1. Set up your default platform theme in DEFAULT_PLATFORM_THEME
 * 2. Deploy the worker with `theme: DEFAULT_PLATFORM_THEME`
 * 3. Create tenants via API with custom branding as needed
 * 4. Each tenant's login page will show their branding
 *
 * TESTING:
 *
 * 1. Create tenant without branding:
 *    POST /tenants { "id": "test1", "name": "Test 1" }
 *    -> Will use DEFAULT_PLATFORM_THEME
 *
 * 2. Create tenant with branding:
 *    POST /tenants { "id": "test2", "name": "Test 2", "branding": {...} }
 *    -> Will use custom branding
 *
 * 3. Navigate to each tenant:
 *    - https://test1.auth.example.com/authorize -> Platform theme
 *    - https://test2.auth.example.com/authorize -> Custom theme
 */
