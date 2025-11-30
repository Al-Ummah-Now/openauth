/**
 * Complete API Gateway Example with Enterprise Features
 *
 * This example demonstrates a production-ready API gateway that:
 * - Automatically detects available enterprise features
 * - Uses introspection for sensitive operations
 * - Uses JWT verification for regular operations
 * - Provides graceful degradation
 * - Works with or without enterprise features
 */

import express from "express"
import { createAuthMiddleware } from "./auth-middleware"

const PORT = process.env.PORT || 3001
const ISSUER = process.env.OAUTH_ISSUER || "http://localhost:3000"
const CLIENT_ID = process.env.OAUTH_CLIENT_ID || "api-gateway"
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET // Optional

async function main() {
  const app = express()

  // Create auth middleware with automatic feature detection
  const authMiddleware = await createAuthMiddleware({
    issuer: ISSUER,
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
  })

  // Health check
  app.get("/health", (req, res) => {
    res.json({ status: "ok" })
  })

  // Feature availability endpoint
  app.get("/features", (req, res) => {
    res.json({
      introspection: authMiddleware.features.introspection,
      revocation: authMiddleware.features.revocation,
      validation: authMiddleware.features.validation,
      description: {
        introspection: authMiddleware.features.introspection
          ? "Server-side token validation available"
          : "Using local JWT verification",
        revocation: authMiddleware.features.revocation
          ? "Token revocation available"
          : "Tokens expire naturally",
        validation:
          authMiddleware.features.validation === "hybrid"
            ? "Using both introspection and JWT based on operation"
            : authMiddleware.features.validation === "introspection"
              ? "Using server-side introspection only"
              : "Using local JWT verification only",
      },
    })
  })

  // Public endpoint (no auth required)
  app.get("/", (req, res) => {
    res.json({
      message: "API Gateway with Enterprise Features",
      docs: "/features",
    })
  })

  // Protected endpoint - uses default validation (JWT or hybrid)
  app.get("/api/users", authMiddleware(), (req, res) => {
    res.json({
      user: req.user,
      validatedBy: req.validationMethod,
      message: "This endpoint uses default validation (fast)",
    })
  })

  // Protected endpoint with user data
  app.get("/api/profile", authMiddleware(), (req, res) => {
    res.json({
      profile: {
        id: req.user?.properties?.id,
        type: req.user?.type,
      },
      validatedBy: req.validationMethod,
    })
  })

  // Sensitive operation - forces introspection if available
  app.delete(
    "/api/users/:id",
    authMiddleware({ forceIntrospection: true }),
    (req, res) => {
      res.json({
        deleted: req.params.id,
        validatedBy: req.validationMethod,
        message: "This endpoint uses introspection when available (secure)",
      })
    },
  )

  // Admin endpoint - forces introspection if available
  app.post(
    "/api/admin/action",
    authMiddleware({ forceIntrospection: true }),
    (req, res) => {
      res.json({
        action: "performed",
        performedBy: req.user?.properties?.id,
        validatedBy: req.validationMethod,
        message: "Admin actions always use strongest validation available",
      })
    },
  )

  // Payment endpoint - forces introspection if available
  app.post(
    "/api/payments",
    authMiddleware({ forceIntrospection: true }),
    (req, res) => {
      res.json({
        payment: "processed",
        user: req.user?.properties?.id,
        validatedBy: req.validationMethod,
        message: "Payment operations require strongest validation",
      })
    },
  )

  // Introspection example endpoint
  app.post("/api/introspect", authMiddleware(), async (req, res) => {
    if (!authMiddleware.features.introspection) {
      return res.status(501).json({
        error: "not_implemented",
        message: "Introspection not available on auth server",
        fallback: "Using JWT verification instead",
      })
    }

    res.json({
      available: true,
      message: "Introspection is available",
      validation: req.validationMethod,
    })
  })

  // Cache management endpoint
  app.post("/api/cache/clear", authMiddleware(), (req, res) => {
    authMiddleware.clearCache()
    res.json({ message: "Cache cleared" })
  })

  // Error handling
  app.use(
    (
      err: any,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      console.error("Error:", err)
      res.status(500).json({
        error: "internal_error",
        message: err.message,
      })
    },
  )

  app.listen(PORT, () => {
    console.log(`\n🚀 API Gateway listening on port ${PORT}`)
    console.log(`   Health: http://localhost:${PORT}/health`)
    console.log(`   Features: http://localhost:${PORT}/features`)
    console.log(`   API: http://localhost:${PORT}/api/users`)
    console.log(`\n📝 Example requests:`)
    console.log(`   curl http://localhost:${PORT}/features`)
    console.log(
      `   curl -H "Authorization: Bearer <token>" http://localhost:${PORT}/api/users`,
    )
    console.log(
      `   curl -X DELETE -H "Authorization: Bearer <token>" http://localhost:${PORT}/api/users/123`,
    )
    console.log(``)
  })
}

main().catch(console.error)
