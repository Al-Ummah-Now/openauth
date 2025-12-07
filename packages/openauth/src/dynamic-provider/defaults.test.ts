import { describe, test, expect } from "bun:test"
import {
  PROVIDER_DEFAULTS,
  PROVIDER_CATEGORIES,
  PROVIDER_DISPLAY_NAMES,
  OIDC_CAPABLE_PROVIDERS,
  PKCE_REQUIRED_PROVIDERS,
  NO_SECRET_REQUIRED_PROVIDERS,
  getDefaultScopes,
  requiresPKCE,
  requiresClientSecret,
  getProviderCategory,
  getProviderDisplayName,
  interpolateEndpoint,
} from "./defaults.js"
import type { ProviderType } from "./types.js"

describe("PROVIDER_DEFAULTS", () => {
  test("contains entries for all provider types", () => {
    const expectedProviders = [
      "google",
      "github",
      "facebook",
      "twitter",
      "x",
      "apple",
      "microsoft",
      "linkedin",
      "discord",
      "slack",
      "spotify",
      "twitch",
      "cognito",
      "keycloak",
      "jumpcloud",
      "yahoo",
    ]

    for (const provider of expectedProviders) {
      expect(PROVIDER_DEFAULTS).toHaveProperty(provider)
    }
  })

  test("each provider has required endpoint fields", () => {
    for (const [provider, config] of Object.entries(PROVIDER_DEFAULTS)) {
      expect(config.endpoints).toBeDefined()
      expect(config.endpoints.authorization).toBeDefined()
      expect(config.endpoints.token).toBeDefined()
      expect(typeof config.endpoints.authorization).toBe("string")
      expect(typeof config.endpoints.token).toBe("string")
    }
  })

  test("each provider has defaultScopes array", () => {
    for (const [provider, config] of Object.entries(PROVIDER_DEFAULTS)) {
      expect(Array.isArray(config.defaultScopes)).toBe(true)
    }
  })

  test("google provider has correct configuration", () => {
    const google = PROVIDER_DEFAULTS.google
    expect(google.endpoints.authorization).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    )
    expect(google.endpoints.token).toBe("https://oauth2.googleapis.com/token")
    expect(google.endpoints.jwks).toBe(
      "https://www.googleapis.com/oauth2/v3/certs",
    )
    expect(google.endpoints.userinfo).toBe(
      "https://www.googleapis.com/oauth2/v3/userinfo",
    )
    expect(google.defaultScopes).toEqual(["openid", "email", "profile"])
    expect(google.issuer).toBe("https://accounts.google.com")
  })

  test("github provider has correct configuration", () => {
    const github = PROVIDER_DEFAULTS.github
    expect(github.endpoints.authorization).toBe(
      "https://github.com/login/oauth/authorize",
    )
    expect(github.endpoints.token).toBe(
      "https://github.com/login/oauth/access_token",
    )
    expect(github.endpoints.userinfo).toBe("https://api.github.com/user")
    expect(github.defaultScopes).toEqual(["user:email"])
  })

  test("twitter provider requires PKCE", () => {
    const twitter = PROVIDER_DEFAULTS.twitter
    expect(twitter.pkce).toBe(true)
  })

  test("x provider requires PKCE", () => {
    const x = PROVIDER_DEFAULTS.x
    expect(x.pkce).toBe(true)
  })

  test("OIDC providers have issuer field", () => {
    const oidcProviders = ["google", "apple", "microsoft"]

    for (const provider of oidcProviders) {
      const config = PROVIDER_DEFAULTS[provider]
      expect(config.issuer).toBeDefined()
      expect(typeof config.issuer).toBe("string")
    }
  })

  test("microsoft provider has tenant placeholder", () => {
    const microsoft = PROVIDER_DEFAULTS.microsoft
    expect(microsoft.endpoints.authorization).toContain("{tenant}")
    expect(microsoft.endpoints.token).toContain("{tenant}")
    expect(microsoft.endpoints.jwks).toContain("{tenant}")
    expect(microsoft.issuer).toContain("{tenant}")
  })

  test("cognito provider has domain and region placeholders", () => {
    const cognito = PROVIDER_DEFAULTS.cognito
    expect(cognito.endpoints.authorization).toContain("{domain}")
    expect(cognito.endpoints.authorization).toContain("{region}")
  })

  test("keycloak provider has baseUrl and realm placeholders", () => {
    const keycloak = PROVIDER_DEFAULTS.keycloak
    expect(keycloak.endpoints.authorization).toContain("{baseUrl}")
    expect(keycloak.endpoints.authorization).toContain("{realm}")
  })

  test("all endpoint URLs are valid HTTPS URLs or templates", () => {
    for (const [provider, config] of Object.entries(PROVIDER_DEFAULTS)) {
      const { authorization, token } = config.endpoints

      // Either valid HTTPS URL or contains template variables
      expect(
        authorization.startsWith("https://") || authorization.includes("{"),
      ).toBe(true)
      expect(token.startsWith("https://") || token.includes("{")).toBe(true)
    }
  })

  test("default scopes are non-empty strings", () => {
    for (const [provider, config] of Object.entries(PROVIDER_DEFAULTS)) {
      for (const scope of config.defaultScopes) {
        expect(typeof scope).toBe("string")
        expect(scope.length).toBeGreaterThan(0)
      }
    }
  })
})

