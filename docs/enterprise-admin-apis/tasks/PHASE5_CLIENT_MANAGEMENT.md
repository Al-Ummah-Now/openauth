# Phase 5: OAuth Client Management Implementation

## Overview

Implement comprehensive OAuth client CRUD APIs with secure secret handling, rotation support, and tenant isolation.

## Database Schema

Uses existing `oauth_clients` table from migrations. Ensure it has:

```sql
-- Existing oauth_clients table (from 004_oauth_clients.sql)
CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  client_secret_hash TEXT NOT NULL,
  grant_types TEXT NOT NULL DEFAULT '["client_credentials"]',
  scopes TEXT NOT NULL DEFAULT '[]',
  redirect_uris TEXT DEFAULT '[]',
  metadata TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  rotated_at INTEGER,
  previous_secret_hash TEXT,
  previous_secret_expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_oauth_clients_tenant ON oauth_clients(tenant_id);
```

## Files to Create

### 1. `/packages/openauth/src/client/types.ts`

```typescript
/**
 * OAuth Client Management Types
 */

/**
 * Stored OAuth client (database representation)
 */
export interface OAuthClient {
  id: string
  tenant_id: string
  name: string
  client_secret_hash: string
  grant_types: string[]
  scopes: string[]
  redirect_uris: string[]
  metadata: Record<string, unknown>
  enabled: boolean
  created_at: number
  updated_at: number
  rotated_at?: number
  previous_secret_hash?: string
  previous_secret_expires_at?: number
}

/**
 * Client for API responses (no secret)
 */
export interface OAuthClientResponse {
  id: string
  tenant_id: string
  name: string
  grant_types: string[]
  scopes: string[]
  redirect_uris: string[]
  metadata: Record<string, unknown>
  enabled: boolean
  created_at: number
  updated_at: number
  rotated_at?: number
}

/**
 * Client creation response (includes plain secret once)
 */
export interface OAuthClientCreatedResponse extends OAuthClientResponse {
  client_secret: string
}

/**
 * Client rotation response
 */
export interface OAuthClientRotatedResponse extends OAuthClientResponse {
  client_secret: string
  previous_secret_expires_at: number
}

/**
 * Request to create a client
 */
export interface CreateClientRequest {
  name: string
  grant_types?: string[]
  scopes?: string[]
  redirect_uris?: string[]
  metadata?: Record<string, unknown>
  enabled?: boolean
}

/**
 * Request to update a client
 */
export interface UpdateClientRequest {
  name?: string
  grant_types?: string[]
  scopes?: string[]
  redirect_uris?: string[]
  metadata?: Record<string, unknown>
  enabled?: boolean
}

/**
 * Request to rotate client secret
 */
export interface RotateSecretRequest {
  /**
   * Grace period in seconds for old secret to remain valid
   * @default 3600 (1 hour)
   */
  grace_period_seconds?: number
}

/**
 * Pagination parameters
 */
export interface ListClientsParams {
  cursor?: string
  limit?: number
  enabled?: boolean
}

/**
 * Paginated response
 */
export interface PaginatedClientsResponse {
  clients: OAuthClientResponse[]
  next_cursor?: string
  has_more: boolean
}
```

### 2. `/packages/openauth/src/client/errors.ts`

```typescript
/**
 * OAuth Client Management Errors
 */

export class ClientError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
    this.name = "ClientError"
  }
}

export class ClientNotFoundError extends ClientError {
  constructor(clientId: string) {
    super("client_not_found", `Client not found: ${clientId}`)
  }
}

export class ClientNameConflictError extends ClientError {
  constructor(name: string) {
    super("client_name_conflict", `Client with name "${name}" already exists`)
  }
}

export class InvalidGrantTypeError extends ClientError {
  constructor(grantType: string) {
    super(
      "invalid_grant_type",
      `Invalid grant type: ${grantType}. Allowed: client_credentials, authorization_code, refresh_token`
    )
  }
}

export class InvalidScopeFormatError extends ClientError {
  constructor(scope: string) {
    super(
      "invalid_scope_format",
      `Invalid scope format: ${scope}. Must match pattern: ^[a-zA-Z0-9_:.\\-]+$`
    )
  }
}

export class InvalidRedirectUriError extends ClientError {
  constructor(uri: string) {
    super("invalid_redirect_uri", `Invalid redirect URI: ${uri}`)
  }
}

export class ClientDisabledError extends ClientError {
  constructor(clientId: string) {
    super("client_disabled", `Client is disabled: ${clientId}`)
  }
}
```

