# Phase 1: M2M Authentication Implementation

## Overview

Implement OAuth 2.0 Client Credentials Grant (RFC 6749 Section 4.4) for machine-to-machine authentication.

## Files to Create

### 1. `/packages/openauth/src/m2m/types.ts`

```typescript
/**
 * M2M Authentication Types
 */

/**
 * Configuration for M2M authentication
 */
export interface M2MConfig {
  /**
   * TTL for M2M access tokens in seconds
   * @default 3600 (1 hour)
   */
  ttl?: number

  /**
   * Default scopes if none requested
   */
  defaultScopes?: string[]

  /**
   * Whether to include tenant_id in token claims
   * @default true
   */
  includeTenantId?: boolean
}

/**
 * M2M token claims (JWT payload)
 */
export interface M2MTokenClaims {
  /** Token mode - distinguishes M2M from user tokens */
  mode: "m2m"

  /** Subject - the client_id */
  sub: string

  /** Client ID */
  client_id: string

  /** Tenant ID (if multi-tenant) */
  tenant_id?: string

  /** Granted scopes (space-separated) */
  scope: string

  /** Expiration timestamp (Unix epoch seconds) */
  exp: number

  /** Issued at timestamp */
  iat: number

  /** Issuer URL */
  iss: string

  /** JWT ID for revocation tracking */
  jti: string
}

/**
 * M2M token request parameters
 */
export interface M2MTokenRequest {
  grant_type: "client_credentials"
  client_id: string
  client_secret: string
  scope?: string
}

/**
 * M2M token response
 */
export interface M2MTokenResponse {
  access_token: string
  token_type: "Bearer"
  expires_in: number
  scope?: string
}

/**
 * Result of scope validation
 */
export interface ScopeValidationResult {
  valid: boolean
  granted: string[]
  denied: string[]
}
```

### 2. `/packages/openauth/src/m2m/scope-validator.ts`

```typescript
import type { ScopeValidationResult } from "./types.js"

/**
 * Validate requested scopes against allowed scopes
 */
export function validateScopes(
  requestedScopes: string[],
  allowedScopes: string[]
): ScopeValidationResult {
  // Empty requested = grant all allowed
  if (requestedScopes.length === 0) {
    return {
      valid: true,
      granted: allowedScopes,
      denied: [],
    }
  }

  const granted: string[] = []
  const denied: string[] = []

  for (const scope of requestedScopes) {
    if (allowedScopes.includes(scope)) {
      granted.push(scope)
    } else {
      denied.push(scope)
    }
  }

  return {
    valid: denied.length === 0,
    granted,
    denied,
  }
}

/**
 * Parse space-separated scope string into array
 */
export function parseScopes(scopeString?: string): string[] {
  if (!scopeString) return []
  return scopeString.split(" ").filter(Boolean)
}
```

### 3. `/packages/openauth/src/m2m/token-generator.ts`

```typescript
import { SignJWT } from "jose"
import type { M2MTokenClaims, M2MConfig } from "./types.js"

const DEFAULT_M2M_TTL = 60 * 60 // 1 hour in seconds

export async function generateM2MToken(options: {
  clientId: string
  tenantId?: string
  scopes: string[]
  issuer: string
  signingKey: { private: CryptoKey; alg: string; id: string }
  config?: M2MConfig
}): Promise<{ access_token: string; expires_in: number }> {
  const ttl = options.config?.ttl ?? DEFAULT_M2M_TTL
  const now = Math.floor(Date.now() / 1000)

  const claims: M2MTokenClaims = {
    mode: "m2m",
    sub: options.clientId,
    client_id: options.clientId,
    scope: options.scopes.join(" "),
    exp: now + ttl,
    iat: now,
    iss: options.issuer,
    jti: crypto.randomUUID(),
  }

  if (options.tenantId && options.config?.includeTenantId !== false) {
    claims.tenant_id = options.tenantId
  }

  const token = await new SignJWT(claims as any)
    .setProtectedHeader({
      alg: options.signingKey.alg,
      kid: options.signingKey.id,
      typ: "JWT",
    })
    .sign(options.signingKey.private)

  return {
    access_token: token,
    expires_in: ttl,
  }
}
```

### 4. `/packages/openauth/src/m2m/index.ts`

```typescript
export * from "./types.js"
export { validateScopes, parseScopes } from "./scope-validator.js"
export { generateM2MToken } from "./token-generator.js"
```

## Files to Modify

### 1. `/packages/openauth/src/error.ts`

Add new error types:

```typescript
export class InvalidScopeError extends OauthError {
  constructor(deniedScopes: string[]) {
    super(
      "invalid_scope",
      `Requested scope(s) not allowed: ${deniedScopes.join(", ")}`
    )
  }
}

export class UnsupportedGrantTypeError extends OauthError {
  constructor(grantType: string) {
    super(
      "unsupported_grant_type",
      `Grant type "${grantType}" not allowed for this client`
    )
  }
}
```

### 2. `/packages/openauth/src/issuer.ts`

Add M2M handler in the `/token` endpoint where `grantType === "client_credentials"`:

```typescript
if (grantType === "client_credentials") {
  const provider = form.get("provider")

  if (!provider) {
    // M2M CLIENT CREDENTIALS FLOW (RFC 6749 Section 4.4)

    if (!clientAuthenticator) {
      return c.json({
        error: "unsupported_grant_type",
        error_description: "M2M authentication requires clientDb configuration",
      }, 400)
    }

    // Extract client credentials (Basic auth or POST body)
    const credentials = extractClientCredentials(c, form)
    if (!credentials.clientId || !credentials.clientSecret) {
      return c.json({
        error: "invalid_request",
        error_description: "Missing client credentials",
      }, 400)
    }

    // Authenticate client
    const authResult = await clientAuthenticator.authenticateClient(
      credentials.clientId,
      credentials.clientSecret
    )

    if (!authResult.client) {
      return c.json({
        error: "invalid_client",
        error_description: "Client authentication failed",
      }, 401)
    }

    const client = authResult.client

    // Verify client has client_credentials grant type
    const allowedGrants = client.grant_types || []
    if (!allowedGrants.includes("client_credentials")) {
      return c.json({
        error: "unauthorized_client",
        error_description: "Client not authorized for client_credentials grant",
      }, 403)
    }

    // Parse and validate scopes
    const requestedScopes = parseScopes(form.get("scope")?.toString())
    const allowedScopes = client.scopes || []

    const scopeResult = validateScopes(requestedScopes, allowedScopes)
    if (!scopeResult.valid) {
      return c.json({
        error: "invalid_scope",
        error_description: `Scope(s) not allowed: ${scopeResult.denied.join(", ")}`,
      }, 400)
    }

    // Generate M2M token
    const { access_token, expires_in } = await generateM2MToken({
      clientId: credentials.clientId,
      tenantId: client.tenant_id,
      scopes: scopeResult.granted,
      issuer: issuer(c),
      signingKey: await signingKey(),
      config: input.m2m,
    })

    // Return token response (no refresh token per RFC 6749)
    return c.json({
      access_token,
      token_type: "Bearer",
      expires_in,
      scope: scopeResult.granted.join(" "),
    })
  }
  // ... existing provider-based flow
}
```

## Token Flow Sequence

```
Client                          Token Endpoint                    D1 Database
  │                                    │                               │
  │  POST /token                       │                               │
  │  grant_type=client_credentials     │                               │
  │  Authorization: Basic base64(...)  │                               │
  │  scope=api:read api:write          │                               │
  │ ──────────────────────────────────>│                               │
  │                                    │                               │
  │                                    │  getClient(client_id)         │
  │                                    │ ─────────────────────────────>│
  │                                    │<──────────────────────────────│
  │                                    │                               │
  │                                    │  validateClient()             │
  │                                    │  validateScopes()             │
  │                                    │  generateM2MToken()           │
  │                                    │                               │
  │  { "access_token": "eyJ...",       │                               │
  │    "token_type": "Bearer",         │                               │
  │    "expires_in": 3600 }            │                               │
  │<───────────────────────────────────│                               │
```

## Validation Requirements

| Check | Error Code | HTTP Status |
|-------|------------|-------------|
| Missing grant_type | invalid_request | 400 |
| Missing client credentials | invalid_request | 400 |
| Invalid client_id | invalid_client | 401 |
| Wrong client_secret | invalid_client | 401 |
| client_credentials not in grant_types | unauthorized_client | 403 |
| Requested scope not allowed | invalid_scope | 400 |

## JWT Claims Structure

```json
{
  "mode": "m2m",
  "sub": "client_abc123",
  "client_id": "client_abc123",
  "tenant_id": "tenant_xyz",
  "scope": "api:read api:write",
  "exp": 1701234567,
  "iat": 1701230967,
  "iss": "https://auth.example.com",
  "jti": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Tests to Write

### Unit Tests: `/packages/openauth/src/m2m/scope-validator.test.ts`

```typescript
import { describe, test, expect } from "bun:test"
import { validateScopes, parseScopes } from "./scope-validator.js"

describe("parseScopes", () => {
  test("parses space-separated scopes", () => {
    expect(parseScopes("read write")).toEqual(["read", "write"])
  })

  test("returns empty array for undefined", () => {
    expect(parseScopes(undefined)).toEqual([])
  })
})

describe("validateScopes", () => {
  test("grants all allowed when none requested", () => {
    const result = validateScopes([], ["read", "write"])
    expect(result.valid).toBe(true)
    expect(result.granted).toEqual(["read", "write"])
  })

  test("validates requested against allowed", () => {
    const result = validateScopes(["read"], ["read", "write"])
    expect(result.valid).toBe(true)
    expect(result.granted).toEqual(["read"])
  })

  test("rejects unauthorized scopes", () => {
    const result = validateScopes(["admin"], ["read", "write"])
    expect(result.valid).toBe(false)
    expect(result.denied).toEqual(["admin"])
  })
})
```

## Security Considerations

1. **No Refresh Tokens**: M2M tokens have no refresh tokens per RFC 6749 Section 4.4
2. **Short TTL**: Default 1-hour expiry limits exposure if token is compromised
3. **Scope Limitation**: Clients can only get scopes explicitly allowed
4. **Grant Type Restriction**: Client must have `client_credentials` in `grant_types`
5. **Secret Hashing**: PBKDF2 with 100,000 iterations (existing implementation)

## Checklist

- [ ] Create `/packages/openauth/src/m2m/types.ts`
- [ ] Create `/packages/openauth/src/m2m/scope-validator.ts`
- [ ] Create `/packages/openauth/src/m2m/token-generator.ts`
- [ ] Create `/packages/openauth/src/m2m/index.ts`
- [ ] Add error types to `/packages/openauth/src/error.ts`
- [ ] Integrate M2M handler in `/packages/openauth/src/issuer.ts`
- [ ] Add `m2m?: M2MConfig` to `IssuerInput` interface
- [ ] Write unit tests for scope-validator
- [ ] Write integration tests for M2M token flow
- [ ] Update exports in main index.ts