describe("PROVIDER_CATEGORIES", () => {
  test("categorizes all known providers", () => {
    const allProviders = [
      "google",
      "github",
      "facebook",
      "twitter",
      "x",
      "apple",
      "linkedin",
      "discord",
      "slack",
      "spotify",
      "twitch",
      "yahoo",
      "microsoft",
      "cognito",
      "keycloak",
      "jumpcloud",
      "oidc",
      "custom_oauth2",
      "password",
      "code",
    ]

    for (const provider of allProviders) {
      expect(PROVIDER_CATEGORIES).toHaveProperty(provider)
    }
  })

  test("social providers are categorized correctly", () => {
    const socialProviders = [
      "google",
      "github",
      "facebook",
      "twitter",
      "x",
      "apple",
      "linkedin",
      "discord",
      "slack",
      "spotify",
      "twitch",
      "yahoo",
    ]

    for (const provider of socialProviders) {
      expect(PROVIDER_CATEGORIES[provider]).toBe("social")
    }
  })

  test("enterprise providers are categorized correctly", () => {
    const enterpriseProviders = [
      "microsoft",
      "cognito",
      "keycloak",
      "jumpcloud",
      "oidc",
      "custom_oauth2",
    ]

    for (const provider of enterpriseProviders) {
      expect(PROVIDER_CATEGORIES[provider]).toBe("enterprise")
    }
  })

  test("password provider is categorized correctly", () => {
    expect(PROVIDER_CATEGORIES.password).toBe("password")
  })

  test("passwordless provider is categorized correctly", () => {
    expect(PROVIDER_CATEGORIES.code).toBe("passwordless")
  })

  test("all category values are valid", () => {
    const validCategories = ["social", "enterprise", "password", "passwordless"]

    for (const category of Object.values(PROVIDER_CATEGORIES)) {
      expect(validCategories).toContain(category)
    }
  })
})

describe("PROVIDER_DISPLAY_NAMES", () => {
  test("provides display names for all known providers", () => {
    const allProviders = [
      "google",
      "github",
      "facebook",
      "twitter",
      "x",
      "apple",
      "microsoft",
      "linkedin",
      "discord",
      "slack",
      "spotify",
      "twitch",
      "cognito",
      "keycloak",
      "jumpcloud",
      "yahoo",
      "oidc",
      "password",
      "code",
      "custom_oauth2",
    ]

    for (const provider of allProviders) {
      expect(PROVIDER_DISPLAY_NAMES).toHaveProperty(provider)
    }
  })

  test("display names are properly formatted", () => {
    expect(PROVIDER_DISPLAY_NAMES.google).toBe("Google")
    expect(PROVIDER_DISPLAY_NAMES.github).toBe("GitHub")
    expect(PROVIDER_DISPLAY_NAMES.facebook).toBe("Facebook")
    expect(PROVIDER_DISPLAY_NAMES.microsoft).toBe("Microsoft")
  })

  test("special display names are correct", () => {
    expect(PROVIDER_DISPLAY_NAMES.x).toBe("X (Twitter)")
    expect(PROVIDER_DISPLAY_NAMES.cognito).toBe("AWS Cognito")
    expect(PROVIDER_DISPLAY_NAMES.oidc).toBe("OpenID Connect")
    expect(PROVIDER_DISPLAY_NAMES.code).toBe("One-Time Code")
    expect(PROVIDER_DISPLAY_NAMES.custom_oauth2).toBe("Custom OAuth2")
  })

  test("all display names are non-empty strings", () => {
    for (const name of Object.values(PROVIDER_DISPLAY_NAMES)) {
      expect(typeof name).toBe("string")
      expect(name.length).toBeGreaterThan(0)
    }
  })
})

