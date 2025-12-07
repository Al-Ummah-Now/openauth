# Phase 4: Dynamic Identity Providers Implementation

## Overview

Implement database-driven identity provider configuration, allowing tenants to manage their own OAuth/OIDC credentials at runtime.

## Architecture

```
Request → Tenant Context → DynamicProviderLoader → Cache Check
                                    ↓ (miss)
                          Load from DB → Decrypt Secret → ProviderFactory
                                    ↓
                          Create Provider Instance → Cache → Return
```

## Database Migration

### `/packages/openauth/src/migrations/006_identity_providers.sql`

```sql
-- Migration 006: Dynamic Identity Providers
-- Run with: wrangler d1 execute openauth-db --file=./src/migrations/006_identity_providers.sql

CREATE TABLE IF NOT EXISTS identity_providers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  client_id TEXT,
  client_secret_encrypted TEXT,
  client_secret_iv TEXT,
  config TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_identity_providers_tenant
  ON identity_providers(tenant_id);

CREATE INDEX IF NOT EXISTS idx_identity_providers_tenant_enabled
  ON identity_providers(tenant_id, enabled);

CREATE INDEX IF NOT EXISTS idx_identity_providers_type
  ON identity_providers(type);
```

## Files to Create

### 1. `/packages/openauth/src/dynamic-provider/types.ts`

```typescript
/**
 * Dynamic Identity Provider Types
 */

export type ProviderType =
  | "google" | "github" | "facebook" | "twitter" | "apple"
  | "microsoft" | "linkedin" | "discord" | "slack" | "spotify" | "twitch"
  | "oidc" | "password" | "magic_link" | "otp" | "saml" | "custom_oauth2"

export type ProviderCategory = "social" | "enterprise" | "passwordless" | "password"

export interface IdentityProviderRecord {
  id: string
  tenant_id: string
  type: ProviderType
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

// Provider-specific configs
export interface BaseProviderConfig {
  scopes?: string[]
  query?: Record<string, string>
}

export interface OAuth2ProviderConfig extends BaseProviderConfig {
  endpoints?: {
    authorization?: string
    token?: string
    jwks?: string
  }
  pkce?: boolean
}

export interface GoogleProviderConfig extends OAuth2ProviderConfig {
  hostedDomain?: string
  accessType?: "online" | "offline"
  prompt?: "none" | "consent" | "select_account"
}

export interface MicrosoftProviderConfig extends OAuth2ProviderConfig {
  tenant?: string
}

export interface OIDCProviderConfig extends BaseProviderConfig {
  issuer: string
  discoveryEndpoint?: string
}

export interface CustomOAuth2ProviderConfig extends OAuth2ProviderConfig {
  endpoints: {
    authorization: string
    token: string
    userinfo?: string
    jwks?: string
  }
  userIdPath?: string
  emailPath?: string
  namePath?: string
}

export type ProviderConfig =
  | GoogleProviderConfig
  | MicrosoftProviderConfig
  | OAuth2ProviderConfig
  | OIDCProviderConfig
  | CustomOAuth2ProviderConfig

// API Types
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

export interface UpdateProviderRequest {
  displayName?: string
  clientId?: string
  clientSecret?: string
  config?: Partial<ProviderConfig>
  enabled?: boolean
  displayOrder?: number
}

export interface ProviderResponse {
  id: string
  type: ProviderType
  name: string
  displayName: string
  clientId: string | null
  hasClientSecret: boolean
  config: ProviderConfig
  enabled: boolean
  displayOrder: number
  createdAt: string
  updatedAt: string
}

export interface ProviderListResponse {
  providers: ProviderResponse[]
  total: number
}

// Cache Types
export interface CacheEntry<T> {
  value: T
  expiresAt: number
}

// Encryption Types
export interface EncryptedValue {
  ciphertext: string
  iv: string
  tag: string
}

export interface LoadedProvider {
  config: IdentityProvider
  instance: any // Provider<any>
}
```

### 2. `/packages/openauth/src/dynamic-provider/encryption.ts`

