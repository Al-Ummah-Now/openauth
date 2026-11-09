/**
 * Theme Resolution Tests
 *
 * Tests for the unified theming system that supports both regular issuer
 * and multi-tenant issuer with proper theme resolution and precedence.
 *
 * Test Coverage:
 * - resolveTheme(): the render's own theme, else the built-in default
 * - Default tenant cache (mocked TenantService)
 */

import { expect, test, describe, beforeEach, afterEach, mock } from "bun:test"
import {
  resolveTheme,
  THEME_OPENAUTH,
  THEME_SST,
  THEME_TERMINAL,
  type Theme,
} from "../src/ui/theme.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { TenantServiceImpl } from "../src/tenant/service.js"

// ============================================
// TEST SETUP
// ============================================

// Custom test themes
const THEME_CUSTOM: Theme = {
  title: "Custom App",
  primary: "#ff0000",
  background: {
    dark: "#000000",
    light: "#ffffff",
  },
  font: {
    family: "Arial, sans-serif",
    scale: "1.1",
  },
}

const THEME_TENANT: Theme = {
  title: "Tenant Brand",
  primary: "#00ff00",
  logo: {
    dark: "https://tenant.com/logo-dark.png",
    light: "https://tenant.com/logo-light.png",
  },
}

// ============================================
// THEME RESOLUTION TESTS
// ============================================

describe("Theme Resolution - resolveTheme() function", () => {
  test("returns the theme passed to this render", () => {
    expect(resolveTheme(THEME_SST)).toBe(THEME_SST)
    expect(resolveTheme(THEME_CUSTOM).title).toBe("Custom App")
  })

  test("falls back to the built-in default, never a global", () => {
    // @ts-ignore a stale global from an old version must be ignored
    globalThis.OPENAUTH_THEME = THEME_SST
    try {
      expect(resolveTheme()).toBe(THEME_OPENAUTH)
      expect(resolveTheme(undefined)).toBe(THEME_OPENAUTH)
    } finally {
      // @ts-ignore
      delete globalThis.OPENAUTH_THEME
    }
  })

  test("each render resolves its own theme independently", () => {
    expect(resolveTheme(THEME_TERMINAL).title).toBe("terminal")
    expect(resolveTheme(THEME_CUSTOM).title).toBe("Custom App")
    expect(resolveTheme().title).toBe("OpenAuth")
  })
})

describe("Theme Resolution - Built-in Themes", () => {
  test("THEME_OPENAUTH has correct structure", () => {
    expect(THEME_OPENAUTH.title).toBe("OpenAuth")
    expect(THEME_OPENAUTH.radius).toBe("none")
    expect(THEME_OPENAUTH.primary).toBeDefined()
    expect(THEME_OPENAUTH.background).toBeDefined()
    expect(THEME_OPENAUTH.font?.family).toContain("IBM Plex Sans")
    expect(THEME_OPENAUTH.css).toContain("@import")
  })

  test("THEME_SST has correct structure", () => {
    expect(THEME_SST.title).toBe("SST")
    expect(THEME_SST.primary).toBe("#f3663f")
    expect(THEME_SST.favicon).toContain("sst.dev")
    expect(THEME_SST.logo).toBeDefined()
    expect(THEME_SST.font?.family).toContain("Rubik")
  })

  test("THEME_TERMINAL has correct structure", () => {
    expect(THEME_TERMINAL.title).toBe("terminal")
    expect(THEME_TERMINAL.primary).toBe("#ff5e00")
    expect(THEME_TERMINAL.radius).toBe("none")
    expect(THEME_TERMINAL.font?.family).toContain("Geist Mono")
  })

  test("All built-in themes have required primary color", () => {
    expect(THEME_OPENAUTH.primary).toBeDefined()
    expect(THEME_SST.primary).toBeDefined()
    expect(THEME_TERMINAL.primary).toBeDefined()
  })
})

// ============================================
// DEFAULT TENANT CACHE TESTS
// ============================================