describe("OIDC_CAPABLE_PROVIDERS", () => {
  test("includes all OIDC-capable providers", () => {
    const expectedProviders = [
      "google",
      "apple",
      "microsoft",
      "keycloak",
      "cognito",
      "jumpcloud",
      "oidc",
    ]

    for (const provider of expectedProviders) {
      expect(OIDC_CAPABLE_PROVIDERS.has(provider)).toBe(true)
    }
  })

  test("excludes non-OIDC providers", () => {
    const nonOidcProviders = ["github", "facebook", "twitter", "discord"]

    for (const provider of nonOidcProviders) {
      expect(OIDC_CAPABLE_PROVIDERS.has(provider)).toBe(false)
    }
  })

  test("is a Set instance", () => {
    expect(OIDC_CAPABLE_PROVIDERS instanceof Set).toBe(true)
  })
})

describe("PKCE_REQUIRED_PROVIDERS", () => {
  test("includes providers that require PKCE", () => {
    expect(PKCE_REQUIRED_PROVIDERS.has("twitter")).toBe(true)
    expect(PKCE_REQUIRED_PROVIDERS.has("x")).toBe(true)
  })

  test("excludes providers that don't require PKCE", () => {
    expect(PKCE_REQUIRED_PROVIDERS.has("google")).toBe(false)
    expect(PKCE_REQUIRED_PROVIDERS.has("github")).toBe(false)
  })

  test("is a Set instance", () => {
    expect(PKCE_REQUIRED_PROVIDERS instanceof Set).toBe(true)
  })
})

describe("NO_SECRET_REQUIRED_PROVIDERS", () => {
  test("includes providers that don't require client secret", () => {
    expect(NO_SECRET_REQUIRED_PROVIDERS.has("oidc")).toBe(true)
    expect(NO_SECRET_REQUIRED_PROVIDERS.has("code")).toBe(true)
  })

  test("excludes providers that require client secret", () => {
    expect(NO_SECRET_REQUIRED_PROVIDERS.has("google")).toBe(false)
    expect(NO_SECRET_REQUIRED_PROVIDERS.has("github")).toBe(false)
  })

  test("is a Set instance", () => {
    expect(NO_SECRET_REQUIRED_PROVIDERS instanceof Set).toBe(true)
  })
})

describe("getDefaultScopes", () => {
  test("returns correct scopes for google", () => {
    const scopes = getDefaultScopes("google")
    expect(scopes).toEqual(["openid", "email", "profile"])
  })

  test("returns correct scopes for github", () => {
    const scopes = getDefaultScopes("github")
    expect(scopes).toEqual(["user:email"])
  })

  test("returns correct scopes for twitter", () => {
    const scopes = getDefaultScopes("twitter")
    expect(scopes).toEqual(["tweet.read", "users.read"])
  })

  test("returns correct scopes for microsoft", () => {
    const scopes = getDefaultScopes("microsoft")
    expect(scopes).toEqual(["openid", "email", "profile"])
  })

  test("returns empty array for unknown provider", () => {
    const scopes = getDefaultScopes("unknown" as ProviderType)
    expect(scopes).toEqual([])
  })

  test("returns empty array for password provider (not in defaults)", () => {
    const scopes = getDefaultScopes("password")
    expect(scopes).toEqual([])
  })

  test("returns same array reference (implementation detail)", () => {
    const scopes1 = getDefaultScopes("google")
    const scopes2 = getDefaultScopes("google")

    // Implementation returns same reference from PROVIDER_DEFAULTS
    expect(scopes1).toEqual(scopes2)
    expect(scopes1).toBe(scopes2)
  })

  test("returns non-empty scopes for all OAuth2 providers", () => {
    const oauth2Providers: ProviderType[] = [
      "google",
      "github",
      "facebook",
      "twitter",
      "microsoft",
      "linkedin",
    ]

    for (const provider of oauth2Providers) {
      const scopes = getDefaultScopes(provider)
      expect(scopes.length).toBeGreaterThan(0)
    }
  })
})

