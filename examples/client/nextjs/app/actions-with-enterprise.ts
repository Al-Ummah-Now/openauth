"use server"

/**
 * Server actions demonstrating optional enterprise features
 *
 * These actions show how to:
 * - Use introspection when available, JWT verification when not
 * - Revoke tokens on server when available, clear local tokens when not
 * - Provide consistent API regardless of server capabilities
 */

import { redirect } from "next/navigation"
import { headers as getHeaders, cookies as getCookies } from "next/headers"
import {
  client,
  auth,
  logout as logoutWithRevocation,
  validateToken,
  setTokens,
  clearTokens,
  checkIntrospectionAvailability,
  checkRevocationAvailability,
} from "./auth-with-enterprise"

/**
 * Check authentication status with optional introspection
 *
 * Use cases:
 * - preferIntrospection: true - For sensitive operations (admin actions, payments)
 * - preferIntrospection: false - For regular page loads (faster, less server load)
 */
export async function checkAuth(options?: { preferIntrospection?: boolean }) {
  return await auth(options)
}

/**
 * Get detailed authentication info including validation method
 * Useful for debugging and understanding which features are active
 */
export async function getAuthInfo() {
  const cookies = await getCookies()
  const accessToken = cookies.get("access_token")
  const refreshToken = cookies.get("refresh_token")

  if (!accessToken) {
    return {
      authenticated: false,
      features: {
        introspection: await checkIntrospectionAvailability(),
        revocation: await checkRevocationAvailability(),
      },
    }
  }

  const result = await validateToken(
    accessToken.value,
    refreshToken?.value,
    { preferIntrospection: true },
  )

  if (result.tokens) {
    await setTokens(result.tokens.access, result.tokens.refresh)
  }

  return {
    authenticated: result.valid,
    subject: result.valid ? result.subject : null,
    validationMethod: result.method,
    features: {
      introspection: await checkIntrospectionAvailability(),
      revocation: await checkRevocationAvailability(),
    },
  }
}

/**
 * Login action - same as basic example
 */
export async function login() {
  const cookies = await getCookies()
  const accessToken = cookies.get("access_token")
  const refreshToken = cookies.get("refresh_token")

  if (accessToken) {
    const result = await validateToken(
      accessToken.value,
      refreshToken?.value,
    )

    if (result.valid && result.tokens) {
      await setTokens(result.tokens.access, result.tokens.refresh)
      redirect("/")
    }
  }

  const headers = await getHeaders()
  const host = headers.get("host")
  const protocol = host?.includes("localhost") ? "http" : "https"
  const { url } = await client.authorize(
    `${protocol}://${host}/api/callback`,
    "code",
  )
  redirect(url)
}

/**
 * Logout with automatic revocation detection
 *
 * Behavior:
 * - If server supports revocation → revoke refresh token on server + clear local cookies
 * - If server doesn't support revocation → clear local cookies only
 *
 * Result is transparent to the user - they're logged out either way
 */
export async function logout() {
  const result = await logoutWithRevocation()
  redirect("/")
}

/**
 * Force server-side validation for sensitive operations
 *
 * Use this for:
 * - Admin actions
 * - Payment processing
 * - Data deletion
 * - Account changes
 *
 * Falls back to JWT verification if introspection is not available
 */
export async function validateSensitiveOperation() {
  const subject = await checkAuth({ preferIntrospection: true })

  if (!subject) {
    throw new Error("Unauthorized")
  }

  return subject
}

/**
 * Example: Admin action requiring strong validation
 */
export async function performAdminAction(action: string) {
  // Always use introspection for admin actions if available
  const subject = await validateSensitiveOperation()

  // Check if user has admin privileges
  // In a real app, you'd check subject.properties for admin role
  console.log(`Admin action "${action}" performed by:`, subject)

  return { success: true, performedBy: subject }
}
