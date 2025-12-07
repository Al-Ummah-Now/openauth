/**
 * Default Provider Configurations
 *
 * Contains default OAuth2/OIDC endpoints and scopes for all supported
 * identity providers. These defaults are used when creating providers
 * from database configuration.
 *
 * @packageDocumentation
 */

import type { ProviderCategory, ProviderType } from "./types.js"

/**
 * Default configuration for each provider type
 */
export interface ProviderDefaults {
  /** OAuth2 endpoints */
  endpoints: {
    authorization: string
    token: string
    jwks?: string
    userinfo?: string
  }
  /** Default OAuth scopes */
  defaultScopes: string[]
  /** Whether PKCE is required */
  pkce?: boolean
  /** OIDC issuer URL (for OIDC providers) */
  issuer?: string
}

/**
 * Default OAuth2 endpoints and scopes for all supported providers
 */
export const PROVIDER_DEFAULTS: Record<string, ProviderDefaults> = {
  google: {
    endpoints: {
      authorization: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
      jwks: "https://www.googleapis.com/oauth2/v3/certs",
      userinfo: "https://www.googleapis.com/oauth2/v3/userinfo",
    },
    defaultScopes: ["openid", "email", "profile"],
    issuer: "https://accounts.google.com",
  },

  github: {
    endpoints: {
      authorization: "https://github.com/login/oauth/authorize",
      token: "https://github.com/login/oauth/access_token",
      userinfo: "https://api.github.com/user",
    },
    defaultScopes: ["user:email"],
  },

  facebook: {
    endpoints: {
      authorization: "https://www.facebook.com/v18.0/dialog/oauth",
      token: "https://graph.facebook.com/v18.0/oauth/access_token",
      userinfo: "https://graph.facebook.com/me?fields=id,name,email",
    },
    defaultScopes: ["email", "public_profile"],
  },

  twitter: {
    endpoints: {
      authorization: "https://twitter.com/i/oauth2/authorize",
      token: "https://api.x.com/2/oauth2/token",
      userinfo: "https://api.x.com/2/users/me",
    },
    defaultScopes: ["tweet.read", "users.read"],
    pkce: true,
  },

  x: {
    endpoints: {
      authorization: "https://twitter.com/i/oauth2/authorize",
      token: "https://api.x.com/2/oauth2/token",
      userinfo: "https://api.x.com/2/users/me",
    },
    defaultScopes: ["tweet.read", "users.read"],
    pkce: true,
  },

  apple: {
    endpoints: {
      authorization: "https://appleid.apple.com/auth/authorize",
      token: "https://appleid.apple.com/auth/token",
      jwks: "https://appleid.apple.com/auth/keys",
    },
    defaultScopes: ["name", "email"],
    issuer: "https://appleid.apple.com",
  },

  microsoft: {
    endpoints: {
      authorization:
        "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
      token: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
      jwks: "https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys",
      userinfo: "https://graph.microsoft.com/oidc/userinfo",
    },
    defaultScopes: ["openid", "email", "profile"],
    issuer: "https://login.microsoftonline.com/{tenant}/v2.0",
  },

  linkedin: {
    endpoints: {
      authorization: "https://www.linkedin.com/oauth/v2/authorization",
      token: "https://www.linkedin.com/oauth/v2/accessToken",
      userinfo: "https://api.linkedin.com/v2/userinfo",
    },
    defaultScopes: ["openid", "profile", "email"],
  },

  discord: {
    endpoints: {
      authorization: "https://discord.com/oauth2/authorize",
      token: "https://discord.com/api/oauth2/token",
      userinfo: "https://discord.com/api/users/@me",
    },
    defaultScopes: ["identify", "email"],
  },

  slack: {
    endpoints: {
      authorization: "https://slack.com/openid/connect/authorize",
      token: "https://slack.com/api/openid.connect.token",
      userinfo: "https://slack.com/api/openid.connect.userInfo",
    },
    defaultScopes: ["openid", "email", "profile"],
  },

  spotify: {
    endpoints: {
      authorization: "https://accounts.spotify.com/authorize",
      token: "https://accounts.spotify.com/api/token",
      userinfo: "https://api.spotify.com/v1/me",
    },
    defaultScopes: ["user-read-email", "user-read-private"],
  },

  twitch: {
    endpoints: {
      authorization: "https://id.twitch.tv/oauth2/authorize",
      token: "https://id.twitch.tv/oauth2/token",
      userinfo: "https://api.twitch.tv/helix/users",
    },
    defaultScopes: ["user:read:email"],
  },

  cognito: {
    endpoints: {
      authorization: "https://{domain}.auth.{region}.amazoncognito.com/oauth2/authorize",
      token: "https://{domain}.auth.{region}.amazoncognito.com/oauth2/token",
      userinfo: "https://{domain}.auth.{region}.amazoncognito.com/oauth2/userInfo",
    },
    defaultScopes: ["openid", "email", "profile"],
  },

  keycloak: {
    endpoints: {
      authorization: "{baseUrl}/realms/{realm}/protocol/openid-connect/auth",
      token: "{baseUrl}/realms/{realm}/protocol/openid-connect/token",
      userinfo: "{baseUrl}/realms/{realm}/protocol/openid-connect/userinfo",
      jwks: "{baseUrl}/realms/{realm}/protocol/openid-connect/certs",
    },
    defaultScopes: ["openid", "email", "profile"],
  },

  jumpcloud: {
    endpoints: {
      authorization: "https://oauth.id.jumpcloud.com/oauth2/auth",
      token: "https://oauth.id.jumpcloud.com/oauth2/token",
      userinfo: "https://oauth.id.jumpcloud.com/userinfo",
    },
    defaultScopes: ["openid", "email", "profile"],
  },

  yahoo: {
    endpoints: {
      authorization: "https://api.login.yahoo.com/oauth2/request_auth",
      token: "https://api.login.yahoo.com/oauth2/get_token",
      userinfo: "https://api.login.yahoo.com/openid/v1/userinfo",
    },
    defaultScopes: ["openid", "email", "profile"],
  },
}

