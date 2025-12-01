/**
 * Hono routes for session management APIs.
 *
 * Provides endpoints for:
 * - Listing logged-in accounts
 * - Switching active account
 * - Signing out one or all accounts
 * - Session check (for silent auth)
 * - Admin session revocation
 *
 * @packageDocumentation
 */

import { Hono } from "hono"
import { cors } from "hono/cors"
import type {
  SessionService,
  BrowserSession,
  AccountSession,
} from "../contracts/types.js"
import { SessionError } from "../contracts/types.js"
import type {
  SwitchAccountRequest,
  RevokeUserSessionsRequest,
  RevokeSessionRequest,
  SessionCheckResponse,
  AccountsListResponse,
} from "./types.js"

/**
 * Context variables expected from session middleware
 */
interface SessionContextVariables {
  browserSession: BrowserSession | null
  activeAccount: AccountSession | null
}

/**
 * Create session routes for the Hono application.
 *
 * All endpoints expect session data to be set in context by the session middleware.
 *
 * @param service - The session service instance
 * @returns Hono app with session routes
 *
 * @example
 * ```typescript
 * import { Hono } from "hono"
 * import { sessionRoutes } from "./session/routes.js"
 * import { SessionServiceImpl } from "./session/service.js"
 *
 * const sessionService = new SessionServiceImpl(storage)
 * const app = new Hono()
 *
 * app.route("/session", sessionRoutes(sessionService))
 * ```
 */
export function sessionRoutes(
  service: SessionService,
): Hono<{ Variables: SessionContextVariables }> {
  const app = new Hono<{ Variables: SessionContextVariables }>()

  /**
   * GET /accounts - List all logged-in accounts
   *
   * Returns all accounts in the current browser session.
   */
  app.get("/accounts", async (c) => {
    const browserSession = c.get("browserSession")

    if (!browserSession) {
      return c.json(
        {
          error: "session_not_found",
          message: "No active session",
        },
        401,
      )
    }

    const accounts = await service.listAccounts(browserSession.id)

    const response: AccountsListResponse = {
      accounts: accounts.map((account) => ({
        userId: account.user_id,
        isActive: account.is_active,
        authenticatedAt: account.authenticated_at,
        subjectType: account.subject_type,
        clientId: account.client_id,
      })),
    }

    return c.json(response)
  })

  /**
   * POST /switch - Switch active account
   *
   * Request body: { userId: string }
   */
  app.post("/switch", async (c) => {
    const browserSession = c.get("browserSession")

    if (!browserSession) {
      return c.json(
        {
          error: "session_not_found",
          message: "No active session",
        },
        401,
      )
    }

    let body: SwitchAccountRequest
    try {
      body = await c.req.json<SwitchAccountRequest>()
    } catch {
      return c.json(
        {
          error: "invalid_request",
          message: "Invalid JSON body",
        },
        400,
      )
    }

    if (!body.userId || typeof body.userId !== "string") {
      return c.json(
        {
          error: "invalid_request",
          message: "userId is required",
        },
        400,
      )
    }

    try {
      await service.switchActiveAccount(browserSession.id, body.userId)
      return c.json({ success: true })
    } catch (error) {
      if (error instanceof SessionError) {
        return c.json(
          {
            error: error.code,
            message: error.message,
          },
          error.code === "account_not_found" ? 404 : 400,
        )
      }
      throw error
    }
  })

  /**
   * DELETE /accounts/:userId - Sign out one account
   */
  app.delete("/accounts/:userId", async (c) => {
    const browserSession = c.get("browserSession")

    if (!browserSession) {
      return c.json(
        {
          error: "session_not_found",
          message: "No active session",
        },
        401,
      )
    }

    const userId = c.req.param("userId")
    if (!userId) {
      return c.json(
        {
          error: "invalid_request",
          message: "userId is required",
        },
        400,
      )
    }

    await service.removeAccount(browserSession.id, userId)
    return c.json({ success: true })
  })

  /**
   * DELETE /all - Sign out all accounts
   */
  app.delete("/all", async (c) => {
    const browserSession = c.get("browserSession")

    if (!browserSession) {
      return c.json(
        {
          error: "session_not_found",
          message: "No active session",
        },
        401,
      )
    }

    await service.removeAllAccounts(browserSession.id)
    return c.json({ success: true })
  })

  /**
   * GET /check - Silent session check with CORS headers
   *
   * Used for silent authentication checks from client applications.
   * Returns session status without sensitive data.
   */
  app.get(
    "/check",
    cors({
      origin: "*",
      allowMethods: ["GET", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }),
    async (c) => {
      const browserSession = c.get("browserSession")

      if (!browserSession) {
        const response: SessionCheckResponse = {
          active: false,
        }
        return c.json(response)
      }

      const response: SessionCheckResponse = {
        active: true,
        sessionId: browserSession.id,
        tenantId: browserSession.tenant_id,
        activeUserId: browserSession.active_user_id ?? undefined,
        accountCount: browserSession.account_user_ids.length,
      }

      return c.json(response)
    },
  )

  return app
}

/**
 * Create admin routes for session management.
 *
 * These routes should be protected by admin authentication middleware.
 *
 * @param service - The session service instance
 * @returns Hono app with admin session routes
 *
 * @example
 * ```typescript
 * import { Hono } from "hono"
 * import { adminSessionRoutes } from "./session/routes.js"
 * import { SessionServiceImpl } from "./session/service.js"
 *
 * const sessionService = new SessionServiceImpl(storage)
 * const app = new Hono()
 *
 * // Protected by admin auth middleware
 * app.route("/admin/sessions", adminSessionRoutes(sessionService))
 * ```
 */
export function adminSessionRoutes(service: SessionService): Hono {
  const app = new Hono()

  /**
   * POST /revoke-user - Revoke all sessions for a user
   *
   * Request body: { tenantId: string, userId: string }
   */
  app.post("/revoke-user", async (c) => {
    let body: RevokeUserSessionsRequest
    try {
      body = await c.req.json<RevokeUserSessionsRequest>()
    } catch {
      return c.json(
        {
          error: "invalid_request",
          message: "Invalid JSON body",
        },
        400,
      )
    }

    if (
      !body.tenantId ||
      typeof body.tenantId !== "string" ||
      !body.userId ||
      typeof body.userId !== "string"
    ) {
      return c.json(
        {
          error: "invalid_request",
          message: "tenantId and userId are required",
        },
        400,
      )
    }

    const revokedCount = await service.revokeUserSessions(
      body.tenantId,
      body.userId,
    )

    return c.json({
      success: true,
      revokedCount,
    })
  })

  /**
   * POST /revoke - Revoke a specific session
   *
   * Request body: { sessionId: string, tenantId: string }
   */
  app.post("/revoke", async (c) => {
    let body: RevokeSessionRequest
    try {
      body = await c.req.json<RevokeSessionRequest>()
    } catch {
      return c.json(
        {
          error: "invalid_request",
          message: "Invalid JSON body",
        },
        400,
      )
    }

    if (
      !body.sessionId ||
      typeof body.sessionId !== "string" ||
      !body.tenantId ||
      typeof body.tenantId !== "string"
    ) {
      return c.json(
        {
          error: "invalid_request",
          message: "sessionId and tenantId are required",
        },
        400,
      )
    }

    const revoked = await service.revokeSpecificSession(
      body.sessionId,
      body.tenantId,
    )

    if (!revoked) {
      return c.json(
        {
          error: "session_not_found",
          message: "Session not found",
        },
        404,
      )
    }

    return c.json({ success: true })
  })

  return app
}