```typescript
/**
 * AES-256-GCM Encryption Service for provider secrets
 */

import type { EncryptedValue } from "./types.js"

export interface EncryptionConfig {
  key: Uint8Array // 32 bytes for AES-256
}

export class EncryptionService {
  private readonly keyBytes: Uint8Array

  constructor(config: EncryptionConfig) {
    if (config.key.length !== 32) {
      throw new Error("Encryption key must be exactly 32 bytes (256 bits)")
    }
    this.keyBytes = config.key
  }

  private async getKey(): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      "raw",
      this.keyBytes,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    )
  }

  async encrypt(plaintext: string): Promise<EncryptedValue> {
    const key = await this.getKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encoder = new TextEncoder()
    const plaintextBytes = encoder.encode(plaintext)

    const ciphertextWithTag = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      key,
      plaintextBytes
    )

    const ciphertextBytes = new Uint8Array(ciphertextWithTag)
    const ciphertext = ciphertextBytes.slice(0, -16)
    const tag = ciphertextBytes.slice(-16)

    return {
      ciphertext: this.toBase64(ciphertext),
      iv: this.toBase64(iv),
      tag: this.toBase64(tag),
    }
  }

  async decrypt(encrypted: EncryptedValue): Promise<string> {
    const key = await this.getKey()
    const iv = this.fromBase64(encrypted.iv)
    const ciphertext = this.fromBase64(encrypted.ciphertext)
    const tag = this.fromBase64(encrypted.tag)

    const combined = new Uint8Array(ciphertext.length + tag.length)
    combined.set(ciphertext)
    combined.set(tag, ciphertext.length)

    try {
      const plaintextBytes = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, tagLength: 128 },
        key,
        combined
      )
      return new TextDecoder().decode(plaintextBytes)
    } catch {
      throw new Error("Decryption failed: Invalid key or corrupted data")
    }
  }

  async encryptForDB(plaintext: string): Promise<{ ciphertext: string; iv: string }> {
    const encrypted = await this.encrypt(plaintext)
    return {
      ciphertext: encrypted.ciphertext + "." + encrypted.tag,
      iv: encrypted.iv,
    }
  }

  async decryptFromDB(ciphertext: string, iv: string): Promise<string> {
    const [ct, tag] = ciphertext.split(".")
    if (!ct || !tag) throw new Error("Invalid encrypted format")
    return this.decrypt({ ciphertext: ct, iv, tag })
  }

  private toBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes))
  }

  private fromBase64(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
}

export function generateEncryptionKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length !== 64) {
    throw new Error("Encryption key must be 64 hex characters (32 bytes)")
  }
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes
}
```

### 3. `/packages/openauth/src/dynamic-provider/cache.ts`

```typescript
/**
 * TTL Cache with LRU eviction
 */

import type { CacheEntry } from "./types.js"

export interface CacheStats {
  hits: number
  misses: number
  size: number
  evictions: number
}

export class TTLCache<T> {
  private readonly cache = new Map<string, CacheEntry<T>>()
  private readonly maxSize: number
  private stats: CacheStats = { hits: 0, misses: 0, size: 0, evictions: 0 }

  constructor(options: { maxSize?: number } = {}) {
    this.maxSize = options.maxSize || 1000
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) {
      this.stats.misses++
      return undefined
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.stats.size--
      this.stats.misses++
      return undefined
    }
    this.stats.hits++
    return entry.value
  }

  set(key: string, value: T, ttlMs: number): void {
    if (this.cache.size >= this.maxSize) {
      this.evictExpired()
    }
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
        this.stats.evictions++
        this.stats.size--
      }
    }

    const isNew = !this.cache.has(key)
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs })
    if (isNew) this.stats.size++
  }

  delete(key: string): boolean {
    const existed = this.cache.delete(key)
    if (existed) this.stats.size--
    return existed
  }

  deleteByPrefix(prefix: string): number {
    let count = 0
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key)
        count++
        this.stats.size--
      }
    }
    return count
  }

  clear(): void {
    this.cache.clear()
    this.stats.size = 0
  }

  getStats(): CacheStats {
    return { ...this.stats }
  }

  private evictExpired(): number {
    const now = Date.now()
    let count = 0
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
        count++
        this.stats.size--
      }
    }
    return count
  }
}

export function providerCacheKey(tenantId: string, providerName: string): string {
  return `provider:${tenantId}:${providerName}`
}

export function tenantCacheKeyPrefix(tenantId: string): string {
  return `provider:${tenantId}:`
}
```

