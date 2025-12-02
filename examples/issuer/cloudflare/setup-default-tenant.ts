/**
 * Setup Default Tenant for Fallback Theming
 *
 * This script demonstrates how to create a "default" tenant that provides
 * fallback branding/theming when no explicit theme is configured in the issuer.
 *
 * ## How Default Tenant Theming Works
 *
 * OpenAuth supports database-driven default branding through a special tenant
 * with ID = "default". Here's the priority chain for theme resolution:
 *
 * 1. **config.theme** (highest priority)
 *    - Theme passed directly to the issuer configuration
 *    - Example: `issuer({ theme: THEME_SST, ... })`
 *
 * 2. **Default Tenant Theme** (fallback)
 *    - If no config.theme is provided, OpenAuth looks for a tenant with ID "default"
 *    - The default tenant's branding.theme is used as the fallback
 *    - This allows changing the default theme without code changes
 *
 * 3. **Built-in OpenAuth Theme** (last resort)
 *    - If neither config.theme nor default tenant theme exists
 *    - Uses THEME_OPENAUTH (black/white minimal theme)
 *
 * ## Benefits of Database-Driven Default Theme
 *
 * - Change branding without code deployments
 * - A/B test different themes
 * - Allow admin users to configure default branding via API
 * - Graceful fallback if database is unavailable
 *
 * ## Cache Behavior
 *
 * The default tenant is cached for 1 hour to minimize database lookups.
 * Cache is automatically invalidated when the default tenant is updated
 * via the Tenant API.
 *
 * @packageDocumentation
 */

import type {
  Tenant,
  TenantBranding,
  TenantSettings,
  TenantService,
  Theme,
} from "@openauthjs/openauth/tenant"
import { createTenantService } from "@openauthjs/openauth/tenant"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"
import type { ColorScheme } from "@openauthjs/openauth/ui/theme"
import type { KVNamespace, D1Database } from "@cloudflare/workers-types"

// ============================================
// CONSTANTS
// ============================================

/**
 * The special ID used to identify the default tenant.
 * This must match DEFAULT_TENANT_ID in default-tenant-cache.ts
 */
const DEFAULT_TENANT_ID = "default"

/**
 * Your OpenAuth issuer base URL
 * Replace with your actual deployment URL
 */
const ISSUER_BASE_URL = "https://auth.example.com"

// ============================================
// EXAMPLE BRANDING CONFIGURATION
// ============================================

/**
 * Complete example of TenantBranding with all available properties.
 *
 * This branding will be used as the default theme for all UI pages
 * when no config.theme is explicitly provided.
 */
const exampleBranding: TenantBranding = {
  /**
   * Theme configuration for the login/auth UI pages.
   *
   * This partial Theme is merged with the base theme.
   * You can override any or all properties.
   */
  theme: {
    /**
     * Title shown on the browser tab and login page header.
     */
    title: "My App",

    /**
     * Primary brand color.
     * Used for buttons, links, and interactive elements.
     *
     * Can be a single color or light/dark mode variants:
     * - Single: "#007bff"
     * - Light/Dark: { light: "#007bff", dark: "#4dabf7" }
     */
    primary: {
      light: "#2563eb", // Blue for light mode
      dark: "#60a5fa", // Lighter blue for dark mode
    } as string | ColorScheme,

    /**
     * Background color for the login page.
     *
     * Can be a single color or light/dark mode variants.
     */
    background: {
      light: "#ffffff",
      dark: "#0f172a", // Dark slate
    } as string | ColorScheme,

    /**
     * Logo displayed on the login page.
     *
     * Can be a single URL or light/dark mode variants.
     * Recommended size: 200x50 pixels or similar aspect ratio.
     */
    logo: {
      light: "https://cdn.example.com/logo-dark.svg", // Dark logo for light bg
      dark: "https://cdn.example.com/logo-light.svg", // Light logo for dark bg
    } as string | ColorScheme,

    /**
     * Border radius style for UI elements.
     * Options: "none", "sm", "md", "lg", "full"
     */
    radius: "md",

    /**
     * Favicon URL.
     * Shown in browser tabs. Recommended: SVG or 32x32 PNG.
     */
    favicon: "https://cdn.example.com/favicon.svg",

    /**
     * Font configuration.
     */
    font: {
      /**
       * Font family for all text.
       * Must include fallback fonts.
       * Import custom fonts via the css property below.
       */
      family: "Inter, system-ui, sans-serif",

      /**
       * Font scale multiplier.
       * "1" is default, "1.1" is 10% larger, "0.9" is 10% smaller.
       */
      scale: "1",
    },

    /**
     * Custom CSS injected into the page.
     * Use for importing custom fonts or additional styling.
     */
    css: `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

      /* Custom styling for login form */
      .login-form {
        box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
      }

      /* Customize input fields */
      input[type="email"],
      input[type="password"] {
        border-color: #e2e8f0;
      }

      input[type="email"]:focus,
      input[type="password"]:focus {
        border-color: #2563eb;
        outline-color: #2563eb;
      }
    `,
  },

  /**
   * Light mode logo URL.
   * Alternative to theme.logo for separate control.
   */
  logoLight: "https://cdn.example.com/logo-for-light-bg.svg",

  /**
   * Dark mode logo URL.
   * Alternative to theme.logo for separate control.
   */
  logoDark: "https://cdn.example.com/logo-for-dark-bg.svg",

  /**
   * Favicon URL.
   * Alternative to theme.favicon for separate control.
   */
  favicon: "https://cdn.example.com/favicon.ico",

  /**
   * Additional custom CSS.
   * This is merged with theme.css if both are provided.
   */
  customCss: `
    /* Page-wide customizations */
    body {
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* Footer customization */
    .auth-footer {
      opacity: 0.7;
    }

    /* Social login button styling */
    .social-login-button {
      transition: transform 0.2s ease;
    }
    .social-login-button:hover {
      transform: translateY(-1px);
    }
  `,

  /**
   * Email template configuration.
   * Template IDs or content for transactional emails.
   */
  emailTemplates: {
    /**
     * Welcome email sent after registration.
     */
    welcome: "template-welcome-v1",

    /**
     * Email verification code template.
     */
    verification: "template-verify-v1",

    /**
     * Password reset template.
     */
    passwordReset: "template-reset-v1",

    /**
     * Magic link login template.
     */
    magicLink: "template-magic-v1",
  },
}

