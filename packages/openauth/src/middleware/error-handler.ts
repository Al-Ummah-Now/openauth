/**
 * Error Handler Middleware
 */

import type { Context } from "hono"
import {
  AuthError,
  MissingTokenError,
  InvalidTokenError,
  InsufficientScopeError,
  TenantMismatchError,
  RateLimitExceededError,
} from "./errors.js"

/**
 * OAuth 2.0 error response format (RFC 6749)
 */
interface OAuthErrorResponse {
  error: string
  error_description?: string
}

/**
 * Convert AuthError to OAuth 2.0 error response
 */
function toOAuthError(error: AuthError): OAuthErrorResponse {
  return {
    error: error.code,
    error_description: error.message,
  }
}

/**
 * Error handler middleware for auth errors
 */
export function authErrorHandler() {
  return async (error: Error, c: Context) => {
    if (error instanceof RateLimitExceededError) {
      return c.json(toOAuthError(error), 429)
    }

    if (
      error instanceof MissingTokenError ||
      error instanceof InvalidTokenError
    ) {
      // RFC 6750 - WWW-Authenticate header
      c.header(
        "WWW-Authenticate",
        `Bearer realm="api", error="${error.code}", error_description="${error.message}"`,
      )
      return c.json(toOAuthError(error), 401)
    }

    if (error instanceof InsufficientScopeError) {
      // RFC 6750 - insufficient_scope
      c.header(
        "WWW-Authenticate",
        `Bearer realm="api", error="insufficient_scope", error_description="${error.message}"`,
      )
      return c.json(toOAuthError(error), 403)
    }

    if (error instanceof TenantMismatchError) {
      return c.json(toOAuthError(error), 403)
    }

    if (error instanceof AuthError) {
      return c.json(toOAuthError(error), error.status as any)
    }

    // Re-throw non-auth errors
    throw error
  }
}

/**
 * Hono error handler for app.onError
 */
export function onAuthError(error: Error, c: Context) {
  if (error instanceof AuthError) {
    if (error instanceof RateLimitExceededError) {
      return c.json(toOAuthError(error), 429)
    }

    if (error.status === 401) {
      c.header("WWW-Authenticate", `Bearer realm="api", error="${error.code}"`)
    }

    return c.json(toOAuthError(error), error.status as any)
  }

  // Return generic error for non-auth errors
  console.error("Unhandled error:", error)
  return c.json(
    { error: "server_error", error_description: "Internal server error" },
    500,
  )
}