describe("requiresPKCE", () => {
  test("returns true for twitter", () => {
    expect(requiresPKCE("twitter")).toBe(true)
  })

  test("returns true for x", () => {
    expect(requiresPKCE("x")).toBe(true)
  })

  test("returns false for google", () => {
    expect(requiresPKCE("google")).toBe(false)
  })

  test("returns false for github", () => {
    expect(requiresPKCE("github")).toBe(false)
  })

  test("returns false for unknown provider", () => {
    expect(requiresPKCE("unknown" as ProviderType)).toBe(false)
  })

  test("checks PROVIDER_DEFAULTS for explicit pkce flag", () => {
    // Twitter has pkce: true in PROVIDER_DEFAULTS
    expect(requiresPKCE("twitter")).toBe(true)
  })

  test("returns false for providers without pkce flag", () => {
    const providersWithoutPkce: ProviderType[] = [
      "google",
      "github",
      "facebook",
      "microsoft",
    ]

    for (const provider of providersWithoutPkce) {
      expect(requiresPKCE(provider)).toBe(false)
    }
  })
})

describe("requiresClientSecret", () => {
  test("returns true for google", () => {
    expect(requiresClientSecret("google")).toBe(true)
  })

  test("returns true for github", () => {
    expect(requiresClientSecret("github")).toBe(true)
  })

  test("returns false for oidc", () => {
    expect(requiresClientSecret("oidc")).toBe(false)
  })

  test("returns false for code (passwordless)", () => {
    expect(requiresClientSecret("code")).toBe(false)
  })

  test("returns true for unknown provider (default behavior)", () => {
    expect(requiresClientSecret("unknown" as ProviderType)).toBe(true)
  })

  test("returns true for all OAuth2 social providers", () => {
    const socialProviders: ProviderType[] = [
      "google",
      "github",
      "facebook",
      "twitter",
      "microsoft",
    ]

    for (const provider of socialProviders) {
      expect(requiresClientSecret(provider)).toBe(true)
    }
  })
})

describe("getProviderCategory", () => {
  test("returns correct category for social providers", () => {
    expect(getProviderCategory("google")).toBe("social")
    expect(getProviderCategory("github")).toBe("social")
    expect(getProviderCategory("facebook")).toBe("social")
  })

  test("returns correct category for enterprise providers", () => {
    expect(getProviderCategory("microsoft")).toBe("enterprise")
    expect(getProviderCategory("keycloak")).toBe("enterprise")
    expect(getProviderCategory("oidc")).toBe("enterprise")
  })

  test("returns correct category for password provider", () => {
    expect(getProviderCategory("password")).toBe("password")
  })

  test("returns correct category for passwordless provider", () => {
    expect(getProviderCategory("code")).toBe("passwordless")
  })

  test("returns enterprise as default for unknown provider", () => {
    expect(getProviderCategory("unknown" as ProviderType)).toBe("enterprise")
  })

  test("handles all defined provider types", () => {
    const allProviders: ProviderType[] = [
      "google",
      "github",
      "facebook",
      "twitter",
      "x",
      "apple",
      "microsoft",
      "linkedin",
      "discord",
      "slack",
      "spotify",
      "twitch",
      "cognito",
      "keycloak",
      "jumpcloud",
      "yahoo",
      "oidc",
      "password",
      "code",
      "custom_oauth2",
    ]

    for (const provider of allProviders) {
      const category = getProviderCategory(provider)
      expect(["social", "enterprise", "password", "passwordless"]).toContain(
        category,
      )
    }
  })
})

