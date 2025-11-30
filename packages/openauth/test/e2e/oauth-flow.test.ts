import { expect, test, describe, beforeAll, afterAll } from "bun:test"
import { issuer } from "../../src/issuer.js"
import { MemoryStorage } from "../../src/storage/memory.js"
import { PasswordUI } from "../../src/ui/password.js"
import { PasswordProvider } from "../../src/provider/password.js"
import { createSubjects } from "../../src/subject.js"
import { object, string } from "valibot"
import { serve } from "@hono/node-server"
import type { Server } from "http"
import { CookieJar } from "./cookie-jar.js"

// Test subjects
const subjects = createSubjects({
  user: object({
    id: string(),
  }),
})

// Mock user database
const users = new Map<string, string>()
let verificationCodes = new Map<string, string>()

async function getUser(email: string): Promise<string> {
  if (!users.has(email)) {
    const userId = crypto.randomUUID()
    users.set(email, userId)
  }
  return users.get(email)!
}

describe("OAuth 2.0 End-to-End Flow", () => {
  let server: Server
  let issuerUrl: string
  const port = 9876

  beforeAll(async () => {
    issuerUrl = `http://localhost:${port}`

    // Create issuer app
    const app = issuer({
      subjects,
      storage: MemoryStorage(),
      providers: {
        password: PasswordProvider(
          PasswordUI({
            sendCode: async (email, code) => {
              // Store verification code for testing
              verificationCodes.set(email, code)
              console.log(`[TEST] Verification code for ${email}: ${code}`)
            },
          }),
        ),
      },
      success: async (ctx, value) => {
        if (value.provider === "password") {
          return ctx.subject("user", {
            id: await getUser(value.email),
          })
        }
        throw new Error("Invalid provider")
      },
    })

    // Start server
    server = serve({
      fetch: app.fetch,
      port,
    })

    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  afterAll(() => {
    if (server) {
      server.close()
    }
  })

  test("server starts and responds to well-known endpoint", async () => {
    const response = await fetch(
      `${issuerUrl}/.well-known/oauth-authorization-server`,
    )

    expect(response.status).toBe(200)

    const metadata = await response.json()
    expect(metadata.issuer).toBe(issuerUrl)
    expect(metadata.authorization_endpoint).toBe(`${issuerUrl}/authorize`)
    expect(metadata.token_endpoint).toBe(`${issuerUrl}/token`)
    expect(metadata.jwks_uri).toBe(`${issuerUrl}/.well-known/jwks.json`)
    expect(Array.isArray(metadata.response_types_supported)).toBe(true)
    expect(metadata.response_types_supported).toContain("code")
    expect(Array.isArray(metadata.grant_types_supported)).toBe(true)
    expect(metadata.grant_types_supported).toContain("authorization_code")
    expect(metadata.grant_types_supported).toContain("refresh_token")
  })

  test("complete password registration and authentication flow", async () => {
    const cookieJar = new CookieJar()
    const testEmail = `test-${Date.now()}@example.com`
    const testPassword = "SecurePassword123!"
    const clientId = "test-client"
    const redirectUri = "http://localhost:3000/callback"
    const state = crypto.randomUUID()

    // Step 1: Start OAuth authorization flow first
    const authorizeUrl = new URL(`${issuerUrl}/authorize`)
    authorizeUrl.searchParams.set("client_id", clientId)
    authorizeUrl.searchParams.set("redirect_uri", redirectUri)
    authorizeUrl.searchParams.set("response_type", "code")
    authorizeUrl.searchParams.set("state", state)
    authorizeUrl.searchParams.set("provider", "password")

    // This will redirect to /password/authorize (sets authorization cookie)
    const authorizeResponse = await cookieJar.fetch(authorizeUrl.toString())
    expect(authorizeResponse.status).toBe(302)
    expect(authorizeResponse.headers.get("location")).toBe(
      "/password/authorize",
    )

    // Step 2: Navigate to registration (within the OAuth flow, cookies maintained)
    const registerUrl = `${issuerUrl}/password/register`
    const registerStartResponse = await cookieJar.fetch(registerUrl)
    expect(registerStartResponse.status).toBe(200)

    // Step 3: Submit registration with email and password
    const registerSubmitResponse = await cookieJar.fetch(registerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        action: "register",
        email: testEmail,
        password: testPassword,
        repeat: testPassword,
      }).toString(),
    })

    expect(registerSubmitResponse.status).toBe(200)

    // Verification code should have been sent
    const verificationCode = verificationCodes.get(testEmail)
    expect(verificationCode).toBeDefined()
    expect(verificationCode).toMatch(/^\d{6}$/)

    // Step 4: Verify email with code (completes registration and OAuth flow)
    const verifyCodeResponse = await cookieJar.fetch(registerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        action: "verify",
        code: verificationCode!,
      }).toString(),
    })

    // Should redirect to callback with authorization code
    expect(verifyCodeResponse.status).toBe(302)

    const location = verifyCodeResponse.headers.get("location")
    expect(location).toBeTruthy()

    const callbackUrl = new URL(location!)
    const authCode = callbackUrl.searchParams.get("code")
    const returnedState = callbackUrl.searchParams.get("state")

    expect(authCode).toBeTruthy()
    expect(returnedState).toBe(state)

    // Step 5: Exchange authorization code for tokens
    const tokenResponse = await fetch(`${issuerUrl}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authCode!,
        redirect_uri: redirectUri,
        client_id: clientId,
      }).toString(),
    })

    expect(tokenResponse.status).toBe(200)

    const tokens = await tokenResponse.json()
    expect(tokens.access_token).toBeTruthy()
    expect(tokens.refresh_token).toBeTruthy()
    expect(tokens.token_type).toBe("bearer")
    expect(tokens.expires_in).toBeGreaterThan(0)

    // Step 6: Verify access token contains correct subject
    const [_header, payloadB64] = tokens.access_token.split(".")
    const payload = JSON.parse(
      Buffer.from(
        payloadB64.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString(),
    )

    expect(payload.type).toBe("user")
    expect(payload.properties.id).toBeTruthy()
    expect(payload.iss).toBe(issuerUrl)

    // Step 7: Test token refresh
    const refreshResponse = await fetch(`${issuerUrl}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      }).toString(),
    })

    expect(refreshResponse.status).toBe(200)

    const refreshedTokens = await refreshResponse.json()
    expect(refreshedTokens.access_token).toBeTruthy()
    expect(refreshedTokens.refresh_token).toBeTruthy()
    expect(refreshedTokens.access_token).not.toBe(tokens.access_token) // New token
  })

  test("well-known metadata includes correct grant types", async () => {
    const response = await fetch(
      `${issuerUrl}/.well-known/oauth-authorization-server`,
    )

    const metadata = await response.json()
    expect(Array.isArray(metadata.grant_types_supported)).toBe(true)
    expect(metadata.grant_types_supported).toContain("authorization_code")
    expect(metadata.grant_types_supported).toContain("refresh_token")
  })

  test("invalid verification code returns error during registration", async () => {
    const cookieJar = new CookieJar()
    const testEmail = `invalid-${Date.now()}@example.com`
    const testPassword = "SecurePassword123!"
    const clientId = "test-client"
    const redirectUri = "http://localhost:3000/callback"
    const state = crypto.randomUUID()

    // Step 1: Start OAuth authorization flow
    const authorizeUrl = new URL(`${issuerUrl}/authorize`)
    authorizeUrl.searchParams.set("client_id", clientId)
    authorizeUrl.searchParams.set("redirect_uri", redirectUri)
    authorizeUrl.searchParams.set("response_type", "code")
    authorizeUrl.searchParams.set("state", state)
    authorizeUrl.searchParams.set("provider", "password")

    await cookieJar.fetch(authorizeUrl.toString())

    // Step 2: Start registration
    const registerUrl = `${issuerUrl}/password/register`
    await cookieJar.fetch(registerUrl)

    // Step 3: Submit registration
    await cookieJar.fetch(registerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        action: "register",
        email: testEmail,
        password: testPassword,
        repeat: testPassword,
      }).toString(),
    })

    // Verify code should have been sent
    const validCode = verificationCodes.get(testEmail)
    expect(validCode).toBeDefined()

    // Step 4: Try with wrong code
    const verifyResponse = await cookieJar.fetch(registerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        action: "verify",
        code: "000000", // Wrong code
      }).toString(),
    })

    // Should show error (not redirect)
    expect(verifyResponse.status).toBe(200)
    const html = await verifyResponse.text()
    expect(html.toLowerCase()).toContain("code") // Error about code
  })

  test("authorize endpoint requires client_id and redirect_uri", async () => {
    // Missing client_id
    const response1 = await fetch(`${issuerUrl}/authorize?response_type=code`, {
      redirect: "manual",
    })
    expect(response1.status).toBe(400)

    // Missing redirect_uri
    const response2 = await fetch(
      `${issuerUrl}/authorize?client_id=test&response_type=code`,
      {
        redirect: "manual",
      },
    )
    expect(response2.status).toBe(400)
  })
})