### 4. `/packages/openauth/src/dynamic-provider/defaults.ts`

```typescript
/**
 * Default OAuth2 endpoints for known providers
 */

export const PROVIDER_DEFAULTS: Record<string, {
  endpoints: { authorization: string; token: string; jwks?: string }
  defaultScopes: string[]
  pkce?: boolean
}> = {
  google: {
    endpoints: {
      authorization: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
      jwks: "https://www.googleapis.com/oauth2/v3/certs",
    },
    defaultScopes: ["openid", "email", "profile"],
  },
  github: {
    endpoints: {
      authorization: "https://github.com/login/oauth/authorize",
      token: "https://github.com/login/oauth/access_token",
    },
    defaultScopes: ["user:email"],
  },
  facebook: {
    endpoints: {
      authorization: "https://www.facebook.com/v18.0/dialog/oauth",
      token: "https://graph.facebook.com/v18.0/oauth/access_token",
    },
    defaultScopes: ["email", "public_profile"],
  },
  twitter: {
    endpoints: {
      authorization: "https://twitter.com/i/oauth2/authorize",
      token: "https://api.x.com/2/oauth2/token",
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
  },
  microsoft: {
    endpoints: {
      authorization: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
      token: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
    },
    defaultScopes: ["openid", "email", "profile"],
  },
  linkedin: {
    endpoints: {
      authorization: "https://www.linkedin.com/oauth/v2/authorization",
      token: "https://www.linkedin.com/oauth/v2/accessToken",
    },
    defaultScopes: ["openid", "profile", "email"],
  },
  discord: {
    endpoints: {
      authorization: "https://discord.com/oauth2/authorize",
      token: "https://discord.com/api/oauth2/token",
    },
    defaultScopes: ["identify", "email"],
  },
  slack: {
    endpoints: {
      authorization: "https://slack.com/openid/connect/authorize",
      token: "https://slack.com/api/openid.connect.token",
    },
    defaultScopes: ["openid", "email", "profile"],
  },
  spotify: {
    endpoints: {
      authorization: "https://accounts.spotify.com/authorize",
      token: "https://accounts.spotify.com/api/token",
    },
    defaultScopes: ["user-read-email", "user-read-private"],
  },
  twitch: {
    endpoints: {
      authorization: "https://id.twitch.tv/oauth2/authorize",
      token: "https://id.twitch.tv/oauth2/token",
    },
    defaultScopes: ["user:read:email"],
  },
}

export const PROVIDER_CATEGORIES: Record<string, string> = {
  google: "social",
  github: "social",
  facebook: "social",
  twitter: "social",
  apple: "social",
  microsoft: "enterprise",
  linkedin: "social",
  discord: "social",
  slack: "social",
  spotify: "social",
  twitch: "social",
  oidc: "enterprise",
  password: "password",
  magic_link: "passwordless",
  otp: "passwordless",
  saml: "enterprise",
  custom_oauth2: "enterprise",
}
```

### 5. `/packages/openauth/src/dynamic-provider/factory.ts`