### 3. `/packages/openauth/src/client/secret-generator.ts`

```typescript
/**
 * Secure client secret generation and hashing
 */

const SECRET_BYTE_LENGTH = 32 // 256 bits
const PBKDF2_ITERATIONS = 100_000
const SALT_BYTE_LENGTH = 16

/**
 * Generate a cryptographically secure client secret
 */
export function generateClientSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SECRET_BYTE_LENGTH))
  return bytesToBase64Url(bytes)
}

/**
 * Generate a client ID with prefix
 */
export function generateClientId(prefix = "client"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return `${prefix}_${bytesToBase64Url(bytes)}`
}

/**
 * Hash a client secret using PBKDF2-SHA256
 */
export async function hashClientSecret(secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH))
  const encoder = new TextEncoder()
  const secretBytes = encoder.encode(secret)

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    "PBKDF2",
    false,
    ["deriveBits"]
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  )

  const hash = new Uint8Array(derivedBits)

  // Format: $pbkdf2-sha256$iterations$salt$hash
  return `$pbkdf2-sha256$${PBKDF2_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`
}

/**
 * Verify a client secret against a hash
 */
export async function verifyClientSecret(
  secret: string,
  storedHash: string
): Promise<boolean> {
  const parts = storedHash.split("$")
  if (parts.length !== 5 || parts[1] !== "pbkdf2-sha256") {
    return false
  }

  const iterations = parseInt(parts[2], 10)
  const salt = base64UrlToBytes(parts[3])
  const expectedHash = base64UrlToBytes(parts[4])

  const encoder = new TextEncoder()
  const secretBytes = encoder.encode(secret)

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    "PBKDF2",
    false,
    ["deriveBits"]
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  )

  const actualHash = new Uint8Array(derivedBits)

  // Constant-time comparison
  return timingSafeEqual(actualHash, expectedHash)
}

/**
 * Convert bytes to URL-safe base64
 */
function bytesToBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

/**
 * Convert URL-safe base64 to bytes
 */
function base64UrlToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)))
}

/**
 * Constant-time comparison to prevent timing attacks
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i]
  }
  return result === 0
}
```

### 4. `/packages/openauth/src/client/validation.ts`

```typescript
/**
 * Client input validation
 */

import {
  InvalidGrantTypeError,
  InvalidScopeFormatError,
  InvalidRedirectUriError,
} from "./errors.js"

const ALLOWED_GRANT_TYPES = [
  "client_credentials",
  "authorization_code",
  "refresh_token",
]

const SCOPE_PATTERN = /^[a-zA-Z0-9_:.\-]+$/
const NAME_PATTERN = /^[a-zA-Z0-9_\-\s]+$/
const MAX_NAME_LENGTH = 100
const MAX_SCOPES = 50
const MAX_REDIRECT_URIS = 10

/**
 * Validate client name
 */
export function validateClientName(name: string): void {
  if (!name || typeof name !== "string") {
    throw new Error("Client name is required")
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`Client name must be ${MAX_NAME_LENGTH} characters or less`)
  }
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      "Client name must contain only alphanumeric characters, spaces, hyphens, and underscores"
    )
  }
}

/**
 * Validate grant types
 */
export function validateGrantTypes(grantTypes: string[]): void {
  if (!Array.isArray(grantTypes)) {
    throw new Error("grant_types must be an array")
  }
  for (const grantType of grantTypes) {
    if (!ALLOWED_GRANT_TYPES.includes(grantType)) {
      throw new InvalidGrantTypeError(grantType)
    }
  }
}

/**
 * Validate scopes
 */
export function validateScopes(scopes: string[]): void {
  if (!Array.isArray(scopes)) {
    throw new Error("scopes must be an array")
  }
  if (scopes.length > MAX_SCOPES) {
    throw new Error(`Maximum ${MAX_SCOPES} scopes allowed`)
  }
  for (const scope of scopes) {
    if (!SCOPE_PATTERN.test(scope)) {
      throw new InvalidScopeFormatError(scope)
    }
  }
}

/**
 * Validate redirect URIs
 */
export function validateRedirectUris(uris: string[]): void {
  if (!Array.isArray(uris)) {
    throw new Error("redirect_uris must be an array")
  }
  if (uris.length > MAX_REDIRECT_URIS) {
    throw new Error(`Maximum ${MAX_REDIRECT_URIS} redirect URIs allowed`)
  }
  for (const uri of uris) {
    try {
      const url = new URL(uri)
      // Allow localhost HTTP for development
      const isLocalhost =
        url.hostname === "localhost" || url.hostname === "127.0.0.1"
      if (!isLocalhost && url.protocol !== "https:") {
        throw new InvalidRedirectUriError(uri + " (must use HTTPS)")
      }
    } catch (e) {
      if (e instanceof InvalidRedirectUriError) throw e
      throw new InvalidRedirectUriError(uri)
    }
  }
}

/**
 * Validate metadata
 */
export function validateMetadata(
  metadata: Record<string, unknown>
): void {
  if (typeof metadata !== "object" || metadata === null) {
    throw new Error("metadata must be an object")
  }
  const json = JSON.stringify(metadata)
  if (json.length > 10000) {
    throw new Error("metadata must be less than 10KB")
  }
}
```

### 5. `/packages/openauth/src/client/d1-adapter.ts`

```typescript
/**
 * D1 adapter for OAuth client management
 */

import type { D1Database } from "@cloudflare/workers-types"
import type {
  OAuthClient,
  OAuthClientResponse,
  CreateClientRequest,
  UpdateClientRequest,
  ListClientsParams,
  PaginatedClientsResponse,
} from "./types.js"
import {
  ClientNotFoundError,
  ClientNameConflictError,
} from "./errors.js"
import {
  generateClientId,
  generateClientSecret,
  hashClientSecret,
  verifyClientSecret,
} from "./secret-generator.js"
import {
  validateClientName,
  validateGrantTypes,
  validateScopes,
  validateRedirectUris,
  validateMetadata,
} from "./validation.js"

const DEFAULT_GRACE_PERIOD = 60 * 60 // 1 hour

export class D1ClientAdapter {
  constructor(private db: D1Database) {}

  /**
   * Create a new OAuth client
   */
  async createClient(
    tenantId: string,
    request: CreateClientRequest
  ): Promise<{ client: OAuthClientResponse; secret: string }> {
    validateClientName(request.name)

    const grantTypes = request.grant_types || ["client_credentials"]
    validateGrantTypes(grantTypes)

    const scopes = request.scopes || []
    validateScopes(scopes)

    const redirectUris = request.redirect_uris || []
    validateRedirectUris(redirectUris)

    if (request.metadata) {
      validateMetadata(request.metadata)
    }

    // Check for name conflict
    const existing = await this.db
      .prepare(
        "SELECT id FROM oauth_clients WHERE tenant_id = ? AND name = ?"
      )
      .bind(tenantId, request.name)
      .first()

    if (existing) {
      throw new ClientNameConflictError(request.name)
    }

    const id = generateClientId()
    const secret = generateClientSecret()
    const secretHash = await hashClientSecret(secret)
    const now = Date.now()

    await this.db
      .prepare(
        `INSERT INTO oauth_clients (
          id, tenant_id, name, client_secret_hash, grant_types, scopes,
          redirect_uris, metadata, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        tenantId,
        request.name,
        secretHash,
        JSON.stringify(grantTypes),
        JSON.stringify(scopes),
        JSON.stringify(redirectUris),
        JSON.stringify(request.metadata || {}),
        request.enabled !== false ? 1 : 0,
        now,
        now
      )
      .run()

    const client = await this.getClient(id, tenantId)
    if (!client) {
      throw new Error("Failed to create client")
    }

    return { client: this.toResponse(client), secret }
  }

  /**
   * Get a client by ID
   */
  async getClient(
    clientId: string,
    tenantId: string
  ): Promise<OAuthClient | null> {
    const row = await this.db
      .prepare(
        "SELECT * FROM oauth_clients WHERE id = ? AND tenant_id = ?"
      )
      .bind(clientId, tenantId)
      .first<any>()

    if (!row) return null

    return this.rowToClient(row)
  }

  /**
   * Get a client by ID (any tenant - for authentication)
   */
  async getClientById(clientId: string): Promise<OAuthClient | null> {
    const row = await this.db
      .prepare("SELECT * FROM oauth_clients WHERE id = ?")
      .bind(clientId)
      .first<any>()

    if (!row) return null

    return this.rowToClient(row)
  }

  /**
   * List clients for a tenant
   */
  async listClients(
    tenantId: string,
    params: ListClientsParams = {}
  ): Promise<PaginatedClientsResponse> {
    const limit = Math.min(params.limit || 20, 100)
    const cursor = params.cursor ? parseInt(params.cursor, 10) : 0

    let query = "SELECT * FROM oauth_clients WHERE tenant_id = ?"
    const bindings: (string | number)[] = [tenantId]

    if (params.enabled !== undefined) {
      query += " AND enabled = ?"
      bindings.push(params.enabled ? 1 : 0)
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    bindings.push(limit + 1, cursor)

    const result = await this.db
      .prepare(query)
      .bind(...bindings)
      .all<any>()

    const rows = result.results || []
    const hasMore = rows.length > limit
    const clients = rows.slice(0, limit).map((r) => this.toResponse(this.rowToClient(r)))

    return {
      clients,
      next_cursor: hasMore ? String(cursor + limit) : undefined,
      has_more: hasMore,
    }
  }

  /**
   * Update a client
   */
  async updateClient(
    clientId: string,
    tenantId: string,
    updates: UpdateClientRequest
  ): Promise<OAuthClientResponse> {
    const existing = await this.getClient(clientId, tenantId)
    if (!existing) {
      throw new ClientNotFoundError(clientId)
    }

    const setClauses: string[] = ["updated_at = ?"]
    const values: (string | number)[] = [Date.now()]

    if (updates.name !== undefined) {
      validateClientName(updates.name)
      // Check for name conflict
      const conflict = await this.db
        .prepare(
          "SELECT id FROM oauth_clients WHERE tenant_id = ? AND name = ? AND id != ?"
        )
        .bind(tenantId, updates.name, clientId)
        .first()
      if (conflict) {
        throw new ClientNameConflictError(updates.name)
      }
      setClauses.push("name = ?")
      values.push(updates.name)
    }

    if (updates.grant_types !== undefined) {
      validateGrantTypes(updates.grant_types)
      setClauses.push("grant_types = ?")
      values.push(JSON.stringify(updates.grant_types))
    }

    if (updates.scopes !== undefined) {
      validateScopes(updates.scopes)
      setClauses.push("scopes = ?")
      values.push(JSON.stringify(updates.scopes))
    }

    if (updates.redirect_uris !== undefined) {
      validateRedirectUris(updates.redirect_uris)
      setClauses.push("redirect_uris = ?")
      values.push(JSON.stringify(updates.redirect_uris))
    }

    if (updates.metadata !== undefined) {
      validateMetadata(updates.metadata)
      setClauses.push("metadata = ?")
      values.push(JSON.stringify(updates.metadata))
    }

    if (updates.enabled !== undefined) {
      setClauses.push("enabled = ?")
      values.push(updates.enabled ? 1 : 0)
    }

    values.push(clientId, tenantId)

    await this.db
      .prepare(
        `UPDATE oauth_clients SET ${setClauses.join(", ")} WHERE id = ? AND tenant_id = ?`
      )
      .bind(...values)
      .run()

    const updated = await this.getClient(clientId, tenantId)
    if (!updated) {
      throw new ClientNotFoundError(clientId)
    }

    return this.toResponse(updated)
  }

  /**
   * Delete a client
   */
  async deleteClient(clientId: string, tenantId: string): Promise<void> {
    const existing = await this.getClient(clientId, tenantId)
    if (!existing) {
      throw new ClientNotFoundError(clientId)
    }

    await this.db
      .prepare("DELETE FROM oauth_clients WHERE id = ? AND tenant_id = ?")
      .bind(clientId, tenantId)
      .run()
  }

  /**
   * Rotate client secret
   */
  async rotateSecret(
    clientId: string,
    tenantId: string,
    gracePeriodSeconds = DEFAULT_GRACE_PERIOD
  ): Promise<{ client: OAuthClientResponse; secret: string }> {
    const existing = await this.getClient(clientId, tenantId)
    if (!existing) {
      throw new ClientNotFoundError(clientId)
    }

    const newSecret = generateClientSecret()
    const newSecretHash = await hashClientSecret(newSecret)
    const now = Date.now()
    const previousExpires = now + gracePeriodSeconds * 1000

    await this.db
      .prepare(
        `UPDATE oauth_clients SET
          client_secret_hash = ?,
          previous_secret_hash = ?,
          previous_secret_expires_at = ?,
          rotated_at = ?,
          updated_at = ?
        WHERE id = ? AND tenant_id = ?`
      )
      .bind(
        newSecretHash,
        existing.client_secret_hash,
        previousExpires,
        now,
        now,
        clientId,
        tenantId
      )
      .run()

    const updated = await this.getClient(clientId, tenantId)
    if (!updated) {
      throw new ClientNotFoundError(clientId)
    }

    return { client: this.toResponse(updated), secret: newSecret }
  }

  /**
   * Verify client credentials (checks current and previous secret)
   */
  async verifyCredentials(
    clientId: string,
    clientSecret: string
  ): Promise<OAuthClient | null> {
    const client = await this.getClientById(clientId)
    if (!client) return null

    // Check current secret
    const currentValid = await verifyClientSecret(
      clientSecret,
      client.client_secret_hash
    )
    if (currentValid) return client

    // Check previous secret if within grace period
    if (
      client.previous_secret_hash &&
      client.previous_secret_expires_at &&
      Date.now() < client.previous_secret_expires_at
    ) {
      const previousValid = await verifyClientSecret(
        clientSecret,
        client.previous_secret_hash
      )
      if (previousValid) return client
    }

    return null
  }

  /**
   * Convert database row to OAuthClient
   */
  private rowToClient(row: any): OAuthClient {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      name: row.name,
      client_secret_hash: row.client_secret_hash,
      grant_types: JSON.parse(row.grant_types || "[]"),
      scopes: JSON.parse(row.scopes || "[]"),
      redirect_uris: JSON.parse(row.redirect_uris || "[]"),
      metadata: JSON.parse(row.metadata || "{}"),
      enabled: row.enabled === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      rotated_at: row.rotated_at || undefined,
      previous_secret_hash: row.previous_secret_hash || undefined,
      previous_secret_expires_at: row.previous_secret_expires_at || undefined,
    }
  }

  /**
   * Convert OAuthClient to response (strip secrets)
   */
  private toResponse(client: OAuthClient): OAuthClientResponse {
    return {
      id: client.id,
      tenant_id: client.tenant_id,
      name: client.name,
      grant_types: client.grant_types,
      scopes: client.scopes,
      redirect_uris: client.redirect_uris,
      metadata: client.metadata,
      enabled: client.enabled,
      created_at: client.created_at,
      updated_at: client.updated_at,
      rotated_at: client.rotated_at,
    }
  }
}
```

### 6. `/packages/openauth/src/client/service.ts`

```typescript
/**
 * OAuth Client Management Service
 */

