/**
 * Dynamic Provider REST API
 *
 * CRUD API routes for managing identity provider configurations.
 * Designed to be mounted on a Hono app instance.
 *
 * Endpoints:
 * - GET    /              List all providers for tenant
 * - POST   /              Create a new provider
 * - GET    /:id           Get a specific provider
 * - PATCH  /:id           Update a provider
 * - DELETE /:id           Delete a provider
 * - GET    /types         List available provider types
 *
 * @packageDocumentation
 */

import { Hono } from "hono"
import type { Context } from "hono"
import type {
  CreateProviderRequest,
  UpdateProviderRequest,
  ProviderResponse,
  ProviderListResponse,
  IdentityProviderRecord,
  ProviderType,
  ProviderTypesResponse,
  ProviderTypeInfo,
} from "./types.js"
import { EncryptionService, maskSecret } from "./encryption.js"
import { validateProviderConfig, getDefaultConfig } from "./factory.js"
import {
  PROVIDER_DEFAULTS,
  PROVIDER_CATEGORIES,
  PROVIDER_DISPLAY_NAMES,
  OIDC_CAPABLE_PROVIDERS,
  NO_SECRET_REQUIRED_PROVIDERS,
  getDefaultScopes,
} from "./defaults.js"

/**
 * Options for creating the provider API
 */
export interface ProviderApiOptions {
  /** D1 database instance */
  database: D1Database
  /** 32-byte encryption key for client secrets */
  encryptionKey: Uint8Array
  /** Callback when a provider is created, updated, or deleted */
  onProviderChange?: (tenantId: string, providerName: string) => void
  /** Function to extract tenant ID from request context */
  getTenantId?: (c: Context) => string | null
}

/**
 * D1 database interface (Cloudflare Workers)
 */
interface D1Database {
  prepare(query: string): D1PreparedStatement
}

interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<{ results: T[] }>
  run(): Promise<{ success: boolean }>
}

/**
 * Valid provider type values for validation
 */
const VALID_PROVIDER_TYPES = new Set<string>([
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
])

/**
 * Convert database record to API response format
 */
function toResponse(record: IdentityProviderRecord): ProviderResponse {
  let config: Record<string, unknown>
  try {
    config = JSON.parse(record.config || "{}")
  } catch {
    config = {}
  }

  return {
    id: record.id,
    type: record.type as ProviderType,
    name: record.name,
    displayName: record.display_name,
    clientId: record.client_id,
    hasClientSecret: !!record.client_secret_encrypted,
    clientSecretMasked: record.client_secret_encrypted
      ? maskSecret("configured") // Just indicate it exists
      : null,
    config,
    enabled: record.enabled === 1,
    displayOrder: record.display_order,
    createdAt: new Date(record.created_at).toISOString(),
    updatedAt: new Date(record.updated_at).toISOString(),
  }
}

/**
 * Validate provider name format
 */
function isValidProviderName(name: string): boolean {
  return /^[a-z][a-z0-9_-]*$/.test(name) && name.length <= 64
}

/**
 * Create the provider management API
 *
 * @param options - API configuration
 * @returns Hono app with provider routes
 */
