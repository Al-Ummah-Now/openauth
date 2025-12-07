/**
 * Provider Factory - Creates Provider Instances from Database Configuration
 *
 * This module creates provider instances that match the existing provider
 * interfaces in /packages/openauth/src/provider/. It maps database configurations
 * to the appropriate provider constructors.
 *
 * @packageDocumentation
 */

import type { Provider } from "../provider/provider.js"
import { Oauth2Provider } from "../provider/oauth2.js"
import { OidcProvider } from "../provider/oidc.js"
import type {
  IdentityProvider,
  ProviderConfig,
  ProviderType,
  OAuth2ProviderConfig,
  OIDCProviderConfig,
  MicrosoftProviderConfig,
  CognitoProviderConfig,
  KeycloakProviderConfig,
  CustomOAuth2ProviderConfig,
} from "./types.js"
import { ProviderConfigError } from "./types.js"
import {
  PROVIDER_DEFAULTS,
  interpolateEndpoint,
  requiresPKCE,
} from "./defaults.js"

/**
 * Validation result for provider configuration
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Create a provider instance from database configuration
 *
 * Maps the stored configuration to the appropriate provider constructor
 * from the existing provider implementations.
 *
 * @param provider - Parsed provider configuration from database
 * @returns Provider instance ready for use
 * @throws ProviderConfigError if configuration is invalid
 */
export function createProviderFromConfig(
  provider: IdentityProvider,
): Provider<any> {
  // Validate required fields
  if (
    !provider.clientId &&
    provider.type !== "oidc" &&
    provider.type !== "code" &&
    provider.type !== "password"
  ) {
    throw new ProviderConfigError(
      `Provider "${provider.name}" is missing client_id`,
    )
  }

  // Get default configuration for this provider type
  const defaults = PROVIDER_DEFAULTS[provider.type]
  const config = provider.config as Record<string, any>

  // Build provider based on type
  switch (provider.type) {
    case "oidc":
      return createOIDCProvider(provider, config as OIDCProviderConfig)

    case "microsoft":
      return createMicrosoftProvider(
        provider,
        defaults,
        config as MicrosoftProviderConfig,
      )

    case "cognito":
      return createCognitoProvider(
        provider,
        defaults,
        config as CognitoProviderConfig,
      )

    case "keycloak":
      return createKeycloakProvider(
        provider,
        defaults,
        config as KeycloakProviderConfig,
      )

    case "custom_oauth2":
      return createCustomOAuth2Provider(
        provider,
        config as CustomOAuth2ProviderConfig,
      )

    case "password":
    case "code":
      // Password and code providers require special handling
      // Return a placeholder - these should be handled by the application
      throw new ProviderConfigError(
        `Provider type "${provider.type}" requires custom implementation`,
        [
          "Password and code providers require UI callbacks that must be defined in the application",
        ],
      )

    default:
      // Standard OAuth2 providers (google, github, facebook, etc.)
      if (!defaults) {
        throw new ProviderConfigError(
          `Unsupported provider type: ${provider.type}`,
        )
      }
      return createStandardOAuth2Provider(
        provider,
        defaults,
        config as OAuth2ProviderConfig,
      )
  }
}

/**
 * Create a standard OAuth2 provider (Google, GitHub, Facebook, etc.)
 */
function createStandardOAuth2Provider(
  provider: IdentityProvider,
  defaults: (typeof PROVIDER_DEFAULTS)[string],
  config: OAuth2ProviderConfig,
): Provider<any> {
  const scopes = config.scopes || defaults.defaultScopes
  const endpoints = config.endpoints || defaults.endpoints

  return Oauth2Provider({
    type: provider.type,
    clientID: provider.clientId!,
    clientSecret: provider.clientSecret!,
    endpoint: {
      authorization: endpoints.authorization || defaults.endpoints.authorization,
      token: endpoints.token || defaults.endpoints.token,
      jwks: endpoints.jwks || defaults.endpoints.jwks,
    },
    scopes,
    pkce: config.pkce ?? defaults.pkce ?? requiresPKCE(provider.type),
    query: config.query,
  })
}

/**
 * Create a Microsoft/Azure AD provider with tenant support
 */
