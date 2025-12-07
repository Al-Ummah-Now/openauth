import { SignJWT, type KeyLike } from "jose"
import type { M2MTokenClaims, M2MConfig } from "./types.js"

const DEFAULT_M2M_TTL = 60 * 60 // 1 hour in seconds

export async function generateM2MToken(options: {
  clientId: string
  tenantId?: string
  scopes: string[]
  issuer: string
  signingKey: { private: KeyLike; alg: string; id: string }
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
