/**
 * Bearer Token Authentication Middleware
 */

import { createMiddleware } from "hono/factory"
import { jwtVerify, type JWTPayload } from "jose"
import type { TokenPayload, M2MTokenPayload } from "./types.js"
import { MissingTokenError, InvalidTokenError } from "./errors.js"

interface BearerAuthOptions {
  /** Function to get the public key for verification */
  getPublicKey: () => Promise<CryptoKey>
  /** Expected issuer (iss claim) */
  issuer: string
  /** Optional audience (aud claim) */
  audience?: string
  /** Whether to require M2M tokens only */
  requireM2M?: boolean
}

/**
 * Extract Bearer token from Authorization header
 */
export function extractBearerToken(
  authHeader: string | undefined,
): string | null {
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : null
}

/**
 * Bearer token authentication middleware
 */
export function bearerAuth(options: BearerAuthOptions) {
  return createMiddleware(async (c, next) => {
    const authHeader = c.req.header("Authorization")
    const token = extractBearerToken(authHeader)

    if (!token) {
      throw new MissingTokenError()
    }

    try {
      const publicKey = await options.getPublicKey()

      const { payload } = await jwtVerify(token, publicKey, {
        issuer: options.issuer,
        audience: options.audience,
      })

      // Validate token structure
      const tokenPayload = validateTokenPayload(payload, options.requireM2M)

      // Set context variables
      c.set("token", tokenPayload)
      c.set("tenantId", tokenPayload.tenant_id || "default")

      if (tokenPayload.mode === "m2m") {
        c.set("clientId", tokenPayload.client_id)
        c.set("scopes", tokenPayload.scope.split(" ").filter(Boolean))
      }

      await next()
    } catch (error) {
      if (
        error instanceof MissingTokenError ||
        error instanceof InvalidTokenError
      ) {
        throw error
      }
      throw new InvalidTokenError((error as Error).message)
    }
  })
}

/**
 * Validate and type the JWT payload
 */
function validateTokenPayload(
  payload: JWTPayload,
  requireM2M?: boolean,
): TokenPayload {
  if (!payload.sub) {
    throw new InvalidTokenError("missing sub claim")
  }

  if (!payload.exp) {
    throw new InvalidTokenError("missing exp claim")
  }

  if (payload.exp * 1000 < Date.now()) {
    throw new InvalidTokenError("token expired")
  }

  const mode = (payload as any).mode

  if (requireM2M && mode !== "m2m") {
    throw new InvalidTokenError("M2M token required")
  }

  if (mode === "m2m") {
    if (!(payload as any).client_id) {
      throw new InvalidTokenError("missing client_id claim")
    }
    if (typeof (payload as any).scope !== "string") {
      throw new InvalidTokenError("missing scope claim")
    }
    return payload as unknown as M2MTokenPayload
  }

  return {
    mode: "user",
    sub: payload.sub,
    tenant_id: (payload as any).tenant_id,
    exp: payload.exp,
    iat: payload.iat!,
    iss: payload.iss!,
  }
}