function createMicrosoftProvider(
  provider: IdentityProvider,
  defaults: (typeof PROVIDER_DEFAULTS)[string],
  config: MicrosoftProviderConfig,
): Provider<any> {
  const tenant = config.tenant || "common"
  const scopes = config.scopes || defaults.defaultScopes

  // Interpolate tenant in endpoint URLs
  const endpoints = {
    authorization: interpolateEndpoint(
      config.endpoints?.authorization || defaults.endpoints.authorization,
      { tenant },
    ),
    token: interpolateEndpoint(
      config.endpoints?.token || defaults.endpoints.token,
      { tenant },
    ),
    jwks: defaults.endpoints.jwks
      ? interpolateEndpoint(defaults.endpoints.jwks, { tenant })
      : undefined,
  }

  return Oauth2Provider({
    type: provider.type,
    clientID: provider.clientId!,
    clientSecret: provider.clientSecret!,
    endpoint: endpoints,
    scopes,
    query: config.query,
  })
}

/**
 * Create an AWS Cognito provider
 */
function createCognitoProvider(
  provider: IdentityProvider,
  defaults: (typeof PROVIDER_DEFAULTS)[string],
  config: CognitoProviderConfig,
): Provider<any> {
  if (!config.domain || !config.region) {
    throw new ProviderConfigError("Cognito provider requires domain and region", [
      "Set config.domain to your Cognito User Pool domain prefix",
      "Set config.region to your AWS region (e.g., us-east-1)",
    ])
  }

  const scopes = config.scopes || defaults.defaultScopes
  const vars = { domain: config.domain, region: config.region }

  const endpoints = {
    authorization: interpolateEndpoint(defaults.endpoints.authorization, vars),
    token: interpolateEndpoint(defaults.endpoints.token, vars),
  }

  return Oauth2Provider({
    type: provider.type,
    clientID: provider.clientId!,
    clientSecret: provider.clientSecret!,
    endpoint: endpoints,
    scopes,
    query: config.query,
  })
}

/**
 * Create a Keycloak provider
 */
function createKeycloakProvider(
  provider: IdentityProvider,
  defaults: (typeof PROVIDER_DEFAULTS)[string],
  config: KeycloakProviderConfig,
): Provider<any> {
  if (!config.baseUrl || !config.realm) {
    throw new ProviderConfigError("Keycloak provider requires baseUrl and realm", [
      "Set config.baseUrl to your Keycloak server URL",
      "Set config.realm to your Keycloak realm name",
    ])
  }

  const scopes = config.scopes || defaults.defaultScopes
  const vars = { baseUrl: config.baseUrl.replace(/\/$/, ""), realm: config.realm }

  const endpoints = {
    authorization: interpolateEndpoint(defaults.endpoints.authorization, vars),
    token: interpolateEndpoint(defaults.endpoints.token, vars),
  }

  return Oauth2Provider({
    type: provider.type,
    clientID: provider.clientId!,
    clientSecret: provider.clientSecret!,
    endpoint: endpoints,
    scopes,
    query: config.query,
  })
}

/**
 * Create an OIDC provider from issuer discovery
 */
function createOIDCProvider(
  provider: IdentityProvider,
  config: OIDCProviderConfig,
): Provider<any> {
  if (!config.issuer) {
    throw new ProviderConfigError("OIDC provider requires issuer URL", [
      "Set config.issuer to the OIDC issuer URL (e.g., https://accounts.google.com)",
    ])
  }

  return OidcProvider({
    type: provider.type,
    clientID: provider.clientId!,
    issuer: config.issuer,
    scopes: config.scopes,
    query: config.query,
  })
}

/**
 * Create a custom OAuth2 provider with explicit endpoints
 */
