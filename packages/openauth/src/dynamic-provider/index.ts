/**
 * Dynamic Identity Providers Module
 *
 * Provides database-driven identity provider configuration for multi-tenant
 * authentication. Allows tenants to manage their own OAuth/OIDC credentials
 * at runtime without code changes.
 *
 * ## Features
 *
 * - Store provider configurations in D1 database
 * - AES-256-GCM encryption for client secrets at rest
 * - TTL cache with LRU eviction for performance
 * - Support for all 18+ provider types
 * - CRUD API for provider management
 * - Tenant-level isolation and cache invalidation
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   createProviderApi,
 *   createDynamicProviderLoader,
 *   hexToBytes
 * } from "@openauthjs/openauth/dynamic-provider"
 *
 * // Create provider loader
 * const loader = createDynamicProviderLoader({
 *   database: env.DB,
 *   encryptionKey: hexToBytes(env.ENCRYPTION_KEY),
 *   cacheTTL: 60_000 // 1 minute
 * })
 *
 * // Load providers for a tenant
 * const providers = await loader.getProviders(tenantId)
 *
 * // Create management API
 * const providerApi = createProviderApi({
 *   database: env.DB,
 *   encryptionKey: hexToBytes(env.ENCRYPTION_KEY),
 *   onProviderChange: (tenantId, name) => loader.invalidateProvider(tenantId, name)
 * })
 *
 * // Mount on your Hono app
 * app.route("/api/providers", providerApi)
 * ```
 *
 * ## Database Migration
 *
 * Run the migration to create the identity_providers table:
 *
 * ```bash
 * wrangler d1 execute DB --file=./src/migrations/006_identity_providers.sql
 * ```
 *
 * ## Security
 *
 * - Client secrets are encrypted with AES-256-GCM
 * - Unique IV for each encryption operation
 * - Secrets are never exposed in API responses
 * - 60-second cache TTL limits secret exposure in memory
 *
 * @packageDocumentation
 */

// Types
export type {
  ProviderType,
  ProviderCategory,
  IdentityProviderRecord,
  IdentityProvider,
  BaseProviderConfig,
  OAuth2ProviderConfig,
  GoogleProviderConfig,
  MicrosoftProviderConfig,
  AppleProviderConfig,
  SlackProviderConfig,
  CognitoProviderConfig,
  KeycloakProviderConfig,
  OIDCProviderConfig,
  CustomOAuth2ProviderConfig,
  PasswordProviderConfig,
  ProviderConfig,
  CreateProviderRequest,
  UpdateProviderRequest,
  ProviderResponse,
  ProviderListResponse,
  ProviderTypeInfo,
  ProviderTypesResponse,
  CacheEntry,
  EncryptedValue,
  LoadedProvider,
} from "./types.js"

// Error types
export {
  DynamicProviderError,
  ProviderNotFoundError,
  ProviderConfigError,
  EncryptionError,
  ProviderExistsError,
} from "./types.js"

// Encryption
export {
  EncryptionService,
  generateEncryptionKey,
  hexToBytes,
  bytesToHex,
  maskSecret,
} from "./encryption.js"
export type { EncryptionConfig } from "./encryption.js"

// Cache
export {
  TTLCache,
  providerCacheKey,
  tenantCacheKeyPrefix,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_CACHE_MAX_SIZE,
} from "./cache.js"
export type { CacheStats, CacheOptions } from "./cache.js"

// Defaults
export {
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
export type { ProviderDefaults } from "./defaults.js"

// Factory
export {
  createProviderFromConfig,
  validateProviderConfig,
  getDefaultConfig,
  mergeWithDefaults,
} from "./factory.js"
export type { ValidationResult } from "./factory.js"

// Loader
export {
  DynamicProviderLoader,
  createDynamicProviderLoader,
} from "./loader.js"
export type { ProviderLoaderOptions } from "./loader.js"

// API
export {
  createProviderApi,
  providerApiMiddleware,
} from "./api.js"
export type { ProviderApiOptions } from "./api.js"
