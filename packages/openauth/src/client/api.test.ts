import { describe, test, expect, beforeEach, mock } from "bun:test"
import { Hono } from "hono"
import { clientAdminRoutes } from "./api.js"
import { ClientNotFoundError, ClientNameConflictError } from "./errors.js"

// Define Variables type for tests
type Variables = {
  tenantId: string
}

// Mock D1Database
const mockDb = {
  prepare: mock(() => ({
    bind: mock(() => ({
      first: mock(() => Promise.resolve(null)),
      all: mock(() => Promise.resolve({ results: [] })),
      run: mock(() => Promise.resolve({ success: true })),
    })),
  })),
}

describe("Client Management API", () => {
  let app: Hono<{ Variables: Variables }>

  beforeEach(() => {
    // Create the app with middleware to set tenantId
    app = new Hono<{ Variables: Variables }>()
    app.use("*", async (c, next) => {
      c.set("tenantId", "test-tenant")
      await next()
    })
    app.route("/", clientAdminRoutes(mockDb as any))
  })

  describe("POST /clients", () => {
    test("returns 400 for missing name", async () => {
      const res = await app.request("/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { message: string }
      expect(body.message).toContain("name is required")
    })

    test("returns 400 for invalid JSON", async () => {
      const res = await app.request("/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { message: string }
      expect(body.message).toContain("Invalid JSON body")
    })
  })

  describe("GET /clients/:clientId", () => {
    test("returns 404 for non-existent client", async () => {
      const res = await app.request("/clients/non-existent")
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe("Not Found")
    })
  })

  describe("PATCH /clients/:clientId", () => {
    test("returns 400 for invalid JSON", async () => {
      const res = await app.request("/clients/test-id", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { message: string }
      expect(body.message).toContain("Invalid JSON body")
    })
  })

  describe("DELETE /clients/:clientId", () => {
    test("returns 404 for non-existent client", async () => {
      const res = await app.request("/clients/non-existent", {
        method: "DELETE",
      })
      expect(res.status).toBe(404)
    })
  })

  describe("POST /clients/:clientId/rotate", () => {
    test("returns 404 for non-existent client", async () => {
      const res = await app.request("/clients/non-existent/rotate", {
        method: "POST",
      })
      expect(res.status).toBe(404)
    })
  })
})

describe("Error Handling", () => {
  test("ClientNotFoundError returns 404", async () => {
    const app = new Hono<{ Variables: Variables }>()
    app.use("*", async (c, next) => {
      c.set("tenantId", "test-tenant")
      await next()
    })

    // Mock service that throws ClientNotFoundError
    const mockService = {
      getClient: mock(() => Promise.resolve(null)),
      deleteClient: mock((_clientId: string, _tenantId: string) => {
        throw new ClientNotFoundError("test-id")
      }),
    }

    app.delete("/clients/:clientId", async (c) => {
      const clientId = c.req.param("clientId")
      const tenantId = c.get("tenantId")
      try {
        await mockService.deleteClient(clientId, tenantId)
        return c.body(null, 204)
      } catch (error) {
        if (error instanceof ClientNotFoundError) {
          return c.json({ error: "Not Found", message: error.message }, 404)
        }
        throw error
      }
    })

    const res = await app.request("/clients/test-id", { method: "DELETE" })
    expect(res.status).toBe(404)
  })

  test("ClientNameConflictError returns 409", async () => {
    const app = new Hono<{ Variables: Variables }>()
    app.use("*", async (c, next) => {
      c.set("tenantId", "test-tenant")
      await next()
    })

    app.post("/clients", async () => {
      throw new ClientNameConflictError("My App")
    })

    app.onError((err, c) => {
      if (err instanceof ClientNameConflictError) {
        return c.json({ error: "Conflict", message: err.message }, 409)
      }
      throw err
    })

    const res = await app.request("/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "My App" }),
    })
    expect(res.status).toBe(409)
  })
})
