/**
 * Client Authentication Middleware for OpenAuth
 *
 * Validates client credentials from Authorization header or request body.
 * Follows OAuth 2.0 client authentication specification.
 *
 * @packageDocumentation
 */

import type { Context, Next } from "hono"
import { ClientAuthenticator } from "../client/authenticator.js"
import type { OAuthClient } from "../client/d1-adapter.js"

export interface ClientAuthMiddlewareOptions {
  authenticator: ClientAuthenticator
  /**
   * Whether to allow unauthenticated requests to pass through
   * @default false
   */
  optional?: boolean
  /**
   * Custom error response handler
   */
  onError?: (
    ctx: Context,
    error: ClientAuthError,
  ) => Response | Promise<Response>
}

export class ClientAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 401,
  ) {
    super(message)
    this.name = "ClientAuthError"
  }
}

/**
 * Extract client credentials from request
 */
function extractCredentials(ctx: Context): {
  clientId: string
  clientSecret: string
} | null {
  // Try Authorization header first (OAuth 2.0 standard)
  const authHeader = ctx.req.header("Authorization")
  if (authHeader) {
    const [type, credentials] = authHeader.split(" ")

    if (type === "Basic" && credentials) {
      try {
        // Decode base64
        const decoded = atob(credentials)
        const [clientId, clientSecret] = decoded.split(":")

        if (clientId && clientSecret) {
          return { clientId, clientSecret }
        }
      } catch (error) {
        console.error("Failed to decode Basic auth:", error)
      }
    }
  }

  // Try request body (form data or JSON)
  const contentType = ctx.req.header("Content-Type")

  if (contentType?.includes("application/x-www-form-urlencoded")) {
    // Form data - will be parsed by Hono
    return null // Let the form parsing happen in the middleware
  }

  if (contentType?.includes("application/json")) {
    // JSON body - will be parsed by Hono
    return null // Let the JSON parsing happen in the middleware
  }

  return null
}

/**
 * Create client authentication middleware
 *
 * IMPORTANT: Request body consumption strategy
 * ------------------------------------------
 * This middleware consumes the request body (FormData or JSON) to extract client credentials.
 * Since request bodies can only be read once in the Web Fetch API, we parse the body here
 * and store the parsed values in the Hono context for route handlers to access.
 *
 * - For FormData: We convert it to a plain object (Record<string, string>) and store in ctx.set("formData", ...)
 * - For JSON: We store the parsed object directly in ctx.set("jsonBody", ...)
 *
 * Route handlers should access these parsed values from context instead of calling
 * ctx.req.formData() or ctx.req.json() again, which would fail since the body is already consumed.
 *
 * Example usage in a route handler:
 * ```typescript
 * app.post("/token", clientAuth({ authenticator }), async (c) => {
 *   const formData = c.get("formData") // Get pre-parsed form data
 *   const grantType = formData?.["grant_type"]
 *   // ... rest of handler
 * })
 * ```
 */
export function clientAuth(options: ClientAuthMiddlewareOptions) {
  const { authenticator, optional = false, onError } = options

  return async function clientAuthMiddleware(ctx: Context, next: Next) {
    let clientId: string | undefined
    let clientSecret: string | undefined
    let authenticated = false
    let client: OAuthClient | null = null

    try {
      // Try to extract from Authorization header
      const headerCreds = extractCredentials(ctx)
      if (headerCreds) {
        clientId = headerCreds.clientId
        clientSecret = headerCreds.clientSecret
      } else {
        // Try to extract from request body
        const contentType = ctx.req.header("Content-Type")

        if (contentType?.includes("application/x-www-form-urlencoded")) {
          const formData = await ctx.req.formData()
          clientId = formData.get("client_id")?.toString()
          clientSecret = formData.get("client_secret")?.toString()

          // Store parsed form values as a plain object for route handlers
          // Note: FormData can only be consumed once, so we extract all values
          // and store them as a plain object that can be safely reused
          const formValues: Record<string, string> = {}
          for (const [key, value] of formData.entries()) {
            formValues[key] = value.toString()
          }
          ctx.set("formData", formValues)
        } else if (contentType?.includes("application/json")) {
          const body = await ctx.req.json()
          clientId = body.client_id
          clientSecret = body.client_secret

          // Store parsed JSON body for later use in the route handler
          ctx.set("jsonBody", body)
        }
      }

      // Validate credentials if provided
      if (clientId && clientSecret) {
        const authResult = await authenticator.authenticateClient(
          clientId,
          clientSecret,
        )
        client = authResult.client
        authenticated = client !== null

        if (!authenticated && !optional) {
          throw new ClientAuthError(
            "invalid_client",
            "Client authentication failed",
            401,
          )
        }
      } else if (!optional) {
        throw new ClientAuthError(
          "invalid_request",
          "Missing client credentials",
          400,
        )
      }

      // Set context variables
      ctx.set("clientId", clientId)
      ctx.set("clientAuthenticated", authenticated)
      ctx.set("client", client)

      // Continue to next handler
      await next()
    } catch (error) {
      if (error instanceof ClientAuthError) {
        if (onError) {
          return onError(ctx, error)
        }

        // Default error response (OAuth 2.0 format)
        return ctx.json(
          {
            error: error.code,
            error_description: error.message,
          },
          error.status as any,
        )
      }

      // Unexpected error
      console.error("ClientAuthMiddleware: Unexpected error:", error)
      return ctx.json(
        {
          error: "server_error",
          error_description: "Internal server error",
        },
        500,
      )
    }
  }
}

/**
 * Helper middleware for routes that require authenticated clients
 */
export function requireClientAuth(
  options: Omit<ClientAuthMiddlewareOptions, "optional">,
) {
  return clientAuth({ ...options, optional: false })
}

/**
 * Helper middleware for routes where client auth is optional
 */
export function optionalClientAuth(
  options: Omit<ClientAuthMiddlewareOptions, "optional">,
) {
  return clientAuth({ ...options, optional: true })
}

// Type augmentation for Hono context
declare module "hono" {
  interface ContextVariableMap {
    clientId?: string
    clientAuthenticated: boolean
    client?: OAuthClient | null
    /**
     * Parsed form data as a plain object (Record<string, string>)
     * Available when the middleware parses application/x-www-form-urlencoded content
     */
    formData?: Record<string, string>
    /**
     * Parsed JSON body
     * Available when the middleware parses application/json content
     */
    jsonBody?: any
  }
}