import type { D1Database } from "@cloudflare/workers-types"
import { D1ClientAdapter } from "./d1-adapter.js"
import type {
  OAuthClientResponse,
  CreateClientRequest,
  UpdateClientRequest,
  ListClientsParams,
  PaginatedClientsResponse,
} from "./types.js"

export class ClientService {
  private adapter: D1ClientAdapter

  constructor(db: D1Database) {
    this.adapter = new D1ClientAdapter(db)
  }

  /**
   * Create a new OAuth client
   */
  async createClient(
    tenantId: string,
    request: CreateClientRequest
  ): Promise<{ client: OAuthClientResponse; secret: string }> {
    return this.adapter.createClient(tenantId, request)
  }

  /**
   * Get a client by ID (tenant-scoped)
   */
  async getClient(
    clientId: string,
    tenantId: string
  ): Promise<OAuthClientResponse | null> {
    const client = await this.adapter.getClient(clientId, tenantId)
    if (!client) return null
    return this.toResponse(client)
  }

  /**
   * List clients for a tenant
   */
  async listClients(
    tenantId: string,
    params?: ListClientsParams
  ): Promise<PaginatedClientsResponse> {
    return this.adapter.listClients(tenantId, params)
  }

  /**
   * Update a client
   */
  async updateClient(
    clientId: string,
    tenantId: string,
    updates: UpdateClientRequest
  ): Promise<OAuthClientResponse> {
    return this.adapter.updateClient(clientId, tenantId, updates)
  }

