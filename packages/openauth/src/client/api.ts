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
      enabled:
        enabled === "true" ? true : enabled === "false" ? false : undefined,
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
        {
          error: "Bad Request",
          message: "name is required and must be a string",
        },
        400,
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
        201,
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
        gracePeriod,
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
