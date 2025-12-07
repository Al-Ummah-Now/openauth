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
      "Client name must contain only alphanumeric characters, spaces, hyphens, and underscores",
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
export function validateMetadata(metadata: Record<string, unknown>): void {
  if (typeof metadata !== "object" || metadata === null) {
    throw new Error("metadata must be an object")
  }
  const json = JSON.stringify(metadata)
  if (json.length > 10000) {
    throw new Error("metadata must be less than 10KB")
  }
}