/**
 * Example tenant settings for the default tenant.
 * These are optional but shown for completeness.
 */
const exampleSettings: TenantSettings = {
  /**
   * Maximum accounts per browser session.
   * Allows users to be logged in with multiple accounts.
   */
  maxAccountsPerSession: 3,

  /**
   * Session lifetime in seconds.
   * Default: 7 days (604800 seconds)
   */
  sessionLifetime: 7 * 24 * 60 * 60,

  /**
   * Allow new user registration.
   * Set to false to only allow admin-created accounts.
   */
  allowPublicRegistration: true,

  /**
   * Require email verification before login.
   */
  requireEmailVerification: true,

  /**
   * List of allowed OAuth providers.
   * Empty array means all configured providers are allowed.
   */
  allowedProviders: ["password", "google", "github"],

  /**
   * Require multi-factor authentication.
   */
  mfaRequired: false,
}

// ============================================
// METHOD 1: CURL COMMANDS
// ============================================

/**
 * Create the default tenant using curl.
 *
 * Run these commands in your terminal to set up the default tenant.
 */
const curlCommands = `
# ============================================
# CREATE DEFAULT TENANT (Method 1: Full create)
# ============================================
# Use this if the default tenant doesn't exist yet

curl -X POST "${ISSUER_BASE_URL}/api/tenants" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \\
  -d '{
    "id": "default",
    "name": "Default Tenant",
    "branding": {
      "theme": {
        "title": "My App",
        "primary": { "light": "#2563eb", "dark": "#60a5fa" },
        "background": { "light": "#ffffff", "dark": "#0f172a" },
        "logo": {
          "light": "https://cdn.example.com/logo-dark.svg",
          "dark": "https://cdn.example.com/logo-light.svg"
        },
        "radius": "md",
        "favicon": "https://cdn.example.com/favicon.svg",
        "font": {
          "family": "Inter, system-ui, sans-serif",
          "scale": "1"
        },
        "css": "@import url('"'"'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'"'"');"
      },
      "logoLight": "https://cdn.example.com/logo-for-light-bg.svg",
      "logoDark": "https://cdn.example.com/logo-for-dark-bg.svg",
      "favicon": "https://cdn.example.com/favicon.ico",
      "customCss": "body { -webkit-font-smoothing: antialiased; }"
    },
    "settings": {
      "allowPublicRegistration": true,
      "requireEmailVerification": true
    }
  }'

# ============================================
# UPDATE DEFAULT TENANT BRANDING ONLY
# ============================================
# Use this to update just the branding without affecting other settings

curl -X PUT "${ISSUER_BASE_URL}/api/tenants/default/branding" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \\
  -d '{
    "theme": {
      "title": "Updated App Name",
      "primary": "#dc2626",
      "background": { "light": "#fef2f2", "dark": "#1f2937" },
      "logo": "https://cdn.example.com/new-logo.svg",
      "radius": "lg",
      "favicon": "https://cdn.example.com/new-favicon.svg"
    },
    "customCss": ".login-button { font-weight: 600; }"
  }'

# ============================================
# GET CURRENT DEFAULT TENANT
# ============================================
# Check if default tenant exists and view current configuration

curl -X GET "${ISSUER_BASE_URL}/api/tenants/default" \\
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"

# ============================================
# DELETE DEFAULT TENANT
# ============================================
# Remove default tenant (will fall back to built-in theme)
# Note: This is a soft delete, setting status to 'deleted'

curl -X DELETE "${ISSUER_BASE_URL}/api/tenants/default" \\
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
`