  /**
   * Delete a client
   */
  async deleteClient(clientId: string, tenantId: string): Promise<void> {
    return this.adapter.deleteClient(clientId, tenantId)
  }

  /**
   * Rotate client secret
   */
  async rotateSecret(
    clientId: string,
    tenantId: string,
    gracePeriodSeconds?: number
  ): Promise<{ client: OAuthClientResponse; secret: string }> {
    return this.adapter.rotateSecret(clientId, tenantId, gracePeriodSeconds)
  }

  /**
   * Verify client credentials for authentication
   */
  async verifyCredentials(
    clientId: string,
    clientSecret: string
  ): Promise<OAuthClientResponse | null> {
    const client = await this.adapter.verifyCredentials(clientId, clientSecret)
    if (!client) return null
    if (!client.enabled) return null
    return this.toResponse(client)
  }

  private toResponse(client: any): OAuthClientResponse {
    return {
      id: client.id,
      tenant_id: client.tenant_id,
      name: client.name,
      grant_types: client.grant_types,
      scopes: client.scopes,
      redirect_uris: client.redirect_uris,
      metadata: client.metadata,
      enabled: client.enabled,
      created_at: client.created_at,
      updated_at: client.updated_at,
      rotated_at: client.rotated_at,
    }
  }
}
```

### 7. `/packages/openauth/src/client/api.ts`

```typescript
/**
 * OAuth Client Management API Routes
 */