export function createProviderApi(options: ProviderApiOptions): Hono {
  const app = new Hono()
  const encryption = new EncryptionService({ key: options.encryptionKey })

  // Default tenant ID extractor
  const getTenantId = options.getTenantId || ((c: Context) => c.get("tenantId"))

  /**
   * Helper to get tenant ID with error response
   */
  function requireTenantId(c: Context): string | null {
    const tenantId = getTenantId(c)
    if (!tenantId) {
      return null
    }
    return tenantId
  }

  // ==========================================
  // GET /types - List available provider types
  // ==========================================
  app.get("/types", async (c) => {
    const types: ProviderTypeInfo[] = []

    // Add all standard providers
    for (const [type, defaults] of Object.entries(PROVIDER_DEFAULTS)) {
      types.push({
        type: type as ProviderType,
        category: PROVIDER_CATEGORIES[type] || "enterprise",
        displayName: PROVIDER_DISPLAY_NAMES[type] || type,
        defaultScopes: defaults.defaultScopes,
        requiresClientSecret: !NO_SECRET_REQUIRED_PROVIDERS.has(type),
        supportsOidc: OIDC_CAPABLE_PROVIDERS.has(type),
      })
    }

    // Add special types not in PROVIDER_DEFAULTS
    types.push({
      type: "oidc",
      category: "enterprise",
      displayName: "OpenID Connect",
      defaultScopes: ["openid", "email", "profile"],
      requiresClientSecret: false,
      supportsOidc: true,
    })

    types.push({
      type: "custom_oauth2",
      category: "enterprise",
      displayName: "Custom OAuth2",
      defaultScopes: [],
      requiresClientSecret: true,
      supportsOidc: false,
    })

    types.push({
      type: "password",
      category: "password",
      displayName: "Password",
      defaultScopes: [],
      requiresClientSecret: false,
      supportsOidc: false,
    })

    types.push({
      type: "code",
      category: "passwordless",
      displayName: "One-Time Code",
      defaultScopes: [],
      requiresClientSecret: false,
      supportsOidc: false,
    })

    // Sort by category then display name
    types.sort((a, b) => {
      const catOrder = { social: 0, enterprise: 1, passwordless: 2, password: 3 }
      const catDiff =
        (catOrder[a.category] || 99) - (catOrder[b.category] || 99)
      if (catDiff !== 0) return catDiff
      return a.displayName.localeCompare(b.displayName)
    })

    return c.json({ types } as ProviderTypesResponse)
  })

  // ==========================================
  // GET / - List providers for tenant
  // ==========================================
  app.get("/", async (c) => {
    const tenantId = requireTenantId(c)
    if (!tenantId) {
      return c.json({ error: "Tenant not found" }, 404)
    }

    const stmt = options.database.prepare(`
      SELECT * FROM identity_providers
      WHERE tenant_id = ?
      ORDER BY display_order ASC, name ASC
    `)
    const result = await stmt.bind(tenantId).all<IdentityProviderRecord>()
    const providers = (result.results || []).map(toResponse)

    return c.json({
      providers,
      total: providers.length,
    } as ProviderListResponse)
  })

  // ==========================================
  // POST / - Create a new provider
  // ==========================================
  app.post("/", async (c) => {
    const tenantId = requireTenantId(c)
    if (!tenantId) {
      return c.json({ error: "Tenant not found" }, 404)
    }

    let body: CreateProviderRequest
    try {
      body = await c.req.json<CreateProviderRequest>()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    // Validate required fields
    if (!body.type || !body.name || !body.displayName) {
      return c.json(
        { error: "Missing required fields: type, name, displayName" },
        400,
      )
    }

    // Validate provider type
    if (!VALID_PROVIDER_TYPES.has(body.type)) {
      return c.json(
        {
          error: `Invalid provider type: ${body.type}`,
          validTypes: Array.from(VALID_PROVIDER_TYPES),
        },
        400,
      )
    }

    // Validate provider name format
    if (!isValidProviderName(body.name)) {
      return c.json(
        {
          error:
            "Provider name must start with a letter and contain only lowercase letters, numbers, hyphens, and underscores (max 64 chars)",
        },
        400,
      )
    }

    // Check for duplicate name
    const existing = await options.database
      .prepare(
        "SELECT id FROM identity_providers WHERE tenant_id = ? AND name = ?",
      )
      .bind(tenantId, body.name)
      .first()
    if (existing) {
      return c.json(
        { error: `Provider with name "${body.name}" already exists` },
        409,
      )
    }

    // Merge with default config
    const defaultConfig = getDefaultConfig(body.type as ProviderType)
    const config = { ...defaultConfig, ...body.config }

    // Validate provider-specific config
    const validation = validateProviderConfig(body.type as ProviderType, config)
    if (!validation.valid) {
      return c.json(
        { error: "Invalid configuration", details: validation.errors },
        400,
      )
    }

    // Encrypt client secret if provided
    let encryptedSecret: string | null = null
    let secretIv: string | null = null
    if (body.clientSecret) {
      const encrypted = await encryption.encryptForDB(body.clientSecret)
      encryptedSecret = encrypted.ciphertext
      secretIv = encrypted.iv
    }

    // Generate ID and timestamps
    const id = crypto.randomUUID()
    const now = Date.now()

    // Insert into database
    await options.database
      .prepare(
        `
      INSERT INTO identity_providers (
        id, tenant_id, type, name, display_name,
        client_id, client_secret_encrypted, client_secret_iv,
        config, enabled, display_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .bind(
        id,
        tenantId,
        body.type,
        body.name,
        body.displayName,
        body.clientId || null,
        encryptedSecret,
        secretIv,
        JSON.stringify(config),
        body.enabled !== false ? 1 : 0,
        body.displayOrder || 0,
        now,
        now,
      )
      .run()

    // Notify change
    options.onProviderChange?.(tenantId, body.name)

    // Fetch and return the created record
    const record = await options.database
      .prepare("SELECT * FROM identity_providers WHERE id = ?")
      .bind(id)
      .first<IdentityProviderRecord>()

    return c.json(toResponse(record!), 201)
  })

  // ==========================================
  // GET /:id - Get a specific provider
  // ==========================================
  app.get("/:id", async (c) => {
    const tenantId = requireTenantId(c)
    if (!tenantId) {
      return c.json({ error: "Tenant not found" }, 404)
    }

    const id = c.req.param("id")
    const record = await options.database
      .prepare(
        "SELECT * FROM identity_providers WHERE id = ? AND tenant_id = ?",
      )
      .bind(id, tenantId)
      .first<IdentityProviderRecord>()

    if (!record) {
      return c.json({ error: "Provider not found" }, 404)
    }

    return c.json(toResponse(record))
  })

  // ==========================================
  // PATCH /:id - Update a provider
  // ==========================================
  app.patch("/:id", async (c) => {
    const tenantId = requireTenantId(c)
    if (!tenantId) {
      return c.json({ error: "Tenant not found" }, 404)
    }

    const id = c.req.param("id")

    let body: UpdateProviderRequest
    try {
      body = await c.req.json<UpdateProviderRequest>()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    // Get existing provider
    const existing = await options.database
      .prepare(
        "SELECT * FROM identity_providers WHERE id = ? AND tenant_id = ?",
      )
      .bind(id, tenantId)
      .first<IdentityProviderRecord>()

    if (!existing) {
      return c.json({ error: "Provider not found" }, 404)
    }

    // Build update query dynamically
    const updates: string[] = []
    const values: any[] = []

    if (body.displayName !== undefined) {
      updates.push("display_name = ?")
      values.push(body.displayName)
    }

    if (body.clientId !== undefined) {
      updates.push("client_id = ?")
      values.push(body.clientId || null)
    }

    if (body.clientSecret !== undefined) {
      if (body.clientSecret === "" || body.clientSecret === null) {
        // Remove secret
        updates.push("client_secret_encrypted = NULL")
        updates.push("client_secret_iv = NULL")
      } else {
        // Encrypt new secret
        const encrypted = await encryption.encryptForDB(body.clientSecret)
        updates.push("client_secret_encrypted = ?")
        values.push(encrypted.ciphertext)
        updates.push("client_secret_iv = ?")
        values.push(encrypted.iv)
      }
    }

    if (body.config !== undefined) {
      // Merge with existing config
      let existingConfig: Record<string, unknown>
      try {
        existingConfig = JSON.parse(existing.config || "{}")
      } catch {
        existingConfig = {}
      }
      const newConfig = { ...existingConfig, ...body.config }

      // Validate merged config
      const validation = validateProviderConfig(
        existing.type as ProviderType,
        newConfig,
      )
      if (!validation.valid) {
        return c.json(
          { error: "Invalid configuration", details: validation.errors },
          400,
        )
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

    // Check if there are any updates
    if (updates.length === 0) {
      return c.json({ error: "No updates provided" }, 400)
    }

    // Add updated_at
    updates.push("updated_at = ?")
    values.push(Date.now())

    // Add WHERE clause values
    values.push(id, tenantId)

    // Execute update
    await options.database
      .prepare(
        `UPDATE identity_providers SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .bind(...values)
      .run()

    // Notify change
    options.onProviderChange?.(tenantId, existing.name)

    // Fetch and return updated record
    const updated = await options.database
      .prepare("SELECT * FROM identity_providers WHERE id = ?")
      .bind(id)
      .first<IdentityProviderRecord>()

    return c.json(toResponse(updated!))
  })

  // ==========================================
  // DELETE /:id - Delete a provider
  // ==========================================
  app.delete("/:id", async (c) => {
    const tenantId = requireTenantId(c)
    if (!tenantId) {
      return c.json({ error: "Tenant not found" }, 404)
    }

    const id = c.req.param("id")

    // Get provider name for cache invalidation
    const existing = await options.database
      .prepare(
        "SELECT name FROM identity_providers WHERE id = ? AND tenant_id = ?",
      )
      .bind(id, tenantId)
      .first<{ name: string }>()

    if (!existing) {
      return c.json({ error: "Provider not found" }, 404)
    }

    // Delete the provider
    await options.database
      .prepare(
        "DELETE FROM identity_providers WHERE id = ? AND tenant_id = ?",
      )
      .bind(id, tenantId)
      .run()

    // Notify change
    options.onProviderChange?.(tenantId, existing.name)

    return c.json({ success: true, deleted: id })
  })

  return app
}

/**
 * Create provider API middleware that adds tenant context
 *
 * @param tenantIdHeader - Header name containing tenant ID (default: "x-tenant-id")
 * @returns Middleware function
 */
export function providerApiMiddleware(tenantIdHeader = "x-tenant-id") {
  return async (c: Context, next: () => Promise<void>) => {
    const tenantId = c.req.header(tenantIdHeader)
    if (tenantId) {
      c.set("tenantId", tenantId)
    }
    await next()
  }
}