```typescript
/**
 * Provider Factory - creates provider instances from DB config
 */

import type { IdentityProvider, ProviderConfig, ProviderType } from "./types.js"
import { PROVIDER_DEFAULTS } from "./defaults.js"

export function createProviderFromConfig(provider: IdentityProvider): any {
  if (!provider.clientId) {
    throw new Error(`Provider ${provider.name} is missing client_id`)
  }

  const defaults = PROVIDER_DEFAULTS[provider.type]
  if (!defaults && provider.type !== "oidc" && provider.type !== "custom_oauth2") {
    throw new Error(`Unsupported provider type: ${provider.type}`)
  }

  // For OAuth2-based providers, use the Oauth2Provider base
  // This would import and call the actual provider constructors
  // For now, return a placeholder structure
  return {
    type: provider.type,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    config: provider.config,
    defaults,
  }
}

export function validateProviderConfig(
  type: ProviderType,
  config: Partial<ProviderConfig>
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  switch (type) {
    case "oidc":
      if (!(config as any).issuer) {
        errors.push("OIDC provider requires 'issuer' in config")
      }
      break
    case "custom_oauth2":
      const customConfig = config as any
      if (!customConfig.endpoints?.authorization) {
        errors.push("Custom OAuth2 requires 'endpoints.authorization'")
      }
      if (!customConfig.endpoints?.token) {
        errors.push("Custom OAuth2 requires 'endpoints.token'")
      }
      break
    case "microsoft":
      const msConfig = config as any
      if (msConfig.tenant) {
        const validTenants = ["common", "organizations", "consumers"]
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(msConfig.tenant)
        if (!validTenants.includes(msConfig.tenant) && !isUUID) {
          errors.push("Microsoft tenant must be 'common', 'organizations', 'consumers', or a valid tenant ID")
        }
      }
      break
  }

  if (config.scopes && !Array.isArray(config.scopes)) {
    errors.push("Scopes must be an array of strings")
  }

  return { valid: errors.length === 0, errors }
}

export function getDefaultConfig(type: ProviderType): Partial<ProviderConfig> {
  const defaults = PROVIDER_DEFAULTS[type]
  if (!defaults) return {}
  return { scopes: defaults.defaultScopes || [] }
}
```

### 6. `/packages/openauth/src/dynamic-provider/loader.ts`

