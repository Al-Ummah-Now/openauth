/**
 * Dynamic Identity Provider Types
 *
 * Type definitions for database-driven identity provider configuration.
 * Supports all OAuth2/OIDC providers with tenant-level customization.
 *
 * @packageDocumentation
 */

import type { Provider } from "../provider/provider.js"

/**
 * Supported identity provider types.
 * Matches the existing provider implementations in /packages/openauth/src/provider/
 */
export type ProviderType =
  | "google"
  | "github"
  | "facebook"
  | "twitter"
  | "x"
  | "apple"
  | "microsoft"
  | "linkedin"
  | "discord"
  | "slack"
  | "spotify"
  | "twitch"
  | "cognito"
  | "keycloak"
  | "jumpcloud"
  | "yahoo"
  | "oidc"
  | "password"
  | "code"
  | "custom_oauth2"

/**
 * Provider category for UI organization
 */
export type ProviderCategory = "social" | "enterprise" | "passwordless" | "password"

/**
 * Raw database record for identity provider
 */
export interface IdentityProviderRecord {
  id: string
  tenant_id: string
  type: string
  name: string
  display_name: string
  client_id: string | null
  client_secret_encrypted: string | null
  client_secret_iv: string | null
  config: string
  enabled: number
  display_order: number
  created_at: number
  updated_at: number
}

/**
 * Parsed identity provider with decrypted secret
 */
export interface IdentityProvider {
  id: string
  tenantId: string
  type: ProviderType
  name: string
  displayName: string
  clientId: string | null
  clientSecret: string | null
  config: ProviderConfig
  enabled: boolean
  displayOrder: number
  createdAt: Date
  updatedAt: Date
}

// ============================================
// Provider-specific configuration types
// ============================================

/**
 * Base configuration shared by all OAuth2 providers
 */
export interface BaseProviderConfig {
  /** OAuth scopes to request */
  scopes?: string[]
  /** Additional query parameters for authorization URL */
  query?: Record<string, string>
}

/**
 * OAuth2 provider configuration
 */
export interface OAuth2ProviderConfig extends BaseProviderConfig {
  /** Custom OAuth2 endpoints (override defaults) */
  endpoints?: {
    authorization?: string
    token?: string
    jwks?: string
  }
  /** Use PKCE for authorization code flow */
  pkce?: boolean
}

/**
 * Google-specific OAuth2 configuration
 */
export interface GoogleProviderConfig extends OAuth2ProviderConfig {
  /** Restrict to Google Workspace domain */
  hostedDomain?: string
  /** Access type: online or offline (for refresh tokens) */
  accessType?: "online" | "offline"
  /** Consent prompt behavior */
  prompt?: "none" | "consent" | "select_account"
}

/**
 * Microsoft/Azure AD-specific OAuth2 configuration
 */
export interface MicrosoftProviderConfig extends OAuth2ProviderConfig {
  /** Azure AD tenant: common, organizations, consumers, or tenant ID */
  tenant?: string
}

/**
 * Apple-specific OAuth2 configuration
 */
export interface AppleProviderConfig extends OAuth2ProviderConfig {
  /** Response mode for authorization callback */
  responseMode?: "query" | "form_post"
}

/**
 * Slack-specific OAuth2 configuration
 */
export interface SlackProviderConfig extends OAuth2ProviderConfig {
  /** Slack workspace ID for direct sign-in */
  team?: string
}

/**
 * Cognito-specific OAuth2 configuration
 */
export interface CognitoProviderConfig extends OAuth2ProviderConfig {
  /** Cognito User Pool domain */
  domain?: string
  /** AWS region */
  region?: string
}

/**
 * Keycloak-specific OAuth2 configuration
 */
export interface KeycloakProviderConfig extends OAuth2ProviderConfig {
  /** Keycloak server base URL */
  baseUrl?: string
  /** Keycloak realm name */
  realm?: string
}

/**
 * OpenID Connect provider configuration
 */
export interface OIDCProviderConfig extends BaseProviderConfig {
  /** OIDC issuer URL (used for discovery) */
  issuer: string
  /** Optional: explicit discovery endpoint */
  discoveryEndpoint?: string
}

/**
 * Custom OAuth2 provider configuration (for unsupported providers)
 */
export interface CustomOAuth2ProviderConfig extends OAuth2ProviderConfig {
  /** Required: OAuth2 endpoints */
  endpoints: {
    authorization: string
    token: string
    userinfo?: string
    jwks?: string
  }
  /** JSON path to user ID in userinfo response */
  userIdPath?: string
  /** JSON path to email in userinfo response */
  emailPath?: string
  /** JSON path to name in userinfo response */
  namePath?: string
}