describe("getProviderDisplayName", () => {
  test("returns correct display name for known providers", () => {
    expect(getProviderDisplayName("google")).toBe("Google")
    expect(getProviderDisplayName("github")).toBe("GitHub")
    expect(getProviderDisplayName("microsoft")).toBe("Microsoft")
  })

  test("returns special display names", () => {
    expect(getProviderDisplayName("x")).toBe("X (Twitter)")
    expect(getProviderDisplayName("cognito")).toBe("AWS Cognito")
    expect(getProviderDisplayName("oidc")).toBe("OpenID Connect")
  })

  test("capitalizes first letter for unknown provider", () => {
    expect(getProviderDisplayName("custom" as ProviderType)).toBe("Custom")
    expect(getProviderDisplayName("myProvider" as ProviderType)).toBe(
      "MyProvider",
    )
  })

  test("handles lowercase provider names", () => {
    expect(getProviderDisplayName("test" as ProviderType)).toBe("Test")
  })

  test("handles empty string", () => {
    expect(getProviderDisplayName("" as ProviderType)).toBe("")
  })

  test("returns display names for all defined providers", () => {
    const allProviders: ProviderType[] = [
      "google",
      "github",
      "facebook",
      "twitter",
      "x",
      "apple",
      "microsoft",
      "linkedin",
      "discord",
      "slack",
      "spotify",
      "twitch",
      "cognito",
      "keycloak",
      "jumpcloud",
      "yahoo",
      "oidc",
      "password",
      "code",
      "custom_oauth2",
    ]

    for (const provider of allProviders) {
      const displayName = getProviderDisplayName(provider)
      expect(typeof displayName).toBe("string")
      expect(displayName.length).toBeGreaterThan(0)
    }
  })
})

describe("interpolateEndpoint", () => {
  test("replaces single variable", () => {
    const url = "https://example.com/{tenant}/auth"
    const result = interpolateEndpoint(url, { tenant: "common" })

    expect(result).toBe("https://example.com/common/auth")
  })

  test("replaces multiple variables", () => {
    const url = "https://{domain}.auth.{region}.amazoncognito.com/oauth2/authorize"
    const result = interpolateEndpoint(url, {
      domain: "myapp",
      region: "us-east-1",
    })

    expect(result).toBe(
      "https://myapp.auth.us-east-1.amazoncognito.com/oauth2/authorize",
    )
  })

  test("replaces all occurrences of variable", () => {
    const url = "https://{tenant}.example.com/{tenant}/auth"
    const result = interpolateEndpoint(url, { tenant: "acme" })

    expect(result).toBe("https://acme.example.com/acme/auth")
  })

  test("handles URL with no variables", () => {
    const url = "https://example.com/auth"
    const result = interpolateEndpoint(url, { tenant: "common" })

    expect(result).toBe("https://example.com/auth")
  })

  test("handles empty vars object", () => {
    const url = "https://example.com/{tenant}/auth"
    const result = interpolateEndpoint(url, {})

    expect(result).toBe("https://example.com/{tenant}/auth")
  })

  test("handles vars not present in URL", () => {
    const url = "https://example.com/auth"
    const result = interpolateEndpoint(url, { tenant: "common", region: "us" })

    expect(result).toBe("https://example.com/auth")
  })

  test("replaces Microsoft tenant placeholder", () => {
    const url =
      "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
    const result = interpolateEndpoint(url, { tenant: "common" })

    expect(result).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    )
  })

  test("replaces Cognito placeholders", () => {
    const url =
      "https://{domain}.auth.{region}.amazoncognito.com/oauth2/token"
    const result = interpolateEndpoint(url, {
      domain: "myapp-prod",
      region: "eu-west-1",
    })

    expect(result).toBe(
      "https://myapp-prod.auth.eu-west-1.amazoncognito.com/oauth2/token",
    )
  })

  test("replaces Keycloak placeholders", () => {
    const url = "{baseUrl}/realms/{realm}/protocol/openid-connect/auth"
    const result = interpolateEndpoint(url, {
      baseUrl: "https://keycloak.example.com",
      realm: "master",
    })

    expect(result).toBe(
      "https://keycloak.example.com/realms/master/protocol/openid-connect/auth",
    )
  })

  test("handles special characters in variable values", () => {
    const url = "https://example.com/{path}/auth"
    const result = interpolateEndpoint(url, { path: "my-app_v1.0" })

    expect(result).toBe("https://example.com/my-app_v1.0/auth")
  })

  test("handles numeric variable values", () => {
    const url = "https://example.com/v{version}/auth"
    const result = interpolateEndpoint(url, { version: "2" })

    expect(result).toBe("https://example.com/v2/auth")
  })

  test("preserves URL structure", () => {
    const url =
      "https://example.com/{tenant}/oauth2/v2.0/authorize?client_id=123"
    const result = interpolateEndpoint(url, { tenant: "common" })

    expect(result).toBe(
      "https://example.com/common/oauth2/v2.0/authorize?client_id=123",
    )
  })

  test("handles adjacent variables", () => {
    const url = "https://example.com/{part1}{part2}/auth"
    const result = interpolateEndpoint(url, { part1: "foo", part2: "bar" })

    expect(result).toBe("https://example.com/foobar/auth")
  })

  test("does not replace partial variable names", () => {
    const url = "https://example.com/{tenant}/auth"
    const result = interpolateEndpoint(url, { ten: "value" })

    // Should not replace 'ten' within '{tenant}'
    expect(result).toBe("https://example.com/{tenant}/auth")
  })

  test("handles empty string variable value", () => {
    const url = "https://example.com/{tenant}/auth"
    const result = interpolateEndpoint(url, { tenant: "" })

    expect(result).toBe("https://example.com//auth")
  })
})