console.log("=== CURL COMMANDS ===")
console.log(curlCommands)

// ============================================
// METHOD 2: TYPESCRIPT PROGRAMMATIC SETUP
// ============================================

/**
 * Programmatically create the default tenant.
 *
 * Use this approach when:
 * - Running as part of a deployment script
 * - Integrating with your CI/CD pipeline
 * - Creating admin tooling
 */
async function setupDefaultTenant(options: {
  issuerBaseUrl: string
  adminToken: string
}): Promise<Tenant> {
  const { issuerBaseUrl, adminToken } = options

  // First, check if default tenant already exists
  const checkResponse = await fetch(
    `${issuerBaseUrl}/api/tenants/${DEFAULT_TENANT_ID}`,
    {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    },
  )

  if (checkResponse.ok) {
    const existingTenant = (await checkResponse.json()) as Tenant
    console.log("Default tenant already exists:", existingTenant.id)

    // Optionally update the branding
    const updateResponse = await fetch(
      `${issuerBaseUrl}/api/tenants/${DEFAULT_TENANT_ID}/branding`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(exampleBranding),
      },
    )

    if (!updateResponse.ok) {
      const error = await updateResponse.json()
      throw new Error(`Failed to update default tenant: ${error.error_description}`)
    }

    console.log("Default tenant branding updated successfully")
    return (await updateResponse.json()) as Tenant
  }

  // Create the default tenant
  const createResponse = await fetch(`${issuerBaseUrl}/api/tenants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      id: DEFAULT_TENANT_ID,
      name: "Default Tenant",
      branding: exampleBranding,
      settings: exampleSettings,
    }),
  })

  if (!createResponse.ok) {
    const error = await createResponse.json()
    throw new Error(`Failed to create default tenant: ${error.error_description}`)
  }

  const tenant = (await createResponse.json()) as Tenant
  console.log("Default tenant created successfully:", tenant.id)
  return tenant
}

// ============================================
// METHOD 3: DIRECT SERVICE USAGE (Within Worker)
// ============================================

/**
 * Create default tenant directly using TenantService.
 *
 * Use this approach when:
 * - Running inside a Cloudflare Worker
 * - Part of your issuer initialization
 * - Seeding data during development
 */
async function setupDefaultTenantDirect(
  tenantService: TenantService,
): Promise<Tenant> {
  // Check if default tenant exists
  const existingTenant = await tenantService.getTenant(DEFAULT_TENANT_ID)

  if (existingTenant) {
    console.log("Default tenant exists, updating branding...")
    return await tenantService.updateTenant(DEFAULT_TENANT_ID, {
      branding: exampleBranding,
    })
  }

  // Create new default tenant
  console.log("Creating default tenant...")
  return await tenantService.createTenant({
    id: DEFAULT_TENANT_ID,
    name: "Default Tenant",
    branding: exampleBranding,
    settings: exampleSettings,
  })
}

// ============================================
// CLOUDFLARE WORKER EXAMPLE
// ============================================

/**
 * Example Cloudflare Worker that sets up the default tenant on first request.
 *
 * This pattern uses a one-time initialization check.
 */

interface Env {
  AUTH_KV: KVNamespace
  // Optional: D1 Database for more efficient tenant listing
  AUTH_DB?: D1Database
  // Flag to enable setup mode (set via wrangler secret)
  ENABLE_DEFAULT_TENANT_SETUP?: string
}

/**
 * One-time setup handler.
 *
 * Call this endpoint once after deployment:
 * POST /setup/default-tenant
 */
async function handleSetupRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  // Security check: Only allow setup if explicitly enabled
  if (env.ENABLE_DEFAULT_TENANT_SETUP !== "true") {
    return new Response(
      JSON.stringify({
        error: "forbidden",
        error_description: "Setup mode is not enabled",
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  // Only allow POST
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "method_not_allowed",
        error_description: "Use POST method",
      }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  try {
    // Initialize services
    const storage = CloudflareStorage({ namespace: env.AUTH_KV })
    const tenantService = createTenantService(storage, env.AUTH_DB)

    // Create or update default tenant
    const tenant = await setupDefaultTenantDirect(tenantService)

    return new Response(
      JSON.stringify({
        success: true,
        message: "Default tenant configured successfully",
        tenant: {
          id: tenant.id,
          name: tenant.name,
          status: tenant.status,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )
  } catch (error) {
    console.error("Failed to setup default tenant:", error)
    return new Response(
      JSON.stringify({
        error: "setup_failed",
        error_description:
          error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    )
  }
}

// ============================================
// THEME CONFIGURATION EXAMPLES
// ============================================

/**
 * Example: Dark theme for tech/developer products
 */
const darkTechTheme: TenantBranding = {
  theme: {
    title: "DevAuth",
    primary: "#22c55e", // Green accent
    background: {
      light: "#18181b",
      dark: "#09090b",
    },
    logo: "https://cdn.example.com/dev-logo.svg",
    radius: "sm",
    font: {
      family: "JetBrains Mono, monospace",
    },
    css: "@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap');",
  },
}

/**
 * Example: Minimal corporate theme
 */
const corporateTheme: TenantBranding = {
  theme: {
    title: "Enterprise Login",
    primary: "#1e40af", // Professional blue
    background: {
      light: "#f8fafc",
      dark: "#1e293b",
    },
    radius: "none",
    font: {
      family: "system-ui, -apple-system, sans-serif",
    },
  },
  customCss: `
    /* Clean corporate styling */
    .auth-container {
      max-width: 400px;
    }
    .auth-form {
      border: 1px solid #e2e8f0;
    }
  `,
}

/**
 * Example: Playful consumer app theme
 */
const consumerTheme: TenantBranding = {
  theme: {
    title: "Welcome Back!",
    primary: {
      light: "#ec4899", // Pink
      dark: "#f472b6",
    },
    background: {
      light: "#fdf4ff", // Light pink tint
      dark: "#1f1235", // Dark purple
    },
    radius: "full",
    font: {
      family: "Poppins, sans-serif",
      scale: "1.05",
    },
    css: "@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');",
  },
  customCss: `
    .login-button {
      background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%);
      border: none;
    }
    .login-button:hover {
      opacity: 0.9;
    }
  `,
}

// ============================================
// EXPORTS
// ============================================

export {
  DEFAULT_TENANT_ID,
  exampleBranding,
  exampleSettings,
  setupDefaultTenant,
  setupDefaultTenantDirect,
  handleSetupRequest,
  darkTechTheme,
  corporateTheme,
  consumerTheme,
}

/**
 * USAGE SUMMARY:
 *
 * 1. Via curl (one-time setup):
 *    Copy and run the curl commands above with your actual values.
 *
 * 2. Via TypeScript (deployment script):
 *    ```typescript
 *    import { setupDefaultTenant } from './setup-default-tenant'
 *
 *    await setupDefaultTenant({
 *      issuerBaseUrl: 'https://auth.example.com',
 *      adminToken: process.env.ADMIN_TOKEN,
 *    })
 *    ```
 *
 * 3. Via Worker endpoint (POST /setup/default-tenant):
 *    Set ENABLE_DEFAULT_TENANT_SETUP=true in wrangler secrets
 *    Call the endpoint once after deployment
 *    Remember to disable after setup: wrangler secret delete ENABLE_DEFAULT_TENANT_SETUP
 *
 * 4. Direct service usage (within your issuer):
 *    ```typescript
 *    import { setupDefaultTenantDirect } from './setup-default-tenant'
 *
 *    const tenant = await setupDefaultTenantDirect(tenantService)
 *    ```
 *
 * CACHE INVALIDATION:
 *
 * The default tenant theme is cached for 1 hour. After updating:
 * - Cache automatically invalidates after TTL expires
 * - For immediate effect, restart workers or call invalidateDefaultTenantCache()
 *
 * ```typescript
 * import { invalidateDefaultTenantCache } from '@openauthjs/openauth/enterprise/default-tenant-cache'
 *
 * // After updating default tenant
 * await tenantService.updateTenant('default', { branding: newBranding })
 * invalidateDefaultTenantCache() // Clear cache immediately
 * ```
 */