import { Hono } from "hono"
import type { D1Database } from "@cloudflare/workers-types"
import { ClientService } from "./service.js"
import {
  ClientNotFoundError,
  ClientNameConflictError,
  InvalidGrantTypeError,
  InvalidScopeFormatError,
  InvalidRedirectUriError,
  ClientError,
} from "./errors.js"

interface Env {
  DB: D1Database
}

interface Variables {
  tenantId: string
}

export function clientAdminRoutes(db: D1Database) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>()
  const service = new ClientService(db)

  /**
   * GET /clients - List clients
   */
  app.get("/clients", async (c) => {
    const tenantId = c.get("tenantId")
    const cursor = c.req.query("cursor")
    const limit = c.req.query("limit")
    const enabled = c.req.query("enabled")

    const result = await service.listClients(tenantId, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      enabled: enabled === "true" ? true : enabled === "false" ? false : undefined,
    })

    return c.json(result)
  })

  /**
   * POST /clients - Create client
   */
  app.post("/clients", async (c) => {
    const tenantId = c.get("tenantId")

    let body: any
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400)
    }

    if (!body.name || typeof body.name !== "string") {
      return c.json(
        { error: "Bad Request", message: "name is required and must be a string" },
        400
      )
    }

    try {
      const { client, secret } = await service.createClient(tenantId, {
        name: body.name,
        grant_types: body.grant_types,
        scopes: body.scopes,
        redirect_uris: body.redirect_uris,
        metadata: body.metadata,
        enabled: body.enabled,
      })

      return c.json(
        {
          ...client,
          client_secret: secret,
        },
        201
      )
    } catch (error) {
      return handleClientError(c, error)
    }
  })

  /**
   * GET /clients/:clientId - Get client
   */
  app.get("/clients/:clientId", async (c) => {
    const tenantId = c.get("tenantId")
    const clientId = c.req.param("clientId")

    const client = await service.getClient(clientId, tenantId)
    if (!client) {
      return c.json({ error: "Not Found", message: "Client not found" }, 404)
    }

    return c.json(client)
  })

  /**
   * PATCH /clients/:clientId - Update client
   */
  app.patch("/clients/:clientId", async (c) => {
    const tenantId = c.get("tenantId")
    const clientId = c.req.param("clientId")

    let body: any
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400)
    }

    try {
      const client = await service.updateClient(clientId, tenantId, {
        name: body.name,
        grant_types: body.grant_types,
        scopes: body.scopes,
        redirect_uris: body.redirect_uris,
        metadata: body.metadata,
        enabled: body.enabled,
      })

      return c.json(client)
    } catch (error) {
      return handleClientError(c, error)
    }
  })

  /**
   * DELETE /clients/:clientId - Delete client
   */
  app.delete("/clients/:clientId", async (c) => {
    const tenantId = c.get("tenantId")
    const clientId = c.req.param("clientId")

    try {
      await service.deleteClient(clientId, tenantId)
      return c.body(null, 204)
    } catch (error) {
      return handleClientError(c, error)
    }
  })

  /**
   * POST /clients/:clientId/rotate - Rotate client secret
   */
  app.post("/clients/:clientId/rotate", async (c) => {
    const tenantId = c.get("tenantId")
    const clientId = c.req.param("clientId")

    let gracePeriod: number | undefined
    try {
      const body = await c.req.json()
      gracePeriod = body.grace_period_seconds
    } catch {
      // Body is optional
    }

    try {
      const { client, secret } = await service.rotateSecret(
        clientId,
        tenantId,
        gracePeriod
      )

      return c.json({
        ...client,
        client_secret: secret,
        previous_secret_expires_at: client.rotated_at
          ? client.rotated_at + (gracePeriod || 3600) * 1000
          : undefined,
      })
    } catch (error) {
      return handleClientError(c, error)
    }
  })

  return app
}