```typescript
/**
 * Dynamic Provider Loader with caching
 */

import type {
  IdentityProvider,
  IdentityProviderRecord,
  ProviderConfig,
  LoadedProvider,
} from "./types.js"
import { TTLCache, providerCacheKey, tenantCacheKeyPrefix } from "./cache.js"
import { EncryptionService } from "./encryption.js"
import { createProviderFromConfig } from "./factory.js"

export interface ProviderLoaderOptions {
  cacheTTL?: number
  encryptionKey: Uint8Array
  database: any // D1Database
}

export class DynamicProviderLoader {
  private readonly cache: TTLCache<LoadedProvider>
  private readonly encryption: EncryptionService
  private readonly db: any
  private readonly cacheTTL: number

  constructor(options: ProviderLoaderOptions) {
    this.cache = new TTLCache({ maxSize: 500 })
    this.encryption = new EncryptionService({ key: options.encryptionKey })
    this.db = options.database
    this.cacheTTL = options.cacheTTL || 60_000
  }

  async getProvider(tenantId: string, providerName: string): Promise<LoadedProvider | null> {
    const cacheKey = providerCacheKey(tenantId, providerName)
    const cached = this.cache.get(cacheKey)
    if (cached) return cached

    const record = await this.loadProviderRecord(tenantId, providerName)
    if (!record || !record.enabled) return null

    const provider = await this.parseRecord(record)
    const instance = createProviderFromConfig(provider)
    const loaded: LoadedProvider = { config: provider, instance }

    this.cache.set(cacheKey, loaded, this.cacheTTL)
    return loaded
  }

  async getProviders(tenantId: string): Promise<LoadedProvider[]> {
    const records = await this.loadProviderRecords(tenantId)
    const providers: LoadedProvider[] = []

    for (const record of records) {
      if (!record.enabled) continue

      const cacheKey = providerCacheKey(tenantId, record.name)
      let loaded = this.cache.get(cacheKey)

      if (!loaded) {
        const provider = await this.parseRecord(record)
        const instance = createProviderFromConfig(provider)
        loaded = { config: provider, instance }
        this.cache.set(cacheKey, loaded, this.cacheTTL)
      }

      providers.push(loaded)
    }

    return providers.sort((a, b) => a.config.displayOrder - b.config.displayOrder)
  }

  invalidateTenant(tenantId: string): void {
    this.cache.deleteByPrefix(tenantCacheKeyPrefix(tenantId))
  }

  invalidateProvider(tenantId: string, providerName: string): void {
    this.cache.delete(providerCacheKey(tenantId, providerName))
  }

  private async loadProviderRecord(tenantId: string, name: string): Promise<IdentityProviderRecord | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM identity_providers WHERE tenant_id = ? AND name = ?
    `)
    return stmt.bind(tenantId, name).first<IdentityProviderRecord>()
  }

  private async loadProviderRecords(tenantId: string): Promise<IdentityProviderRecord[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM identity_providers WHERE tenant_id = ? ORDER BY display_order ASC, name ASC
    `)
    const result = await stmt.bind(tenantId).all<IdentityProviderRecord>()
    return result.results || []
  }

  private async parseRecord(record: IdentityProviderRecord): Promise<IdentityProvider> {
    let clientSecret: string | null = null
    if (record.client_secret_encrypted && record.client_secret_iv) {
      try {
        clientSecret = await this.encryption.decryptFromDB(
          record.client_secret_encrypted,
          record.client_secret_iv
        )
      } catch (error) {
        console.error(`Failed to decrypt secret for provider ${record.id}:`, error)
        throw new Error(`Failed to decrypt client secret for provider: ${record.name}`)
      }
    }

    let config: ProviderConfig
    try {
      config = JSON.parse(record.config || "{}")
    } catch {
      config = {} as ProviderConfig
    }

    return {
      id: record.id,
      tenantId: record.tenant_id,
      type: record.type,
      name: record.name,
      displayName: record.display_name,
      clientId: record.client_id,
      clientSecret,
      config,
      enabled: record.enabled === 1,
      displayOrder: record.display_order,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    }
  }

  getCacheStats() {
    return this.cache.getStats()
  }
}

export function createDynamicProviderLoader(options: ProviderLoaderOptions): DynamicProviderLoader {
  return new DynamicProviderLoader(options)
}
```

### 7. `/packages/openauth/src/dynamic-provider/api.ts`

```typescript
/**
 * Dynamic Provider REST API
 */

import { Hono } from "hono"
import type {
  CreateProviderRequest,
  UpdateProviderRequest,
  ProviderResponse,
  ProviderListResponse,
  IdentityProviderRecord,
  ProviderType,
} from "./types.js"
import { EncryptionService } from "./encryption.js"
import { validateProviderConfig, getDefaultConfig } from "./factory.js"
import { PROVIDER_DEFAULTS, PROVIDER_CATEGORIES } from "./defaults.js"

export function createProviderApi(options: {
  database: any
  encryptionKey: Uint8Array
  onProviderChange?: (tenantId: string, providerName: string) => void
}): Hono {
  const app = new Hono()
  const encryption = new EncryptionService({ key: options.encryptionKey })

  function toResponse(record: IdentityProviderRecord): ProviderResponse {
    return {
      id: record.id,
      type: record.type as ProviderType,
      name: record.name,
      displayName: record.display_name,
      clientId: record.client_id,
      hasClientSecret: !!record.client_secret_encrypted,
      config: JSON.parse(record.config || "{}"),
      enabled: record.enabled === 1,
      displayOrder: record.display_order,
      createdAt: new Date(record.created_at).toISOString(),
      updatedAt: new Date(record.updated_at).toISOString(),
    }
  }

  // GET / - List providers
  app.get("/", async (c) => {
    const tenantId = c.get("tenantId")
    if (!tenantId) return c.json({ error: "Tenant not found" }, 404)

    const stmt = options.database.prepare(`
      SELECT * FROM identity_providers WHERE tenant_id = ? ORDER BY display_order ASC, name ASC
    `)
    const result = await stmt.bind(tenantId).all<IdentityProviderRecord>()
    const providers = (result.results || []).map(toResponse)

    return c.json({ providers, total: providers.length } as ProviderListResponse)
  })

  // POST / - Create provider
  app.post("/", async (c) => {
    const tenantId = c.get("tenantId")
    if (!tenantId) return c.json({ error: "Tenant not found" }, 404)

    const body = await c.req.json<CreateProviderRequest>()

    if (!body.type || !body.name || !body.displayName) {
      return c.json({ error: "Missing required fields: type, name, displayName" }, 400)
    }

    if (!PROVIDER_DEFAULTS[body.type] && !["oidc", "custom_oauth2", "password", "magic_link", "otp", "saml"].includes(body.type)) {
      return c.json({ error: `Invalid provider type: ${body.type}` }, 400)
    }

    if (!/^[a-z0-9_-]+$/.test(body.name)) {
      return c.json({ error: "Provider name must be lowercase alphanumeric with hyphens/underscores" }, 400)
    }

    const existing = await options.database
      .prepare("SELECT id FROM identity_providers WHERE tenant_id = ? AND name = ?")
      .bind(tenantId, body.name)
      .first()
    if (existing) {
      return c.json({ error: `Provider with name "${body.name}" already exists` }, 409)
    }

    const defaultConfig = getDefaultConfig(body.type as ProviderType)
    const config = { ...defaultConfig, ...body.config }

    const validation = validateProviderConfig(body.type as ProviderType, config)
    if (!validation.valid) {
      return c.json({ error: "Invalid configuration", details: validation.errors }, 400)
    }

    let encryptedSecret: string | null = null
    let secretIv: string | null = null
    if (body.clientSecret) {
      const encrypted = await encryption.encryptForDB(body.clientSecret)
      encryptedSecret = encrypted.ciphertext
      secretIv = encrypted.iv
    }

    const id = crypto.randomUUID()
    const now = Date.now()

    await options.database.prepare(`
      INSERT INTO identity_providers (
        id, tenant_id, type, name, display_name,
        client_id, client_secret_encrypted, client_secret_iv,
        config, enabled, display_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, tenantId, body.type, body.name, body.displayName,
      body.clientId || null, encryptedSecret, secretIv,
      JSON.stringify(config), body.enabled !== false ? 1 : 0,
      body.displayOrder || 0, now, now
    ).run()

    options.onProviderChange?.(tenantId, body.name)

    const record = await options.database
      .prepare("SELECT * FROM identity_providers WHERE id = ?")
      .bind(id)
      .first<IdentityProviderRecord>()

    return c.json(toResponse(record!), 201)
  })

  // GET /:id - Get provider
  app.get("/:id", async (c) => {
    const tenantId = c.get("tenantId")
    if (!tenantId) return c.json({ error: "Tenant not found" }, 404)

    const id = c.req.param("id")
    const record = await options.database
      .prepare("SELECT * FROM identity_providers WHERE id = ? AND tenant_id = ?")
      .bind(id, tenantId)
      .first<IdentityProviderRecord>()

    if (!record) return c.json({ error: "Provider not found" }, 404)
    return c.json(toResponse(record))
  })

  // PATCH /:id - Update provider
  app.patch("/:id", async (c) => {
    const tenantId = c.get("tenantId")
    if (!tenantId) return c.json({ error: "Tenant not found" }, 404)

    const id = c.req.param("id")
    const body = await c.req.json<UpdateProviderRequest>()

    const existing = await options.database
      .prepare("SELECT * FROM identity_providers WHERE id = ? AND tenant_id = ?")
      .bind(id, tenantId)
      .first<IdentityProviderRecord>()

    if (!existing) return c.json({ error: "Provider not found" }, 404)

    const updates: string[] = []
    const values: any[] = []

    if (body.displayName !== undefined) {
      updates.push("display_name = ?")
      values.push(body.displayName)
    }
    if (body.clientId !== undefined) {
      updates.push("client_id = ?")
      values.push(body.clientId)
    }
    if (body.clientSecret !== undefined) {
      if (body.clientSecret === "") {
        updates.push("client_secret_encrypted = NULL, client_secret_iv = NULL")
      } else {
        const encrypted = await encryption.encryptForDB(body.clientSecret)
        updates.push("client_secret_encrypted = ?, client_secret_iv = ?")
        values.push(encrypted.ciphertext, encrypted.iv)
      }
    }
    if (body.config !== undefined) {
      const existingConfig = JSON.parse(existing.config || "{}")
      const newConfig = { ...existingConfig, ...body.config }
      const validation = validateProviderConfig(existing.type as ProviderType, newConfig)
      if (!validation.valid) {
        return c.json({ error: "Invalid configuration", details: validation.errors }, 400)
      }
      updates.push("config = ?")
      values.push(JSON.stringify(newConfig))
    }
    if (body.enabled !== undefined) {
      updates.push("enabled = ?")
      values.push(body.enabled ? 1 : 0)
    }
    if (body.displayOrder !== undefined) {
      updates.push("display_order = ?")
      values.push(body.displayOrder)
    }

    if (updates.length === 0) {
      return c.json({ error: "No updates provided" }, 400)
    }

    updates.push("updated_at = ?")
    values.push(Date.now(), id, tenantId)

    await options.database.prepare(`
      UPDATE identity_providers SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?
    `).bind(...values).run()

    options.onProviderChange?.(tenantId, existing.name)

    const updated = await options.database
      .prepare("SELECT * FROM identity_providers WHERE id = ?")
      .bind(id)
      .first<IdentityProviderRecord>()

    return c.json(toResponse(updated!))
  })

  // DELETE /:id - Delete provider
  app.delete("/:id", async (c) => {
    const tenantId = c.get("tenantId")
    if (!tenantId) return c.json({ error: "Tenant not found" }, 404)

    const id = c.req.param("id")
    const existing = await options.database
      .prepare("SELECT name FROM identity_providers WHERE id = ? AND tenant_id = ?")
      .bind(id, tenantId)
      .first<{ name: string }>()

    if (!existing) return c.json({ error: "Provider not found" }, 404)

    await options.database
      .prepare("DELETE FROM identity_providers WHERE id = ? AND tenant_id = ?")
      .bind(id, tenantId)
      .run()

    options.onProviderChange?.(tenantId, existing.name)
    return c.json({ success: true })
  })

  // GET /types - List available provider types
  app.get("/types", async (c) => {
    const types = Object.entries(PROVIDER_DEFAULTS).map(([type, config]) => ({
      type,
      category: PROVIDER_CATEGORIES[type],
      displayName: type.charAt(0).toUpperCase() + type.slice(1),
      defaultScopes: config.defaultScopes,
      requiresClientSecret: true,
    }))

    types.push(
      { type: "oidc", category: "enterprise", displayName: "OpenID Connect", defaultScopes: [], requiresClientSecret: false },
      { type: "custom_oauth2", category: "enterprise", displayName: "Custom OAuth2", defaultScopes: [], requiresClientSecret: true }
    )

    return c.json({ types })
  })

  return app
}
```

### 8. `/packages/openauth/src/dynamic-provider/index.ts`

```typescript
export * from "./types.js"
export { EncryptionService, generateEncryptionKey, hexToBytes } from "./encryption.js"
export { TTLCache, providerCacheKey, tenantCacheKeyPrefix } from "./cache.js"
export { PROVIDER_DEFAULTS, PROVIDER_CATEGORIES } from "./defaults.js"
export { createProviderFromConfig, validateProviderConfig, getDefaultConfig } from "./factory.js"
export { DynamicProviderLoader, createDynamicProviderLoader } from "./loader.js"
export type { ProviderLoaderOptions } from "./loader.js"
export { createProviderApi } from "./api.js"
```

## API Endpoints

| Method | Endpoint | Description | Scope |
|--------|----------|-------------|-------|
| GET | /api/providers | List tenant providers | providers:read |
| POST | /api/providers | Create provider | providers:write |
| GET | /api/providers/:id | Get provider (secrets masked) | providers:read |
| PATCH | /api/providers/:id | Update provider | providers:write |
| DELETE | /api/providers/:id | Delete provider | providers:write |
| GET | /api/providers/types | List available types | providers:read |

## Security

- **AES-256-GCM encryption** for client secrets at rest
- **Unique IV per encryption** operation
- **Never return actual secrets** in API responses
- **`hasClientSecret` boolean** indicates if secret is configured
- **1-minute cache TTL** limits exposure of decrypted secrets in memory

## Checklist

- [ ] Create migration `006_identity_providers.sql`
- [ ] Create `/packages/openauth/src/dynamic-provider/types.ts`
- [ ] Create `/packages/openauth/src/dynamic-provider/encryption.ts`
- [ ] Create `/packages/openauth/src/dynamic-provider/cache.ts`
- [ ] Create `/packages/openauth/src/dynamic-provider/defaults.ts`
- [ ] Create `/packages/openauth/src/dynamic-provider/factory.ts`
- [ ] Create `/packages/openauth/src/dynamic-provider/loader.ts`
- [ ] Create `/packages/openauth/src/dynamic-provider/api.ts`
- [ ] Create `/packages/openauth/src/dynamic-provider/index.ts`
- [ ] Write unit tests for encryption
- [ ] Write unit tests for cache
- [ ] Write integration tests for API
- [ ] Integrate with enterprise issuer
