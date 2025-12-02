/**
 * OpenAuth Issuer with Theming - Cloudflare Workers Example
 *
 * This example demonstrates how to customize the appearance of OpenAuth's
 * built-in UI using themes. Themes control the visual styling of login pages,
 * code verification screens, and other UI elements.
 *
 * You can use built-in themes or create your own custom theme.
 */

import { issuer } from "@openauthjs/openauth"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"
import {
  type ExecutionContext,
  type KVNamespace,
} from "@cloudflare/workers-types"
import { subjects } from "../../subjects.js"
import { PasswordProvider } from "@openauthjs/openauth/provider/password"
import { PasswordUI } from "@openauthjs/openauth/ui/password"

// Import built-in themes
import {
  THEME_SST,
  THEME_VERCEL,
  THEME_SUPABASE,
  THEME_TERMINAL,
  THEME_OPENAUTH,
  type Theme,
} from "@openauthjs/openauth/ui/theme"

interface Env {
  CloudflareAuthKV: KVNamespace
}

// ============================================================================
// CUSTOM THEME EXAMPLE
// ============================================================================

/**
 * Define a custom theme with all available options.
 * All properties except `primary` are optional.
 */
const MY_CUSTOM_THEME: Theme = {
  /**
   * The name of your app. Used as the page title and displayed in the UI.
   */
  title: "My App",

  /**
   * URL to your favicon. Displayed in the browser tab.
   */
  favicon: "https://example.com/favicon.svg",

  /**
   * URL to your logo. Displayed at the top of the login page.
   *
   * Can be a single URL for both light and dark modes:
   *   logo: "https://example.com/logo.svg"
   *
   * Or separate URLs for light and dark modes:
   */
  logo: {
    light: "https://example.com/logo-dark.svg", // Shown on light backgrounds
    dark: "https://example.com/logo-light.svg", // Shown on dark backgrounds
  },

  /**
   * Primary color for buttons, links, and accents.
   *
   * Can be a single color for both modes:
   *   primary: "#3B82F6"
   *
   * Or different colors for light and dark modes:
   */
  primary: {
    light: "#2563EB", // Darker blue for light mode (better contrast)
    dark: "#60A5FA", // Lighter blue for dark mode (better contrast)
  },

  /**
   * Background color of the page.
   *
   * Can be a single color or separate light/dark values.
   */
  background: {
    light: "#FFFFFF",
    dark: "#0F172A",
  },

  /**
   * Border radius for UI elements like buttons and inputs.
   * Options: "none" | "sm" | "md" | "lg" | "full"
   *
   * - "none": Sharp corners (0px)
   * - "sm": Small radius
   * - "md": Medium radius (default)
   * - "lg": Large radius
   * - "full": Fully rounded (pill shape for buttons)
   */
  radius: "md",

  /**
   * Font configuration.
   */
  font: {
    /**
     * Font family to use. Include fallback fonts.
     * Make sure to import the font via the `css` property if using a web font.
     */
    family: "Inter, system-ui, sans-serif",

    /**
     * Scale factor for font sizes. Default is "1".
     * Use "1.1" or "1.25" to increase, "0.9" to decrease.
     */
    scale: "1",
  },

  /**
   * Custom CSS added to the page in a <style> tag.
   * Commonly used to import web fonts or add custom styles.
   */
  css: `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    /* You can add any custom CSS here */
    .custom-class {
      /* Custom styles */
    }
  `,
}

// ============================================================================
// MINIMAL CUSTOM THEME
// ============================================================================

/**
 * A minimal theme - only `primary` is required.
 * All other properties will use sensible defaults.
 */
const MINIMAL_THEME: Theme = {
  primary: "#10B981", // Emerald green
}

// ============================================================================
// SIMPLE BRAND THEME
// ============================================================================

/**
 * A simple branded theme with just the essentials.
 */
const SIMPLE_BRAND_THEME: Theme = {
  title: "Acme Corp",
  primary: "#7C3AED", // Purple
  logo: "https://example.com/acme-logo.svg",
  radius: "lg",
}

// ============================================================================
// HELPER FUNCTION
// ============================================================================

async function getUser(email: string) {
  // In a real app, look up the user in your database
  return "123"
}

// ============================================================================
// ISSUER WITH THEMING
// ============================================================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return issuer({
      storage: CloudflareStorage({
        namespace: env.CloudflareAuthKV,
      }),

      // ========================================
      // THEME CONFIGURATION
      // ========================================
      // Choose one of the following options:

      // Option 1: Use a built-in theme
      // theme: THEME_SST,
      // theme: THEME_VERCEL,
      // theme: THEME_SUPABASE,
      // theme: THEME_TERMINAL,
      // theme: THEME_OPENAUTH,  // Default theme

      // Option 2: Use a custom theme
      theme: MY_CUSTOM_THEME,

      // Option 3: Use minimal theme
      // theme: MINIMAL_THEME,

      // Option 4: Use simple brand theme
      // theme: SIMPLE_BRAND_THEME,

      // Option 5: Inline theme definition
      // theme: {
      //   title: "Quick Setup",
      //   primary: "#FF5722",
      //   radius: "sm",
      // },

      subjects,
      providers: {
        password: PasswordProvider(
          PasswordUI({
            sendCode: async (email, code) => {
              console.log(`Send code ${code} to ${email}`)
            },
          }),
        ),
      },
      success: async (ctx, value) => {
        if (value.provider === "password") {
          return ctx.subject("user", {
            id: await getUser(value.email),
          })
        }
        throw new Error("Invalid provider")
      },
    }).fetch(request, env, ctx)
  },
}

// ============================================================================
// BUILT-IN THEMES REFERENCE
// ============================================================================
//
// THEME_OPENAUTH (Default):
//   - Minimal black and white design
//   - IBM Plex Sans font
//   - Sharp corners (radius: "none")
//
// THEME_SST:
//   - Orange primary color (#f3663f)
//   - Rubik font
//   - Dark purple background in dark mode
//
// THEME_VERCEL:
//   - Black and white monochrome
//   - Geist font
//   - Clean, minimal aesthetic
//
// THEME_SUPABASE:
//   - Green primary color (#72e3ad light, #006239 dark)
//   - Varela Round font
//   - Subtle gray backgrounds
//
// THEME_TERMINAL:
//   - Orange primary color (#ff5e00)
//   - Geist Mono font (monospace)
//   - Sharp corners (radius: "none")
//
// ============================================================================