/**
 * Handle client errors and return appropriate HTTP responses
 */
function handleClientError(c: any, error: unknown) {
  if (error instanceof ClientNotFoundError) {
    return c.json({ error: "Not Found", message: error.message }, 404)
  }
  if (error instanceof ClientNameConflictError) {
    return c.json({ error: "Conflict", message: error.message }, 409)
  }
  if (
    error instanceof InvalidGrantTypeError ||
    error instanceof InvalidScopeFormatError ||
    error instanceof InvalidRedirectUriError
  ) {
    return c.json({ error: "Bad Request", message: error.message }, 400)
  }
  if (error instanceof ClientError) {
    return c.json({ error: "Bad Request", message: error.message }, 400)
  }
  if (error instanceof Error) {
    return c.json({ error: "Bad Request", message: error.message }, 400)
  }
  throw error
}
```

### 8. `/packages/openauth/src/client/index.ts`

```typescript
export * from "./types.js"
export * from "./errors.js"
export { ClientService } from "./service.js"
export { clientAdminRoutes } from "./api.js"
export {
  generateClientId,
  generateClientSecret,
  hashClientSecret,
  verifyClientSecret,
} from "./secret-generator.js"
```

## API Endpoints

| Method | Path | Description | Scope |
|--------|------|-------------|-------|
| GET | /clients | List clients (paginated) | clients:read |
| POST | /clients | Create new client | clients:write |
| GET | /clients/:id | Get client by ID | clients:read |
| PATCH | /clients/:id | Update client | clients:write |
| DELETE | /clients/:id | Delete client | clients:delete |
| POST | /clients/:id/rotate | Rotate secret | clients:write |

## Security Features

### Secret Generation
- 256-bit entropy (32 bytes)
- URL-safe Base64 encoding
- Cryptographically secure random generation

### Secret Hashing
- PBKDF2-SHA256
- 100,000 iterations
- 128-bit salt
- Constant-time comparison

### Secret Rotation
- Grace period for old secret (default 1 hour)
- Both secrets valid during grace period
- Automatic expiration of old secret

## Request/Response Examples

### Create Client

```http
POST /clients
Content-Type: application/json
Authorization: Bearer <m2m_token>