/**
 * Password provider configuration
 */
export interface PasswordProviderConfig {
  /** Minimum password length */
  minLength?: number
  /** Require uppercase characters */
  requireUppercase?: boolean
  /** Require lowercase characters */
  requireLowercase?: boolean
  /** Require numbers */
  requireNumbers?: boolean
  /** Require special characters */
  requireSpecial?: boolean
  /** Code length for verification */
  codeLength?: number
}

/**
 * Union type of all provider configurations
 */
export type ProviderConfig =
  | GoogleProviderConfig
  | MicrosoftProviderConfig
  | AppleProviderConfig
  | SlackProviderConfig
  | CognitoProviderConfig
  | KeycloakProviderConfig
  | OAuth2ProviderConfig
  | OIDCProviderConfig
  | CustomOAuth2ProviderConfig
  | PasswordProviderConfig
  | Record<string, unknown>

// ============================================
// API Request/Response types
// ============================================

/**
 * Request body for creating a new provider
 */
export interface CreateProviderRequest {
  type: ProviderType
  name: string
  displayName: string
  clientId?: string
  clientSecret?: string
  config?: Partial<ProviderConfig>
  enabled?: boolean
  displayOrder?: number
}

/**
 * Request body for updating an existing provider
 */
export interface UpdateProviderRequest {
  displayName?: string
  clientId?: string
  clientSecret?: string
  config?: Partial<ProviderConfig>
  enabled?: boolean
  displayOrder?: number
}

/**
 * API response for a single provider (secrets masked)
 */
export interface ProviderResponse {
  id: string
  type: ProviderType
  name: string
  displayName: string
  clientId: string | null
  /** Indicates if a client secret is configured (actual secret never exposed) */
  hasClientSecret: boolean
  /** Masked client secret showing only last 4 characters */
  clientSecretMasked: string | null
  config: ProviderConfig
  enabled: boolean
  displayOrder: number
  createdAt: string
  updatedAt: string
}

/**
 * API response for listing providers
 */
export interface ProviderListResponse {
  providers: ProviderResponse[]
  total: number
}

/**
 * Provider type metadata for UI
 */
export interface ProviderTypeInfo {
  type: ProviderType
  category: ProviderCategory
  displayName: string
  defaultScopes: string[]
  requiresClientSecret: boolean
  supportsOidc: boolean
}

/**
 * API response for available provider types
 */
export interface ProviderTypesResponse {
  types: ProviderTypeInfo[]
}

// ============================================
// Cache types
// ============================================

/**
 * Cache entry with expiration time
 */
export interface CacheEntry<T> {
  value: T
  expiresAt: number
}

// ============================================
// Encryption types
// ============================================

/**
 * AES-256-GCM encrypted value components
 */
export interface EncryptedValue {
  /** Base64-encoded ciphertext */
  ciphertext: string
  /** Base64-encoded initialization vector (12 bytes) */
  iv: string
  /** Base64-encoded authentication tag (16 bytes) */
  tag: string
}

// ============================================
// Loaded provider types
// ============================================

/**
 * Provider loaded from database with instantiated provider object
 */
export interface LoadedProvider {
  /** Parsed provider configuration */
  config: IdentityProvider
  /** Instantiated provider object ready for use */
  instance: Provider<any>
}

// ============================================
// Error types
// ============================================

/**
 * Base class for dynamic provider errors
 */
export class DynamicProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message)
    this.name = "DynamicProviderError"
  }
}

/**
 * Provider not found error
 */
export class ProviderNotFoundError extends DynamicProviderError {
  constructor(tenantId: string, providerName: string) {
    super(
      `Provider "${providerName}" not found for tenant "${tenantId}"`,
      "PROVIDER_NOT_FOUND",
      404,
    )
    this.name = "ProviderNotFoundError"
  }
}

/**
 * Provider configuration error
 */
export class ProviderConfigError extends DynamicProviderError {
  constructor(
    message: string,
    public readonly details?: string[],
  ) {
    super(message, "PROVIDER_CONFIG_ERROR", 400)
    this.name = "ProviderConfigError"
  }
}

/**
 * Encryption/decryption error
 */
export class EncryptionError extends DynamicProviderError {
  constructor(message: string) {
    super(message, "ENCRYPTION_ERROR", 500)
    this.name = "EncryptionError"
  }
}

/**
 * Provider already exists error
 */
export class ProviderExistsError extends DynamicProviderError {
  constructor(tenantId: string, providerName: string) {
    super(
      `Provider "${providerName}" already exists for tenant "${tenantId}"`,
      "PROVIDER_EXISTS",
      409,
    )
    this.name = "ProviderExistsError"
  }
}