describe("Default Tenant Cache - TenantService Integration", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let tenantService: TenantServiceImpl

  beforeEach(() => {
    storage = MemoryStorage()
    tenantService = new TenantServiceImpl(storage)
  })

  test("fetches default tenant on first call", async () => {
    // Create a default tenant with branding
    const defaultTenant = await tenantService.createTenant({
      id: "default",
      name: "Default Tenant",
      branding: {
        theme: {
          primary: "#007bff",
          secondary: "#6c757d",
        },
        logoLight: "https://default.com/logo-light.png",
      },
    })

    expect(defaultTenant.id).toBe("default")
    expect(defaultTenant.branding?.theme?.primary).toBe("#007bff")

    // Verify we can retrieve it
    const retrieved = await tenantService.getTenant("default")
    expect(retrieved).toBeDefined()
    expect(retrieved?.branding?.theme?.primary).toBe("#007bff")
  })

  test("returns cached value on subsequent calls", async () => {
    // Create default tenant
    await tenantService.createTenant({
      id: "default",
      name: "Default Tenant",
      branding: {
        theme: {
          primary: "#007bff",
        },
      },
    })

    // First call
    const firstCall = await tenantService.getTenant("default")
    expect(firstCall?.branding?.theme?.primary).toBe("#007bff")

    // Subsequent calls should return the same data
    for (let i = 0; i < 5; i++) {
      const cachedCall = await tenantService.getTenant("default")
      expect(cachedCall?.branding?.theme?.primary).toBe("#007bff")
    }
  })

  test("returns null if default tenant not found", async () => {
    // Don't create a default tenant

    const result = await tenantService.getTenant("default")

    expect(result).toBeNull()
  })

  test("default tenant cache with different branding properties", async () => {
    await tenantService.createTenant({
      id: "default",
      name: "Default Tenant",
      branding: {
        theme: {
          primary: "#ff0000",
          secondary: "#00ff00",
          background: "#ffffff",
          text: "#000000",
          fontFamily: "Arial, sans-serif",
        },
        logoLight: "https://default.com/logo-light.png",
        logoDark: "https://default.com/logo-dark.png",
        favicon: "https://default.com/favicon.ico",
        customCss: "body { margin: 0; }",
      },
    })

    const tenant = await tenantService.getTenant("default")

    expect(tenant?.branding?.theme?.primary).toBe("#ff0000")
    expect(tenant?.branding?.theme?.secondary).toBe("#00ff00")
    expect(tenant?.branding?.theme?.background).toBe("#ffffff")
    expect(tenant?.branding?.theme?.text).toBe("#000000")
    expect(tenant?.branding?.theme?.fontFamily).toBe("Arial, sans-serif")
    expect(tenant?.branding?.logoLight).toBe(
      "https://default.com/logo-light.png",
    )
    expect(tenant?.branding?.logoDark).toBe("https://default.com/logo-dark.png")
    expect(tenant?.branding?.favicon).toBe("https://default.com/favicon.ico")
    expect(tenant?.branding?.customCss).toBe("body { margin: 0; }")
  })

  test("cache updates when default tenant is modified", async () => {
    // Create default tenant
    await tenantService.createTenant({
      id: "default",
      name: "Default Tenant",
      branding: {
        theme: {
          primary: "#007bff",
        },
      },
    })

    // Verify initial state
    let tenant = await tenantService.getTenant("default")
    expect(tenant?.branding?.theme?.primary).toBe("#007bff")

    // Update default tenant
    await tenantService.updateTenant("default", {
      branding: {
        theme: {
          primary: "#ff0000",
        },
      },
    })

    // Verify updated state
    tenant = await tenantService.getTenant("default")
    expect(tenant?.branding?.theme?.primary).toBe("#ff0000")
  })
})

describe("Default Tenant Cache - Theme Resolution Integration", () => {
  let tenantService: TenantServiceImpl

  beforeEach(() => {
    tenantService = new TenantServiceImpl(MemoryStorage())
  })

  test("a tenant's branding theme is used when passed to the render", async () => {
    await tenantService.createTenant({
      id: "default",
      name: "Default Tenant",
      branding: { theme: { primary: "#007bff", secondary: "#6c757d" } },
    })
    const tenant = await tenantService.getTenant("default")
    const resolved = resolveTheme(tenant?.branding?.theme as Theme)
    expect(resolved.primary).toBe("#007bff")
    expect(resolved.secondary).toBe("#6c757d")
  })

  test("a tenant's theme never leaks into a render that wasn't given it", async () => {
    await tenantService.createTenant({
      id: "default",
      name: "Default Tenant",
      branding: { theme: { primary: "#0000ff" } },
    })
    const tenant = await tenantService.getTenant("default")
    expect(resolveTheme(tenant?.branding?.theme as Theme).primary).toBe(
      "#0000ff",
    )
    expect(resolveTheme()).toBe(THEME_OPENAUTH)
    expect(resolveTheme(THEME_TERMINAL).primary).toBe("#ff5e00")
  })
})

describe("Theme Resolution - Edge Cases", () => {
  test("handles a minimal theme object", () => {
    const resolved = resolveTheme({ primary: "#000000" })
    expect(resolved.primary).toBe("#000000")
    expect(resolved.title).toBeUndefined()
  })

  test("handles theme with ColorScheme objects", () => {
    const resolved = resolveTheme({
      title: "Scheme Test",
      primary: { light: "#ffffff", dark: "#000000" },
      background: { light: "#f0f0f0", dark: "#1a1a1a" },
    })
    expect((resolved.primary as any).light).toBe("#ffffff")
    expect((resolved.primary as any).dark).toBe("#000000")
  })

  test("handles theme with font configuration and custom CSS", () => {
    const resolved = resolveTheme({
      primary: "#007bff",
      font: { family: "Helvetica, Arial, sans-serif", scale: "1.25" },
      css: "@import url('https://fonts.googleapis.com/css2?family=Roboto');",
    })
    expect(resolved.font?.family).toBe("Helvetica, Arial, sans-serif")
    expect(resolved.font?.scale).toBe("1.25")
    expect(resolved.css).toContain("@import")
  })
})