{
  "name": "My Backend Service",
  "grant_types": ["client_credentials"],
  "scopes": ["users:read", "users:write"]
}
```

Response (201):
```json
{
  "id": "client_abc123xyz",
  "tenant_id": "tenant_123",
  "name": "My Backend Service",
  "grant_types": ["client_credentials"],
  "scopes": ["users:read", "users:write"],
  "redirect_uris": [],
  "metadata": {},
  "enabled": true,
  "created_at": 1701234567890,
  "updated_at": 1701234567890,
  "client_secret": "dGhpcyBpcyBhIHNlY3JldA..."
}
```

### Rotate Secret

```http
POST /clients/client_abc123xyz/rotate
Content-Type: application/json
Authorization: Bearer <m2m_token>

{
  "grace_period_seconds": 7200
}
```

Response:
```json
{
  "id": "client_abc123xyz",
  "name": "My Backend Service",
  "client_secret": "bmV3IHNlY3JldCBoZXJl...",
  "previous_secret_expires_at": 1701241767890
}
```

## Tests

### Unit Tests: `/packages/openauth/src/client/secret-generator.test.ts`

```typescript
import { describe, test, expect } from "bun:test"
import {
  generateClientId,
  generateClientSecret,
  hashClientSecret,
  verifyClientSecret,
} from "./secret-generator.js"