/**
 * Provider categories for UI organization
 */
export const PROVIDER_CATEGORIES: Record<string, ProviderCategory> = {
  // Social login providers
  google: "social",
  github: "social",
  facebook: "social",
  twitter: "social",
  x: "social",
  apple: "social",
  linkedin: "social",
  discord: "social",
  slack: "social",
  spotify: "social",
  twitch: "social",
  yahoo: "social",

  // Enterprise identity providers
  microsoft: "enterprise",
  cognito: "enterprise",
  keycloak: "enterprise",
  jumpcloud: "enterprise",
  oidc: "enterprise",
  custom_oauth2: "enterprise",

  // Password-based authentication
  password: "password",

  // Passwordless authentication
  code: "passwordless",
}

/**
 * Display names for provider types
 */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  facebook: "Facebook",
  twitter: "Twitter",
  x: "X (Twitter)",
  apple: "Apple",
  microsoft: "Microsoft",
  linkedin: "LinkedIn",
  discord: "Discord",
  slack: "Slack",
  spotify: "Spotify",
  twitch: "Twitch",
  cognito: "AWS Cognito",
  keycloak: "Keycloak",
  jumpcloud: "JumpCloud",
  yahoo: "Yahoo",
  oidc: "OpenID Connect",
  password: "Password",
  code: "One-Time Code",
  custom_oauth2: "Custom OAuth2",
}

/**
 * Providers that support OIDC (have issuer discovery)
 */
export const OIDC_CAPABLE_PROVIDERS = new Set<string>([
  "google",
  "apple",
  "microsoft",
  "keycloak",
  "cognito",
  "jumpcloud",
  "oidc",
])

/**
 * Providers that require PKCE
 */
export const PKCE_REQUIRED_PROVIDERS = new Set<string>(["twitter", "x"])

/**
 * Providers that don't require a client secret (OIDC implicit flow)
 */
export const NO_SECRET_REQUIRED_PROVIDERS = new Set<string>(["oidc", "code"])

/**
 * Get default scopes for a provider type
 *
 * @param type - Provider type
 * @returns Array of default scope strings
 */
export function getDefaultScopes(type: ProviderType): string[] {
  const defaults = PROVIDER_DEFAULTS[type]
  return defaults?.defaultScopes || []
}

/**
 * Check if a provider type requires PKCE
 *
 * @param type - Provider type
 * @returns True if PKCE is required
 */
export function requiresPKCE(type: ProviderType): boolean {
  return PKCE_REQUIRED_PROVIDERS.has(type) || PROVIDER_DEFAULTS[type]?.pkce === true
}

/**
 * Check if a provider type requires a client secret
 *
 * @param type - Provider type
 * @returns True if client secret is required
 */
export function requiresClientSecret(type: ProviderType): boolean {
  return !NO_SECRET_REQUIRED_PROVIDERS.has(type)
}

/**
 * Get the provider category
 *
 * @param type - Provider type
 * @returns Provider category
 */
export function getProviderCategory(type: ProviderType): ProviderCategory {
  return PROVIDER_CATEGORIES[type] || "enterprise"
}

/**
 * Get the display name for a provider type
 *
 * @param type - Provider type
 * @returns Human-readable display name
 */
export function getProviderDisplayName(type: ProviderType): string {
  return PROVIDER_DISPLAY_NAMES[type] || type.charAt(0).toUpperCase() + type.slice(1)
}

/**
 * Interpolate template variables in endpoint URLs
 *
 * @param url - URL template with {variable} placeholders
 * @param vars - Variable values to substitute
 * @returns URL with variables replaced
 */
export function interpolateEndpoint(
  url: string,
  vars: Record<string, string>,
): string {
  let result = url
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value)
  }
  return result
}