function createCustomOAuth2Provider(
  provider: IdentityProvider,
  config: CustomOAuth2ProviderConfig,
): Provider<any> {
  if (!config.endpoints?.authorization || !config.endpoints?.token) {
    throw new ProviderConfigError(
      "Custom OAuth2 provider requires authorization and token endpoints",
      [
        "Set config.endpoints.authorization to the OAuth2 authorization URL",
        "Set config.endpoints.token to the OAuth2 token URL",
      ],
    )
  }

  return Oauth2Provider({
    type: provider.type,
    clientID: provider.clientId!,
    clientSecret: provider.clientSecret!,
    endpoint: {
      authorization: config.endpoints.authorization,
      token: config.endpoints.token,
      jwks: config.endpoints.jwks,
    },
    scopes: config.scopes || [],
    pkce: config.pkce,
    query: config.query,
  })
}

/**
 * Validate provider configuration before saving to database
 *
 * @param type - Provider type
 * @param config - Provider configuration object
 * @returns Validation result with any errors
 */
export function validateProviderConfig(
  type: ProviderType,
  config: Partial<ProviderConfig>,
): ValidationResult {
  const errors: string[] = []

  switch (type) {
    case "oidc":
      if (!(config as OIDCProviderConfig).issuer) {
        errors.push("OIDC provider requires 'issuer' in config")
      }
      break

    case "custom_oauth2": {
      const customConfig = config as CustomOAuth2ProviderConfig
      if (!customConfig.endpoints?.authorization) {
        errors.push("Custom OAuth2 requires 'endpoints.authorization'")
      }
      if (!customConfig.endpoints?.token) {
        errors.push("Custom OAuth2 requires 'endpoints.token'")
      }
      break
    }

    case "microsoft": {
      const msConfig = config as MicrosoftProviderConfig
      if (msConfig.tenant) {
        const validTenants = ["common", "organizations", "consumers"]
        const isUUID =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            msConfig.tenant,
          )
        if (!validTenants.includes(msConfig.tenant) && !isUUID) {
          errors.push(
            "Microsoft tenant must be 'common', 'organizations', 'consumers', or a valid tenant ID (UUID)",
          )
        }
      }
      break
    }

    case "cognito": {
      const cognitoConfig = config as CognitoProviderConfig
      if (cognitoConfig.domain && !cognitoConfig.region) {
        errors.push("Cognito provider requires both 'domain' and 'region'")
      }
      if (!cognitoConfig.domain && cognitoConfig.region) {
        errors.push("Cognito provider requires both 'domain' and 'region'")
      }
      break
    }

    case "keycloak": {
      const keycloakConfig = config as KeycloakProviderConfig
      if (keycloakConfig.baseUrl && !keycloakConfig.realm) {
        errors.push("Keycloak provider requires both 'baseUrl' and 'realm'")
      }
      if (!keycloakConfig.baseUrl && keycloakConfig.realm) {
        errors.push("Keycloak provider requires both 'baseUrl' and 'realm'")
      }
      break
    }
  }

  // Validate common fields
  const oauthConfig = config as OAuth2ProviderConfig
  if (oauthConfig.scopes && !Array.isArray(oauthConfig.scopes)) {
    errors.push("'scopes' must be an array of strings")
  }
  if (
    oauthConfig.scopes &&
    Array.isArray(oauthConfig.scopes) &&
    !oauthConfig.scopes.every((s) => typeof s === "string")
  ) {
    errors.push("All scope values must be strings")
  }

  if (oauthConfig.query && typeof oauthConfig.query !== "object") {
    errors.push("'query' must be an object")
  }

  if (
    oauthConfig.endpoints &&
    typeof oauthConfig.endpoints !== "object"
  ) {
    errors.push("'endpoints' must be an object")
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Get default configuration for a provider type
 *
 * @param type - Provider type
 * @returns Default configuration object
 */
export function getDefaultConfig(type: ProviderType): Partial<ProviderConfig> {
  const defaults = PROVIDER_DEFAULTS[type]
  if (!defaults) return {}

  return {
    scopes: defaults.defaultScopes || [],
  }
}

/**
 * Merge user config with defaults, ensuring required fields
 *
 * @param type - Provider type
 * @param userConfig - User-provided configuration
 * @returns Merged configuration
 */
export function mergeWithDefaults(
  type: ProviderType,
  userConfig: Partial<ProviderConfig>,
): ProviderConfig {
  const defaults = getDefaultConfig(type)
  return { ...defaults, ...userConfig } as ProviderConfig
}