describe("generateClientId", () => {
  test("generates unique IDs with prefix", () => {
    const id1 = generateClientId()
    const id2 = generateClientId()
    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^client_[A-Za-z0-9_-]+$/)
  })

  test("uses custom prefix", () => {
    const id = generateClientId("svc")
    expect(id).toMatch(/^svc_/)
  })
})

describe("generateClientSecret", () => {
  test("generates 32-byte secrets", () => {
    const secret = generateClientSecret()
    // Base64 encoded 32 bytes = ~43 characters
    expect(secret.length).toBeGreaterThanOrEqual(40)
  })

  test("generates unique secrets", () => {
    const secrets = new Set()
    for (let i = 0; i < 100; i++) {
      secrets.add(generateClientSecret())
    }
    expect(secrets.size).toBe(100)
  })
})

describe("hashClientSecret / verifyClientSecret", () => {
  test("verifies correct secret", async () => {
    const secret = generateClientSecret()
    const hash = await hashClientSecret(secret)
    expect(await verifyClientSecret(secret, hash)).toBe(true)
  })

  test("rejects incorrect secret", async () => {
    const secret = generateClientSecret()
    const hash = await hashClientSecret(secret)
    expect(await verifyClientSecret("wrong", hash)).toBe(false)
  })

  test("hash format is correct", async () => {
    const hash = await hashClientSecret("test")
    expect(hash).toMatch(/^\$pbkdf2-sha256\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/)
  })
})
```

### Integration Tests: `/packages/openauth/src/client/api.test.ts`

```typescript
import { describe, test, expect, beforeEach } from "bun:test"

describe("Client Management API", () => {
  describe("POST /clients", () => {
    test("creates client with secret", async () => {
      // Create client
      // Verify response includes client_secret
      // Verify secret not stored in plain text
    })

    test("rejects duplicate name", async () => {
      // Create client with name "test"
      // Attempt to create another with same name
      // Expect 409 Conflict
    })
  })

  describe("POST /clients/:id/rotate", () => {
    test("rotates secret with grace period", async () => {
      // Create client
      // Authenticate with original secret
      // Rotate secret
      // Authenticate with new secret - should work
      // Authenticate with old secret - should still work during grace period
    })

    test("old secret expires after grace period", async () => {
      // Create client
      // Rotate with 1 second grace period
      // Wait 2 seconds
      // Authenticate with old secret - should fail
    })
  })

  describe("tenant isolation", () => {
    test("client only visible to own tenant", async () => {
      // Create client in tenant A
      // Attempt to access from tenant B
      // Expect 404
    })
  })
})
```

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| client_not_found | 404 | Client does not exist |
| client_name_conflict | 409 | Client name already exists |
| invalid_grant_type | 400 | Invalid grant type |
| invalid_scope_format | 400 | Scope format invalid |
| invalid_redirect_uri | 400 | Redirect URI invalid |
| client_disabled | 401 | Client is disabled |

## Checklist

- [ ] Create `/packages/openauth/src/client/types.ts`
- [ ] Create `/packages/openauth/src/client/errors.ts`
- [ ] Create `/packages/openauth/src/client/secret-generator.ts`
- [ ] Create `/packages/openauth/src/client/validation.ts`
- [ ] Create `/packages/openauth/src/client/d1-adapter.ts`
- [ ] Create `/packages/openauth/src/client/service.ts`
- [ ] Create `/packages/openauth/src/client/api.ts`
- [ ] Create `/packages/openauth/src/client/index.ts`
- [ ] Write unit tests for secret-generator
- [ ] Write unit tests for validation
- [ ] Write integration tests for API
- [ ] Update main index.ts exports
