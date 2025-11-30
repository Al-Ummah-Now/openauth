/**
 * Enhanced authentication utilities demonstrating optional enterprise features
 *
 * This module shows how to:
 * 1. Detect if token introspection is available on the server
 * 2. Fall back to local JWT verification when introspection is unavailable
 * 3. Use token revocation when available, clear local tokens when not
 * 4. Implement graceful degradation for all enterprise features
 */

import { createClient } from "@openauthjs/openauth/client"
import { cookies as getCookies } from "next/headers"
import { subjects } from "../../../subjects"

export const client = createClient({
  clientID: "nextjs",
  issuer: "http://localhost:3000",
})

/**
 * Client credentials for introspection/revocation (if available)
 * In production, store these securely (environment variables, secrets manager)
 */
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET

/**
 * Feature detection: Check if token introspection is available
 * Returns true if server supports introspection, false otherwise
 */
export async function checkIntrospectionAvailability(): Promise<boolean> {
  try {
    if (!CLIENT_SECRET) return false

    const response = await fetch(`${client.issuer}/token/introspect`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${client.clientID}:${CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token: "test-token" }),
    })

    // 501 = Not Implemented (feature not enabled)
    // 400/401 = Feature is enabled but request was invalid
    return response.status !== 501
  } catch {
    return false
  }
}

/**
 * Feature detection: Check if token revocation is available
 * Returns true if server supports revocation, false otherwise
 */
export async function checkRevocationAvailability(): Promise<boolean> {
  try {
    if (!CLIENT_SECRET) return false

    const response = await fetch(`${client.issuer}/token/revoke`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${client.clientID}:${CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token: "test-token" }),
    })

    return response.status !== 501
  } catch {
    return false
  }
}

/**
 * Validate token using server-side introspection
 * More secure than local JWT verification for sensitive operations
 */
async function introspectToken(token: string) {
  if (!CLIENT_SECRET) {
    throw new Error("Client secret not configured")
  }

  const response = await fetch(`${client.issuer}/token/introspect`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${client.clientID}:${CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ token }),
  })

  if (!response.ok) {
    throw new Error(`Introspection failed: ${response.status}`)
  }

  const result = await response.json()
  return result.active ? result : null
}

/**
 * Verify token locally using JWT verification
 * Fallback when introspection is not available
 */
async function verifyTokenLocally(token: string, refreshToken?: string) {
  const verified = await client.verify(subjects, token, {
    refresh: refreshToken,
  })

  if (verified.err) {
    return null
  }

  return {
    subject: verified.subject,
    tokens: verified.tokens,
  }
}

/**
 * Enhanced token validation with automatic fallback
 *
 * Strategy:
 * 1. If introspection is available and configured, use server-side validation
 * 2. Otherwise, fall back to local JWT verification
 * 3. Always refresh tokens when needed
 */
export async function validateToken(
  accessToken: string,
  refreshToken?: string,
  options: {
    preferIntrospection?: boolean // Default: true for security
  } = {},
) {
  const preferIntrospection = options.preferIntrospection ?? true

  // Try introspection if preferred and client secret is configured
  if (preferIntrospection && CLIENT_SECRET) {
    try {
      const available = await checkIntrospectionAvailability()

      if (available) {
        const result = await introspectToken(accessToken)

        if (result) {
          return {
            valid: true,
            subject: result,
            method: "introspection" as const,
          }
        }

        // Token invalid, don't try local verification
        return {
          valid: false,
          method: "introspection" as const,
        }
      }
    } catch (error) {
      console.warn(
        "Introspection failed, falling back to local verification:",
        error,
      )
    }
  }

  // Fall back to local JWT verification
  const result = await verifyTokenLocally(accessToken, refreshToken)

  if (!result) {
    return {
      valid: false,
      method: "local" as const,
    }
  }

  return {
    valid: true,
    subject: result.subject,
    tokens: result.tokens,
    method: "local" as const,
  }
}

/**
 * Revoke token on the server (if available)
 * Returns true if revocation was successful or attempted
 */
async function revokeTokenOnServer(token: string): Promise<boolean> {
  if (!CLIENT_SECRET) return false

  try {
    const available = await checkRevocationAvailability()

    if (!available) {
      return false
    }

    const response = await fetch(`${client.issuer}/token/revoke`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${client.clientID}:${CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token }),
    })

    return response.ok
  } catch {
    return false
  }
}

/**
 * Token storage helpers
 */
export async function setTokens(access: string, refresh: string) {
  const cookies = await getCookies()

  cookies.set({
    name: "access_token",
    value: access,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 34560000,
  })
  cookies.set({
    name: "refresh_token",
    value: refresh,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 34560000,
  })
}

export async function clearTokens() {
  const cookies = await getCookies()
  cookies.delete("access_token")
  cookies.delete("refresh_token")
}

/**
 * Enhanced authentication with introspection support
 */
export async function auth(options: { preferIntrospection?: boolean } = {}) {
  const cookies = await getCookies()
  const accessToken = cookies.get("access_token")
  const refreshToken = cookies.get("refresh_token")

  if (!accessToken) {
    return false
  }

  const result = await validateToken(
    accessToken.value,
    refreshToken?.value,
    options,
  )

  if (!result.valid) {
    return false
  }

  // Update tokens if they were refreshed
  if (result.tokens) {
    await setTokens(result.tokens.access, result.tokens.refresh)
  }

  return result.subject
}

/**
 * Enhanced logout with optional server-side revocation
 *
 * Behavior:
 * 1. If revocation is available, revoke refresh token on server
 * 2. Always clear local cookies
 * 3. Log the method used for debugging
 */
export async function logout() {
  const cookies = await getCookies()
  const refreshToken = cookies.get("refresh_token")

  let revocationMethod: "server" | "local" = "local"

  // Try to revoke on server if available
  if (refreshToken) {
    const revoked = await revokeTokenOnServer(refreshToken.value)
    if (revoked) {
      revocationMethod = "server"
      console.log("Token revoked on server")
    } else {
      console.log("Server revocation not available, clearing local tokens only")
    }
  }

  // Always clear local cookies
  await clearTokens()

  return { method: revocationMethod }
}