describe("Provider defaults consistency", () => {
  test("all providers in PROVIDER_DEFAULTS have display names", () => {
    for (const provider of Object.keys(PROVIDER_DEFAULTS)) {
      expect(PROVIDER_DISPLAY_NAMES).toHaveProperty(provider)
    }
  })

  test("all providers in PROVIDER_DEFAULTS have categories", () => {
    for (const provider of Object.keys(PROVIDER_DEFAULTS)) {
      // Password and code don't have OAuth defaults but have categories
      if (provider === "password" || provider === "code") continue

      const category = getProviderCategory(provider as ProviderType)
      expect(["social", "enterprise", "password", "passwordless"]).toContain(
        category,
      )
    }
  })

  test("OIDC-capable providers with static endpoints have issuer in defaults", () => {
    // Only some OIDC providers have static issuers
    const providersWithStaticIssuer = ["google", "apple", "microsoft"]

    for (const provider of providersWithStaticIssuer) {
      const config = PROVIDER_DEFAULTS[provider]
      expect(config?.issuer).toBeDefined()
    }

    // Others use templates and require runtime configuration
    const providersWithTemplates = ["keycloak", "cognito", "jumpcloud"]
    for (const provider of providersWithTemplates) {
      const config = PROVIDER_DEFAULTS[provider]
      // These don't have static issuers in defaults
      expect(config?.issuer).toBeUndefined()
    }
  })

  test("PKCE-required providers have pkce flag in defaults", () => {
    for (const provider of PKCE_REQUIRED_PROVIDERS) {
      expect(requiresPKCE(provider as ProviderType)).toBe(true)
    }
  })

  test("all social providers have userinfo endpoint", () => {
    const socialProviders = Object.keys(PROVIDER_CATEGORIES).filter(
      (p) => PROVIDER_CATEGORIES[p] === "social",
    )

    for (const provider of socialProviders) {
      const config = PROVIDER_DEFAULTS[provider]
      if (config) {
        expect(config.endpoints.userinfo || config.endpoints.jwks).toBeDefined()
      }
    }
  })

  test("all providers have HTTPS endpoints (or templates)", () => {
    for (const [provider, config] of Object.entries(PROVIDER_DEFAULTS)) {
      const { authorization, token } = config.endpoints

      // Check if URL starts with https:// or is a template (contains {)
      const isValidAuth =
        authorization.startsWith("https://") || authorization.startsWith("{")
      const isValidToken = token.startsWith("https://") || token.startsWith("{")

      expect(isValidAuth).toBe(true)
      expect(isValidToken).toBe(true)
    }
  })

  test("no duplicate scopes in default scopes", () => {
    for (const [provider, config] of Object.entries(PROVIDER_DEFAULTS)) {
      const scopes = config.defaultScopes
      const uniqueScopes = new Set(scopes)

      expect(scopes.length).toBe(uniqueScopes.size)
    }
  })
})
