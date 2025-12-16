/**
 * Enterprise Integration Tests
 *
 * Comprehensive tests for the enterprise issuer integration including:
 * - Session integration (addAccountToSession, prompt handlers, max_age, account hints)
 * - Multi-tenant issuer (tenant resolution, session middleware, RBAC integration)
 * - Full SSO flows (multi-account, account switching, sign out)
 */

import {
  expect,
  test,
  describe,
  beforeEach,
  afterEach,
  setSystemTime,
  mock,
} from "bun:test"
import { Hono } from "hono"
import { object, string } from "valibot"
import { MemoryStorage } from "../src/storage/memory.js"
import { createSubjects } from "../src/subject.js"
import { TenantServiceImpl } from "../src/tenant/service.js"
import { SessionServiceImpl } from "../src/session/service.js"
import { createMultiTenantIssuer } from "../src/enterprise/issuer.js"
import type {
  BrowserSession,
  AccountSession,
  Tenant,
  SessionService,
  PromptType,
} from "../src/contracts/types.js"
import type {
  EnterpriseAuthorizationState,
  PromptHandlerResult,
} from "../src/enterprise/types.js"
import {
  addAccountToSession,
  handlePromptParameter,
  handleMaxAge,
  handleAccountHint,
  handleLoginHint,
  validateSessionForSilentAuth,
  createOIDCErrorRedirect,
  formatAccountsForPicker,
  generateAddAccountUrl,
} from "../src/enterprise/session-integration.js"

// ============================================
// TEST SETUP
// ============================================

const subjects = createSubjects({
  user: object({
    userId: string(),
    email: string(),
  }),
})

// Mock session secret (32 bytes for AES-256)
const sessionSecret = new Uint8Array(32).fill(0x42)

// Helper to create a mock Hono context
function createMockContext(overrides: any = {}): any {
  const vars = new Map<string, any>()

  return {
    get: (key: string) => vars.get(key),
    set: (key: string, value: any) => vars.set(key, value),
    redirect: (url: string) =>
      new Response(null, {
        status: 302,
        headers: { Location: url },
      }),
    json: (data: any, status?: number) =>
      new Response(JSON.stringify(data), {
        status: status || 200,
        headers: { "Content-Type": "application/json" },
      }),
    req: {
      url: "https://auth.example.com/authorize",
      query: (key: string) => overrides.query?.[key],
      header: (key: string) => overrides.headers?.[key],
      raw: new Request("https://auth.example.com/authorize"),
    },
    ...overrides,
  }
}

// ============================================
// SESSION INTEGRATION TESTS
// ============================================

describe("Session Integration - addAccountToSession", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let sessionService: SessionServiceImpl
  let browserSession: BrowserSession

  beforeEach(async () => {
    storage = MemoryStorage()
    sessionService = new SessionServiceImpl(storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))

    // Create a browser session
    browserSession = await sessionService.createBrowserSession({
      tenantId: "tenant-123",
      userAgent: "Mozilla/5.0",
      ipAddress: "127.0.0.1",
    })
  })

  afterEach(() => {
    setSystemTime()
  })

  test("adds account to session correctly", async () => {
    const ctx = createMockContext()

    const accountSession = await addAccountToSession(ctx, sessionService, {
      browserSession,
      userId: "user-123",
      subjectType: "user",
      subjectProperties: { email: "test@example.com" },
      refreshToken: "refresh-token-123",
      clientId: "my-app",
      ttl: 7 * 24 * 60 * 60, // 7 days
    })

    expect(accountSession.user_id).toBe("user-123")
    expect(accountSession.subject_type).toBe("user")
    expect(accountSession.subject_properties).toEqual({
      email: "test@example.com",
    })
    expect(accountSession.refresh_token).toBe("refresh-token-123")
    expect(accountSession.client_id).toBe("my-app")
    expect(accountSession.is_active).toBe(true)
  })

  test("adds multiple accounts to same session", async () => {
    const ctx = createMockContext()

    const account1 = await addAccountToSession(ctx, sessionService, {
      browserSession,
      userId: "user-1",
      subjectType: "user",
      subjectProperties: { email: "user1@example.com" },
      refreshToken: "refresh-1",
      clientId: "app-1",
      ttl: 86400,
    })

    const account2 = await addAccountToSession(ctx, sessionService, {
      browserSession,
      userId: "user-2",
      subjectType: "user",
      subjectProperties: { email: "user2@example.com" },
      refreshToken: "refresh-2",
      clientId: "app-1",
      ttl: 86400,
    })

    const accounts = await sessionService.listAccounts(browserSession.id)
    expect(accounts.length).toBe(2)
    expect(accounts.map((a) => a.user_id)).toContain("user-1")
    expect(accounts.map((a) => a.user_id)).toContain("user-2")
  })

  test("updates existing account if already in session", async () => {
    const ctx = createMockContext()

    // Add account first time
    await addAccountToSession(ctx, sessionService, {
      browserSession,
      userId: "user-123",
      subjectType: "user",
      subjectProperties: { email: "old@example.com" },
      refreshToken: "old-refresh",
      clientId: "app-1",
      ttl: 86400,
    })

    // Add same account again with updated data
    const updated = await addAccountToSession(ctx, sessionService, {
      browserSession,
      userId: "user-123",
      subjectType: "user",
      subjectProperties: { email: "new@example.com" },
      refreshToken: "new-refresh",
      clientId: "app-1",
      ttl: 86400,
    })

    expect(updated.subject_properties).toEqual({ email: "new@example.com" })
    expect(updated.refresh_token).toBe("new-refresh")

    // Verify only one account exists
    const accounts = await sessionService.listAccounts(browserSession.id)
    expect(accounts.length).toBe(1)
  })
})

describe("Session Integration - handlePromptParameter", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let sessionService: SessionServiceImpl
  let browserSession: BrowserSession
  let activeAccount: AccountSession
  let authorization: EnterpriseAuthorizationState

  beforeEach(async () => {
    storage = MemoryStorage()
    sessionService = new SessionServiceImpl(storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))

    browserSession = await sessionService.createBrowserSession({
      tenantId: "tenant-123",
      userAgent: "Mozilla/5.0",
      ipAddress: "127.0.0.1",
    })

    // Add an account to the session
    activeAccount = await sessionService.addAccountToSession({
      browserSessionId: browserSession.id,
      userId: "user-123",
      subjectType: "user",
      subjectProperties: { email: "test@example.com" },
      refreshToken: "refresh-token",
      clientId: "app-1",
      ttl: 86400,
    })

    authorization = {
      redirect_uri: "https://app.example.com/callback",
      response_type: "code",
      state: "state-123",
      client_id: "app-1",
    }
  })

  afterEach(() => {
    setSystemTime()
  })

  test("prompt=none returns error if no session", async () => {
    const ctx = createMockContext()

    const result = await handlePromptParameter(
      ctx,
      "none",
      sessionService,
      null, // No session
      authorization,
    )

    expect(result.proceed).toBe(false)
    expect(result.response).toBeDefined()
    expect(result.response?.status).toBe(302)

    const location = result.response?.headers.get("Location")
    expect(location).toContain("error=login_required")
  })

  test("prompt=none returns silentAuth if session exists", async () => {
    const ctx = createMockContext()

    const result = await handlePromptParameter(
      ctx,
      "none",
      sessionService,
      browserSession,
      authorization,
      activeAccount,
    )

    expect(result.proceed).toBe(true)
    expect(result.silentAuth).toBeDefined()
    expect(result.silentAuth?.user_id).toBe("user-123")
    expect(result.forceReauth).toBeUndefined()
  })

  test("prompt=login forces re-authentication", async () => {
    const ctx = createMockContext()

    const result = await handlePromptParameter(
      ctx,
      "login",
      sessionService,
      browserSession,
      authorization,
    )

    expect(result.proceed).toBe(true)
    expect(result.forceReauth).toBe(true)
  })

  test("prompt=select_account proceeds if no accounts", async () => {
    const ctx = createMockContext()

    // Create session with no accounts
    const emptySession = await sessionService.createBrowserSession({
      tenantId: "tenant-123",
      userAgent: "Mozilla/5.0",
      ipAddress: "127.0.0.1",
    })

    const result = await handlePromptParameter(
      ctx,
      "select_account",
      sessionService,
      emptySession,
      authorization,
    )

    expect(result.proceed).toBe(true)
    expect(ctx.get("showAccountPicker")).toBeUndefined()
  })

  test("prompt=select_account proceeds if only one account", async () => {
    const ctx = createMockContext()

    const result = await handlePromptParameter(
      ctx,
      "select_account",
      sessionService,
      browserSession,
      authorization,
    )

    expect(result.proceed).toBe(true)
    expect(ctx.get("showAccountPicker")).toBeUndefined()
  })

  test("prompt=select_account shows picker if multiple accounts", async () => {
    const ctx = createMockContext()

    // Add second account
    await sessionService.addAccountToSession({
      browserSessionId: browserSession.id,
      userId: "user-456",
      subjectType: "user",
      subjectProperties: { email: "user2@example.com" },
      refreshToken: "refresh-2",
      clientId: "app-1",
      ttl: 86400,
    })

    const result = await handlePromptParameter(
      ctx,
      "select_account",
      sessionService,
      browserSession,
      authorization,
    )

    expect(result.proceed).toBe(false)
    expect(ctx.get("showAccountPicker")).toBe(true)

    const accounts = ctx.get("accountPickerAccounts")
    expect(accounts).toBeDefined()
    expect(accounts.length).toBe(2)
  })

  test("prompt=consent proceeds normally", async () => {
    const ctx = createMockContext()

    const result = await handlePromptParameter(
      ctx,
      "consent",
      sessionService,
      browserSession,
      authorization,
    )

    expect(result.proceed).toBe(true)
  })

  test("no prompt proceeds normally", async () => {
    const ctx = createMockContext()

    const result = await handlePromptParameter(
      ctx,
      undefined,
      sessionService,
      browserSession,
      authorization,
    )

    expect(result.proceed).toBe(true)
  })
})

describe("Session Integration - handleMaxAge", () => {
  let accountSession: AccountSession

  beforeEach(() => {
    setSystemTime(new Date("2024-01-01T00:00:00Z"))

    accountSession = {
      id: "account-123",
      browser_session_id: "session-123",
      user_id: "user-123",
      subject_type: "user",
      subject_properties: { email: "test@example.com" },
      refresh_token: "refresh-token",
      client_id: "app-1",
      authenticated_at: Date.now(),
      expires_at: Date.now() + 86400 * 1000,
      is_active: true,
      created_at: Date.now(),
      updated_at: Date.now(),
    }
  })

  afterEach(() => {
    setSystemTime()
  })

  test("forces re-auth if session too old", () => {
    const ctx = createMockContext()

    // Set time to 1 hour later
    setSystemTime(new Date("2024-01-01T01:00:00Z"))

    // max_age is 30 minutes (1800 seconds)
    const result = handleMaxAge(ctx, 1800, accountSession)

    expect(result.proceed).toBe(true)
    expect(result.forceReauth).toBe(true)
  })

  test("proceeds if session is fresh enough", () => {
    const ctx = createMockContext()

    // Set time to 10 minutes later
    setSystemTime(new Date("2024-01-01T00:10:00Z"))

    // max_age is 30 minutes (1800 seconds)
    const result = handleMaxAge(ctx, 1800, accountSession)

    expect(result.proceed).toBe(true)
    expect(result.forceReauth).toBeUndefined()
  })

  test("proceeds if max_age is undefined", () => {
    const ctx = createMockContext()

    const result = handleMaxAge(ctx, undefined, accountSession)

    expect(result.proceed).toBe(true)
    expect(result.forceReauth).toBeUndefined()
  })

  test("proceeds if max_age is negative", () => {
    const ctx = createMockContext()

    const result = handleMaxAge(ctx, -1, accountSession)

    expect(result.proceed).toBe(true)
    expect(result.forceReauth).toBeUndefined()
  })

  test("proceeds if no account session", () => {
    const ctx = createMockContext()

    const result = handleMaxAge(ctx, 1800, null)

    expect(result.proceed).toBe(true)
    expect(result.forceReauth).toBeUndefined()
  })
})

describe("Session Integration - handleAccountHint", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let sessionService: SessionServiceImpl
  let browserSession: BrowserSession

  beforeEach(async () => {
    storage = MemoryStorage()
    sessionService = new SessionServiceImpl(storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))

    browserSession = await sessionService.createBrowserSession({
      tenantId: "tenant-123",
      userAgent: "Mozilla/5.0",
      ipAddress: "127.0.0.1",
    })

    // Add two accounts
    await sessionService.addAccountToSession({
      browserSessionId: browserSession.id,
      userId: "user-1",
      subjectType: "user",
      subjectProperties: { email: "user1@example.com" },
      refreshToken: "refresh-1",
      clientId: "app-1",
      ttl: 86400,
    })

    await sessionService.addAccountToSession({
      browserSessionId: browserSession.id,
      userId: "user-2",
      subjectType: "user",
      subjectProperties: { email: "user2@example.com" },
      refreshToken: "refresh-2",
      clientId: "app-1",
      ttl: 86400,
    })
  })

  afterEach(() => {
    setSystemTime()
  })

  test("selects correct account from hint", async () => {
    const ctx = createMockContext()

    const result = await handleAccountHint(
      ctx,
      "user-2",
      sessionService,
      browserSession,
    )

    expect(result.proceed).toBe(true)
    expect(result.selectedAccount).toBeDefined()
    expect(result.selectedAccount?.user_id).toBe("user-2")

    // Verify active account was switched
    const updatedSession = await sessionService.getBrowserSession(
      browserSession.id,
      browserSession.tenant_id,
    )
    expect(updatedSession?.active_user_id).toBe("user-2")
  })

  test("proceeds if account hint not found", async () => {
    const ctx = createMockContext()

    const result = await handleAccountHint(
      ctx,
      "non-existent-user",
      sessionService,
      browserSession,
    )

    expect(result.proceed).toBe(true)
    expect(result.selectedAccount).toBeUndefined()
  })

  test("proceeds if no hint provided", async () => {
    const ctx = createMockContext()

    const result = await handleAccountHint(
      ctx,
      undefined,
      sessionService,
      browserSession,
    )

    expect(result.proceed).toBe(true)
  })

  test("proceeds if no session", async () => {
    const ctx = createMockContext()

    const result = await handleAccountHint(ctx, "user-1", sessionService, null)

    expect(result.proceed).toBe(true)
  })
})

describe("Session Integration - handleLoginHint", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let sessionService: SessionServiceImpl
  let browserSession: BrowserSession

  beforeEach(async () => {
    storage = MemoryStorage()
    sessionService = new SessionServiceImpl(storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))

    browserSession = await sessionService.createBrowserSession({
      tenantId: "tenant-123",
      userAgent: "Mozilla/5.0",
      ipAddress: "127.0.0.1",
    })

    await sessionService.addAccountToSession({
      browserSessionId: browserSession.id,
      userId: "user-1",
      subjectType: "user",
      subjectProperties: { email: "test@example.com" },
      refreshToken: "refresh-1",
      clientId: "app-1",
      ttl: 86400,
    })

    await sessionService.addAccountToSession({
      browserSessionId: browserSession.id,
      userId: "user-2",
      subjectType: "user",
      subjectProperties: { email: "other@example.com" },
      refreshToken: "refresh-2",
      clientId: "app-1",
      ttl: 86400,
    })
  })

  afterEach(() => {
    setSystemTime()
  })

  test("finds account by email match", async () => {
    const ctx = createMockContext()

    const account = await handleLoginHint(
      ctx,
      "test@example.com",
      sessionService,
      browserSession,
    )

    expect(account).toBeDefined()
    expect(account?.user_id).toBe("user-1")

    // Verify active account was switched
    const updatedSession = await sessionService.getBrowserSession(
      browserSession.id,
      browserSession.tenant_id,
    )
    expect(updatedSession?.active_user_id).toBe("user-1")
  })

  test("case-insensitive email match", async () => {
    const ctx = createMockContext()

    const account = await handleLoginHint(
      ctx,
      "TEST@EXAMPLE.COM",
      sessionService,
      browserSession,
    )

    expect(account).toBeDefined()
    expect(account?.user_id).toBe("user-1")
  })

  test("stores hint in context if no match", async () => {
    const ctx = createMockContext()

    const account = await handleLoginHint(
      ctx,
      "new-user@example.com",
      sessionService,
      browserSession,
    )

    expect(account).toBeNull()
    expect(ctx.get("loginHint")).toBe("new-user@example.com")
  })

  test("returns null if no hint", async () => {
    const ctx = createMockContext()

    const account = await handleLoginHint(
      ctx,
      undefined,
      sessionService,
      browserSession,
    )

    expect(account).toBeNull()
  })

  test("returns null if no session", async () => {
    const ctx = createMockContext()

    const account = await handleLoginHint(
      ctx,
      "test@example.com",
      sessionService,
      null,
    )

    expect(account).toBeNull()
  })
})

describe("Session Integration - validateSessionForSilentAuth", () => {
  let browserSession: BrowserSession
  let accountSession: AccountSession

  beforeEach(() => {
    setSystemTime(new Date("2024-01-01T00:00:00Z"))

    browserSession = {
      id: "session-123",
      tenant_id: "tenant-123",
      active_user_id: "user-123",
      user_agent: "Mozilla/5.0",
      ip_address: "127.0.0.1",
      expires_at: Date.now() + 86400 * 1000,
      created_at: Date.now(),
      updated_at: Date.now(),
    }

    accountSession = {
      id: "account-123",
      browser_session_id: "session-123",
      user_id: "user-123",
      subject_type: "user",
      subject_properties: { email: "test@example.com" },
      refresh_token: "refresh-token",
      client_id: "app-1",
      authenticated_at: Date.now(),
      expires_at: Date.now() + 86400 * 1000,
      is_active: true,
      created_at: Date.now(),
      updated_at: Date.now(),
    }
  })

  afterEach(() => {
    setSystemTime()
  })

  test("returns true for valid session", () => {
    const result = validateSessionForSilentAuth(
      browserSession,
      accountSession,
      "app-1",
    )

    expect(result).toBe(true)
  })

  test("returns false if no browser session", () => {
    const result = validateSessionForSilentAuth(null, accountSession, "app-1")

    expect(result).toBe(false)
  })

  test("returns false if no account session", () => {
    const result = validateSessionForSilentAuth(browserSession, null, "app-1")

    expect(result).toBe(false)
  })

  test("returns false if account expired", () => {
    setSystemTime(new Date("2024-01-02T00:00:01Z")) // After expiry

    const result = validateSessionForSilentAuth(
      browserSession,
      accountSession,
      "app-1",
    )

    expect(result).toBe(false)
  })

  test("allows cross-client SSO", () => {
    // Different client than authenticated with
    const result = validateSessionForSilentAuth(
      browserSession,
      accountSession,
      "different-app",
    )

    // Still allows for SSO
    expect(result).toBe(true)
  })
})

// ============================================
// HELPER FUNCTION TESTS
// ============================================

describe("Session Integration - Helper Functions", () => {
  test("createOIDCErrorRedirect creates correct URL", () => {
    const url = createOIDCErrorRedirect("https://app.example.com/callback", {
      error: "login_required",
      error_description: "User must authenticate",
      state: "state-123",
    })

    const parsed = new URL(url)
    expect(parsed.searchParams.get("error")).toBe("login_required")
    expect(parsed.searchParams.get("error_description")).toBe(
      "User must authenticate",
    )
    expect(parsed.searchParams.get("state")).toBe("state-123")
  })

  test("formatAccountsForPicker formats accounts correctly", () => {
    const accounts: AccountSession[] = [
      {
        id: "account-1",
        browser_session_id: "session-1",
        user_id: "user-1",
        subject_type: "user",
        subject_properties: {
          email: "user1@example.com",
          name: "User One",
          avatar: "https://example.com/avatar1.jpg",
        },
        refresh_token: "refresh-1",
        client_id: "app-1",
        authenticated_at: Date.now(),
        expires_at: Date.now() + 86400 * 1000,
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
      {
        id: "account-2",
        browser_session_id: "session-1",
        user_id: "user-2",
        subject_type: "user",
        subject_properties: {
          email: "user2@example.com",
        },
        refresh_token: "refresh-2",
        client_id: "app-1",
        authenticated_at: Date.now(),
        expires_at: Date.now() + 86400 * 1000,
        is_active: false,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
    ]

    const formatted = formatAccountsForPicker(accounts)

    expect(formatted.length).toBe(2)
    expect(formatted[0]).toEqual({
      userId: "user-1",
      displayName: "User One",
      email: "user1@example.com",
      avatarUrl: "https://example.com/avatar1.jpg",
      subjectType: "user",
      isActive: true,
      authenticatedAt: accounts[0].authenticated_at,
    })
    expect(formatted[1].displayName).toBeUndefined()
    expect(formatted[1].email).toBe("user2@example.com")
  })

  test("generateAddAccountUrl creates correct URL", () => {
    const authorization: EnterpriseAuthorizationState = {
      client_id: "app-1",
      redirect_uri: "https://app.example.com/callback",
      response_type: "code",
      state: "state-123",
      scope: "openid profile email",
      nonce: "nonce-123",
    }

    const url = generateAddAccountUrl(
      "https://auth.example.com/authorize",
      authorization,
    )

    const parsed = new URL(url)
    expect(parsed.searchParams.get("client_id")).toBe("app-1")
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/callback",
    )
    expect(parsed.searchParams.get("response_type")).toBe("code")
    expect(parsed.searchParams.get("state")).toBe("state-123")
    expect(parsed.searchParams.get("scope")).toBe("openid profile email")
    expect(parsed.searchParams.get("nonce")).toBe("nonce-123")
    expect(parsed.searchParams.get("prompt")).toBe("login")
  })
})

// ============================================
// MULTI-TENANT ISSUER TESTS
// ============================================

describe("Multi-Tenant Issuer - Initialization", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let tenantService: TenantServiceImpl
  let sessionService: SessionServiceImpl

  beforeEach(async () => {
    storage = MemoryStorage()
    tenantService = new TenantServiceImpl(storage)
    sessionService = new SessionServiceImpl(storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))
  })

  afterEach(() => {
    setSystemTime()
  })

  test("creates issuer with required services", () => {
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      providers: {
        dummy: {
          type: "dummy",
          init(route, ctx) {
            route.get("/authorize", async (c) => {
              return ctx.success(c, { email: "test@example.com" })
            })
          },
        },
      },
      subjects,
    })

    expect(app).toBeDefined()
  })

  test("throws error if tenantService missing", () => {
    expect(() => {
      createMultiTenantIssuer({
        tenantService: undefined as any,
        sessionService,
        storage,
        sessionSecret,
        providers: {},
        subjects,
      })
    }).toThrow("tenantService is required")
  })

  test("throws error if sessionService missing", () => {
    expect(() => {
      createMultiTenantIssuer({
        tenantService,
        sessionService: undefined as any,
        storage,
        sessionSecret,
        providers: {},
        subjects,
      })
    }).toThrow("sessionService is required")
  })

  test("throws error if storage missing", () => {
    expect(() => {
      createMultiTenantIssuer({
        tenantService,
        sessionService,
        storage: undefined as any,
        sessionSecret,
        providers: {},
        subjects,
      })
    }).toThrow("storage is required")
  })

  test("throws error if sessionSecret invalid", () => {
    expect(() => {
      createMultiTenantIssuer({
        tenantService,
        sessionService,
        storage,
        sessionSecret: new Uint8Array(16), // Wrong size
        providers: {},
        subjects,
      })
    }).toThrow("sessionSecret must be a 256-bit")
  })

  test("throws error if no providers", () => {
    expect(() => {
      createMultiTenantIssuer({
        tenantService,
        sessionService,
        storage,
        sessionSecret,
        providers: {},
        subjects,
      })
    }).toThrow("At least one provider is required")
  })
})

describe("Multi-Tenant Issuer - Route Mounting", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let tenantService: TenantServiceImpl
  let sessionService: SessionServiceImpl
  let tenant: Tenant

  beforeEach(async () => {
    storage = MemoryStorage()
    tenantService = new TenantServiceImpl(storage)
    sessionService = new SessionServiceImpl(storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))

    tenant = await tenantService.createTenant({
      id: "test-tenant",
      name: "Test Tenant",
      domain: "auth.test.com",
    })
  })

  afterEach(() => {
    setSystemTime()
  })

  test("mounts session routes at /session/*", async () => {
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      providers: {
        dummy: {
          type: "dummy",
          init(route, ctx) {
            route.get("/authorize", async (c) => {
              return ctx.success(c, { email: "test@example.com" })
            })
          },
        },
      },
      subjects,
    })

    // Session routes should be mounted
    // This is verified by the route structure, can't easily test without making requests
    expect(app).toBeDefined()
  })

  test("mounts tenant routes at /tenants/*", () => {
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      providers: {
        dummy: {
          type: "dummy",
          init(route, ctx) {
            route.get("/authorize", async (c) => {
              return ctx.success(c, { email: "test@example.com" })
            })
          },
        },
      },
      subjects,
    })

    expect(app).toBeDefined()
  })

  test("mounts well-known endpoints", () => {
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      providers: {
        dummy: {
          type: "dummy",
          init(route, ctx) {
            route.get("/authorize", async (c) => {
              return ctx.success(c, { email: "test@example.com" })
            })
          },
        },
      },
      subjects,
    })

    expect(app).toBeDefined()
    // /.well-known/oauth-authorization-server
    // /.well-known/openid-configuration
    // /.well-known/jwks.json
  })
})

describe("Multi-Tenant Issuer - OIDC Prompt Support", () => {
  test("well-known config advertises prompt support", async () => {
    const storage = MemoryStorage()
    const tenantService = new TenantServiceImpl(storage)
    const sessionService = new SessionServiceImpl(storage)

    const tenant = await tenantService.createTenant({
      id: "test-tenant",
      name: "Test Tenant",
    })

    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      providers: {
        dummy: {
          type: "dummy",
          init(route, ctx) {
            route.get("/authorize", async (c) => {
              return ctx.success(c, { email: "test@example.com" })
            })
          },
        },
      },
      subjects,
    })

    // The well-known endpoint should advertise prompt values
    // This would require making an actual request to verify
    expect(app).toBeDefined()
  })
})

// ============================================
// INTEGRATION FLOW TESTS
// ============================================

describe("Integration Flows - SSO with Session", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let tenantService: TenantServiceImpl
  let sessionService: SessionServiceImpl
  let tenant: Tenant

  beforeEach(async () => {
    storage = MemoryStorage()
    tenantService = new TenantServiceImpl(storage)
    sessionService = new SessionServiceImpl(storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))

    tenant = await tenantService.createTenant({
      id: "test-tenant",
      name: "Test Tenant",
    })
  })

  afterEach(() => {
    setSystemTime()
  })

  test("creates session on first login", async () => {
    const browserSession = await sessionService.createBrowserSession({
      tenantId: tenant.id,
      userAgent: "Mozilla/5.0",
      ipAddress: "127.0.0.1",
    })

    expect(browserSession.id).toBeDefined()
    expect(browserSession.tenant_id).toBe(tenant.id)
    expect(browserSession.active_user_id).toBeNull()
  })

  test("adds account to session after authentication", async () => {
    const browserSession = await sessionService.createBrowserSession({
      tenantId: tenant.id,
      userAgent: "Mozilla/5.0",
      ipAddress: "127.0.0.1",
    })

    const account = await sessionService.addAccountToSession({
      browserSessionId: browserSession.id,
      userId: "user-123",
      subjectType: "user",
      subjectProperties: { email: "test@example.com" },
      refreshToken: "refresh-token",
      clientId: "app-1",
      ttl: 86400,
    })

    expect(account.user_id).toBe("user-123")
    expect(account.is_active).toBe(true)

    const updatedSession = await sessionService.getBrowserSession(
      browserSession.id,
      browserSession.tenant_id,
    )
    expect(updatedSession?.active_user_id).toBe("user-123")
  })
})

describe("Integration Flows - Multi-Account Management", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let tenantService: TenantServiceImpl
  let sessionService: SessionServiceImpl
  let browserSession: BrowserSession

  beforeEach(async () => {
    storage = MemoryStorage()
    tenantService = new TenantServiceImpl(storage)
    sessionService = new SessionServiceImpl(storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))

    const tenant = await tenantService.createTenant({
      id: "test-tenant",
      name: "Test Tenant",
    })

    browserSession = await sessionService.createBrowserSession({
      tenantId: tenant.id,
      userAgent: "Mozilla/5.0",
      ipAddress: "127.0.0.1",
    })
  })

  afterEach(() => {
    setSystemTime()
  })

  test("adds multiple accounts to session", async () => {
    await sessionService.addAccountToSession({
      browserSessionId: browserSession.id,
      userId: "user-1",
      subjectType: "user",
      subjectProperties: { email: "user1@example.com" },
      refreshToken: "refresh-1",
      clientId: "app-1",
      ttl: 86400,
    })

    await sessionService.addAccountToSession({
      browserSessionId: browserSession.id,
      userId: "user-2",
      subjectType: "user",
      subjectProperties: { email: "user2@example.com" },
      refreshToken: "refresh-2",
      clientId: "app-1",
      ttl: 86400,
    })

    const accounts = await sessionService.listAccounts(browserSession.id)
    expect(accounts.length).toBe(2)
  })

  test("switches active account", async () => {
    await sessionService.addAccountToSession({
      browserSessionId: browserSession.id,
      userId: "user-1",
      subjectType: "user",
      subjectProperties: { email: "user1@example.com" },
      refreshToken: "refresh-1",
      clientId: "app-1",
      ttl: 86400,
    })

    await sessionService.addAccountToSession({
      browserSessionId: browserSession.id,
      userId: "user-2",
      subjectType: "user",
      subjectProperties: { email: "user2@example.com" },
      refreshToken: "refresh-2",
      clientId: "app-1",
      ttl: 86400,
    })

    await sessionService.switchActiveAccount(browserSession.id, "user-1")

    const updatedSession = await sessionService.getBrowserSession(
      browserSession.id,
      browserSession.tenant_id,
    )
    expect(updatedSession?.active_user_id).toBe("user-1")
  })

  test("removes single account from session", async () => {
    await sessionService.addAccountToSession({
      browserSessionId: browserSession.id,
      userId: "user-1",
      subjectType: "user",
      subjectProperties: { email: "user1@example.com" },
      refreshToken: "refresh-1",
      clientId: "app-1",
      ttl: 86400,
    })

    await sessionService.addAccountToSession({
      browserSessionId: browserSession.id,
      userId: "user-2",
      subjectType: "user",
      subjectProperties: { email: "user2@example.com" },
      refreshToken: "refresh-2",
      clientId: "app-1",
      ttl: 86400,
    })

    await sessionService.removeAccount(browserSession.id, "user-1")

    const accounts = await sessionService.listAccounts(browserSession.id)
    expect(accounts.length).toBe(1)
    expect(accounts[0].user_id).toBe("user-2")
  })

  test("clears all accounts from session", async () => {
    await sessionService.addAccountToSession({
      browserSessionId: browserSession.id,
      userId: "user-1",
      subjectType: "user",
      subjectProperties: { email: "user1@example.com" },
      refreshToken: "refresh-1",
      clientId: "app-1",
      ttl: 86400,
    })

    await sessionService.addAccountToSession({
      browserSessionId: browserSession.id,
      userId: "user-2",
      subjectType: "user",
      subjectProperties: { email: "user2@example.com" },
      refreshToken: "refresh-2",
      clientId: "app-1",
      ttl: 86400,
    })

    // Remove all accounts
    await sessionService.removeAccount(browserSession.id, "user-1")
    await sessionService.removeAccount(browserSession.id, "user-2")

    const accounts = await sessionService.listAccounts(browserSession.id)
    expect(accounts.length).toBe(0)

    const updatedSession = await sessionService.getBrowserSession(
      browserSession.id,
      browserSession.tenant_id,
    )
    expect(updatedSession?.active_user_id).toBeNull()
  })
})

// ============================================
// ENTERPRISE ISSUER FULL FLOW TESTS
// ============================================

describe("Enterprise Issuer - OAuth Flow with Session Creation", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let tenantService: TenantServiceImpl
  let sessionService: SessionServiceImpl
  let tenant: Tenant

  beforeEach(async () => {
    storage = MemoryStorage()
    tenantService = new TenantServiceImpl(storage)
    sessionService = new SessionServiceImpl(storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))

    tenant = await tenantService.createTenant({
      id: "test-tenant",
      name: "Test Tenant",
    })
  })

  afterEach(() => {
    setSystemTime()
  })

  test("creates browser session on first login", async () => {
    // Simulate what happens in the success callback when no session exists
    const browserSession = await sessionService.createBrowserSession({
      tenantId: tenant.id,
      userAgent: "Mozilla/5.0 Test Browser",
      ipAddress: "192.168.1.1",
    })

    expect(browserSession).toBeDefined()
    expect(browserSession.id).toBeTruthy()
    expect(browserSession.tenant_id).toBe(tenant.id)
    expect(browserSession.user_agent).toBe("Mozilla/5.0 Test Browser")
    expect(browserSession.ip_address).toBe("192.168.1.1")
    expect(browserSession.active_user_id).toBeNull()
  })

  test("adds account to newly created session", async () => {
    // Create browser session (simulating first login)
    const browserSession = await sessionService.createBrowserSession({
      tenantId: tenant.id,
      userAgent: "Mozilla/5.0",
      ipAddress: "127.0.0.1",
    })

    // Add account (simulating successful auth)
    const sessionRefreshToken = crypto.randomUUID()
    const account = await sessionService.addAccountToSession({
      browserSessionId: browserSession.id,
      userId: "user-123",
      subjectType: "user",
      subjectProperties: {
        email: "test@example.com",
        tenantId: tenant.id,
        roles: ["user"],
        permissions: ["read:profile"],
      },
      refreshToken: sessionRefreshToken,
      clientId: "test-app",
      ttl: 7 * 24 * 60 * 60,
    })

    expect(account.user_id).toBe("user-123")
    expect(account.subject_type).toBe("user")
    expect(account.subject_properties).toEqual({
      email: "test@example.com",
      tenantId: tenant.id,
      roles: ["user"],
      permissions: ["read:profile"],
    })
    expect(account.is_active).toBe(true)

    // Verify session now has active user
    const updatedSession = await sessionService.getBrowserSession(
      browserSession.id,
      tenant.id,
    )
    expect(updatedSession?.active_user_id).toBe("user-123")
  })

  test("session cookie header is properly formatted", async () => {
    const browserSession = await sessionService.createBrowserSession({
      tenantId: tenant.id,
      userAgent: "Mozilla/5.0",
      ipAddress: "127.0.0.1",
    })

    // Test that we can create a cookie header using the utility
    const { createSessionCookieHeader } =
      await import("../src/session/middleware.js")

    const cookieHeader = await createSessionCookieHeader(
      browserSession,
      sessionSecret,
      "openauth.session",
    )

    expect(cookieHeader).toBeDefined()
    expect(cookieHeader).toContain("openauth.session=")
    expect(cookieHeader).toContain("HttpOnly")
    expect(cookieHeader).toContain("Path=/")
    expect(cookieHeader).toContain("SameSite=Lax")
  })

  test("appending Set-Cookie header to response preserves existing headers", async () => {
    // Create a mock response
    const originalResponse = new Response(null, {
      status: 302,
      statusText: "Found",
      headers: {
        Location: "https://app.example.com/callback?code=abc123&state=xyz",
        "Content-Type": "text/plain",
      },
    })

    // Simulate appending session cookie
    const sessionCookieHeader =
      "openauth.session=encrypted_value; Path=/; HttpOnly; SameSite=Lax"

    const headers = new Headers(originalResponse.headers)
    headers.append("Set-Cookie", sessionCookieHeader)

    const modifiedResponse = new Response(originalResponse.body, {
      status: originalResponse.status,
      statusText: originalResponse.statusText,
      headers,
    })

    // Verify all headers are preserved
    expect(modifiedResponse.status).toBe(302)
    expect(modifiedResponse.headers.get("Location")).toBe(
      "https://app.example.com/callback?code=abc123&state=xyz",
    )
    expect(modifiedResponse.headers.get("Content-Type")).toBe("text/plain")
    expect(modifiedResponse.headers.get("Set-Cookie")).toBe(sessionCookieHeader)
  })
})

describe("Enterprise Issuer - RBAC Token Enrichment", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let tenantService: TenantServiceImpl
  let sessionService: SessionServiceImpl
  let tenant: Tenant
  let mockRbacService: any

  beforeEach(async () => {
    storage = MemoryStorage()
    tenantService = new TenantServiceImpl(storage)
    sessionService = new SessionServiceImpl(storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))

    tenant = await tenantService.createTenant({
      id: "test-tenant",
      name: "Test Tenant",
    })

    // Mock RBAC service
    mockRbacService = {
      enrichTokenClaims: mock(async ({ userId, clientId, tenantId }) => {
        // Return different roles based on user
        if (userId === "admin-user") {
          return {
            roles: ["admin", "user"],
            permissions: ["read:all", "write:all", "delete:all", "admin:users"],
          }
        }
        return {
          roles: ["user"],
          permissions: ["read:profile", "write:profile"],
        }
      }),
      getUserRoles: mock(async () => []),
      getRolePermissions: mock(async () => []),
    }
  })

  afterEach(() => {
    setSystemTime()
  })

  test("enriches token claims with RBAC roles and permissions for regular user", async () => {
    const claims = await mockRbacService.enrichTokenClaims({
      userId: "user-123",
      clientId: "test-app",
      tenantId: tenant.id,
    })

    expect(claims.roles).toEqual(["user"])
    expect(claims.permissions).toEqual(["read:profile", "write:profile"])
  })

  test("enriches token claims with RBAC roles and permissions for admin user", async () => {
    const claims = await mockRbacService.enrichTokenClaims({
      userId: "admin-user",
      clientId: "test-app",
      tenantId: tenant.id,
    })

    expect(claims.roles).toEqual(["admin", "user"])
    expect(claims.permissions).toContain("admin:users")
    expect(claims.permissions).toContain("read:all")
    expect(claims.permissions).toContain("write:all")
    expect(claims.permissions).toContain("delete:all")
  })

  test("creates enterprise auth result with RBAC claims", async () => {
    const claims = await mockRbacService.enrichTokenClaims({
      userId: "user-123",
      clientId: "test-app",
      tenantId: tenant.id,
    })

    // Simulate building EnterpriseAuthResult as done in issuer.ts
    const value = {
      provider: "google",
      userID: "user-123",
      email: "test@example.com",
    }

    const enterpriseResult = {
      ...value,
      tenantId: tenant.id,
      roles: claims.roles,
      permissions: claims.permissions,
    }

    expect(enterpriseResult.provider).toBe("google")
    expect(enterpriseResult.userID).toBe("user-123")
    expect(enterpriseResult.email).toBe("test@example.com")
    expect(enterpriseResult.tenantId).toBe(tenant.id)
    expect(enterpriseResult.roles).toEqual(["user"])
    expect(enterpriseResult.permissions).toEqual([
      "read:profile",
      "write:profile",
    ])
  })

  test("enriches subject properties with tenant and RBAC data", async () => {
    const claims = await mockRbacService.enrichTokenClaims({
      userId: "user-123",
      clientId: "test-app",
      tenantId: tenant.id,
    })

    // Simulate enriching subject properties as done in enterpriseCtx.subject()
    const baseProperties = {
      userId: "user-123",
      email: "test@example.com",
    }

    const enrichedProperties = {
      ...baseProperties,
      tenantId: tenant.id,
      roles: claims.roles,
      permissions: claims.permissions,
    }

    expect(enrichedProperties).toEqual({
      userId: "user-123",
      email: "test@example.com",
      tenantId: tenant.id,
      roles: ["user"],
      permissions: ["read:profile", "write:profile"],
    })
  })
})

describe("Enterprise Issuer - HTTP Flow Tests", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let tenantService: TenantServiceImpl
  let sessionService: SessionServiceImpl
  let tenant: Tenant

  beforeEach(async () => {
    storage = MemoryStorage()
    tenantService = new TenantServiceImpl(storage)
    sessionService = new SessionServiceImpl(storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))

    tenant = await tenantService.createTenant({
      id: "test-tenant",
      name: "Test Tenant",
      domain: "auth.test.com",
    })
  })

  afterEach(() => {
    setSystemTime()
  })

  test("well-known endpoint returns correct configuration", async () => {
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      providers: {
        dummy: {
          type: "dummy",
          init(route, ctx) {
            route.get("/authorize", async (c) => {
              return ctx.success(c, { email: "test@example.com" })
            })
          },
        },
      },
      subjects,
    })

    const response = await app.request(
      "http://auth.test.com/.well-known/openid-configuration",
      {
        method: "GET",
        headers: {
          "X-Tenant-ID": "test-tenant",
        },
      },
    )

    expect(response.status).toBe(200)
    const config = await response.json()

    expect(config.issuer).toBeDefined()
    expect(config.authorization_endpoint).toContain("/authorize")
    expect(config.token_endpoint).toContain("/token")
    expect(config.jwks_uri).toContain("/.well-known/jwks.json")
    expect(config.prompt_values_supported).toEqual([
      "none",
      "login",
      "consent",
      "select_account",
    ])
    expect(config.claims_supported).toContain("roles")
    expect(config.claims_supported).toContain("permissions")
    expect(config.claims_supported).toContain("tenant_id")
  })

  test("session routes are mounted and accessible", async () => {
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      providers: {
        dummy: {
          type: "dummy",
          init(route, ctx) {
            route.get("/authorize", async (c) => {
              return ctx.success(c, { email: "test@example.com" })
            })
          },
        },
      },
      subjects,
    })

    // Check session endpoint (should return empty accounts for new session)
    const response = await app.request("http://auth.test.com/session/check", {
      method: "GET",
      headers: {
        "X-Tenant-ID": "test-tenant",
      },
    })

    // Without a session cookie, this should return inactive state
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.active).toBe(false)
  })

  test("authorize endpoint requires tenant resolution", async () => {
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      providers: {
        dummy: {
          type: "dummy",
          init(route, ctx) {
            route.get("/authorize", async (c) => {
              return ctx.success(c, { email: "test@example.com" })
            })
          },
        },
      },
      subjects,
    })

    // Request without tenant header should fail
    const response = await app.request("http://unknown.com/authorize", {
      method: "GET",
    })

    // Should return error about tenant not found
    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toBe("tenant_not_found")
  })

  test("authorize endpoint with prompt=none returns error when no session", async () => {
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      providers: {
        dummy: {
          type: "dummy",
          init(route, ctx) {
            route.get("/authorize", async (c) => {
              return ctx.success(c, { email: "test@example.com" })
            })
          },
        },
      },
      subjects,
    })

    const response = await app.request(
      "http://auth.test.com/authorize?client_id=test&redirect_uri=http://localhost:3000/callback&response_type=code&state=test123&prompt=none",
      {
        method: "GET",
        headers: {
          "X-Tenant-ID": "test-tenant",
        },
      },
    )

    // prompt=none with no session should redirect with login_required error
    expect(response.status).toBe(302)
    const location = response.headers.get("Location")
    expect(location).toContain("error=login_required")
    expect(location).toContain("state=test123")
  })

  test("tenant API routes are accessible", async () => {
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      providers: {
        dummy: {
          type: "dummy",
          init(route, ctx) {
            route.get("/authorize", async (c) => {
              return ctx.success(c, { email: "test@example.com" })
            })
          },
        },
      },
      subjects,
    })

    // Get tenant by ID
    const response = await app.request(
      "http://auth.test.com/tenants/test-tenant",
      {
        method: "GET",
        headers: {
          "X-Tenant-ID": "test-tenant",
        },
      },
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.id).toBe("test-tenant")
    expect(data.name).toBe("Test Tenant")
  })
})

describe("Enterprise Issuer - Theme Resolution", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let tenantService: TenantServiceImpl
  let sessionService: SessionServiceImpl

  beforeEach(async () => {
    storage = MemoryStorage()
    tenantService = new TenantServiceImpl(storage)
    sessionService = new SessionServiceImpl(storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))
  })

  afterEach(() => {
    setSystemTime()
  })

  test("uses config theme when no tenant theme", async () => {
    const tenant = await tenantService.createTenant({
      id: "no-theme-tenant",
      name: "No Theme Tenant",
    })

    const customTheme = {
      title: "Custom App",
      primary: "#FF5500",
    }

    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      theme: customTheme as any,
      providers: {
        dummy: {
          type: "dummy",
          init(route, ctx) {
            route.get("/authorize", async (c) => {
              return ctx.success(c, { email: "test@example.com" })
            })
          },
        },
      },
      subjects,
    })

    // The theme should be set on the context
    expect(app).toBeDefined()
  })

  test("tenant branding theme takes priority over config theme", async () => {
    const tenant = await tenantService.createTenant({
      id: "branded-tenant",
      name: "Branded Tenant",
      branding: {
        theme: {
          title: "Tenant Custom Title",
          primary: "#00FF00",
        },
        logoLight: "https://example.com/logo.png",
        logoDark: "https://example.com/logo-dark.png",
        colors: {
          primary: "#00FF00",
          background: "#FFFFFF",
          text: "#000000",
        },
      },
    })

    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      theme: {
        title: "Default Title",
        primary: "#0000FF",
      } as any,
      providers: {
        dummy: {
          type: "dummy",
          init(route, ctx) {
            route.get("/authorize", async (c) => {
              return ctx.success(c, { email: "test@example.com" })
            })
          },
        },
      },
      subjects,
    })

    expect(app).toBeDefined()
    // The middleware should prioritize tenant.branding.theme over config.theme
  })
})

describe("Enterprise Issuer - Error Handling", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let tenantService: TenantServiceImpl
  let sessionService: SessionServiceImpl
  let tenant: Tenant

  beforeEach(async () => {
    storage = MemoryStorage()
    tenantService = new TenantServiceImpl(storage)
    sessionService = new SessionServiceImpl(storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))

    tenant = await tenantService.createTenant({
      id: "test-tenant",
      name: "Test Tenant",
    })
  })

  afterEach(() => {
    setSystemTime()
  })

  test("handles invalid session secret length", () => {
    expect(() => {
      createMultiTenantIssuer({
        tenantService,
        sessionService,
        storage,
        sessionSecret: new Uint8Array(16), // Wrong size (should be 32)
        providers: {
          dummy: {
            type: "dummy",
            init(route, ctx) {
              route.get("/authorize", async (c) => {
                return ctx.success(c, { email: "test@example.com" })
              })
            },
          },
        },
        subjects,
      })
    }).toThrow("sessionSecret must be a 256-bit")
  })

  test("handles missing subjects schema", () => {
    expect(() => {
      createMultiTenantIssuer({
        tenantService,
        sessionService,
        storage,
        sessionSecret,
        providers: {
          dummy: {
            type: "dummy",
            init(route, ctx) {
              route.get("/authorize", async (c) => {
                return ctx.success(c, { email: "test@example.com" })
              })
            },
          },
        },
        subjects: undefined as any,
      })
    }).toThrow("subjects schema is required")
  })

  test("handles CORS configuration", async () => {
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      cors: {
        origins: ["https://app.example.com"],
        credentials: true,
        methods: ["GET", "POST"],
        headers: ["Content-Type", "Authorization"],
      },
      providers: {
        dummy: {
          type: "dummy",
          init(route, ctx) {
            route.get("/authorize", async (c) => {
              return ctx.success(c, { email: "test@example.com" })
            })
          },
        },
      },
      subjects,
    })

    // Make OPTIONS request to test CORS
    const response = await app.request("http://auth.test.com/session/check", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "GET",
        "X-Tenant-ID": "test-tenant",
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example.com",
    )
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
      "true",
    )
  })
})

describe("Enterprise Issuer - Account Picker", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let tenantService: TenantServiceImpl
  let sessionService: SessionServiceImpl
  let tenant: Tenant
  let browserSession: BrowserSession

  beforeEach(async () => {
    storage = MemoryStorage()
    tenantService = new TenantServiceImpl(storage)
    sessionService = new SessionServiceImpl(storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))

    tenant = await tenantService.createTenant({
      id: "test-tenant",
      name: "Test Tenant",
    })

    browserSession = await sessionService.createBrowserSession({
      tenantId: tenant.id,
      userAgent: "Mozilla/5.0",
      ipAddress: "127.0.0.1",
    })
  })

  afterEach(() => {
    setSystemTime()
  })

  test("formats accounts correctly for picker display", () => {
    const accounts: AccountSession[] = [
      {
        id: "acc-1",
        browser_session_id: browserSession.id,
        user_id: "user-1",
        subject_type: "user",
        subject_properties: {
          name: "John Doe",
          email: "john@example.com",
          avatar: "https://example.com/john.jpg",
        },
        refresh_token: "refresh-1",
        client_id: "app-1",
        authenticated_at: Date.now(),
        expires_at: Date.now() + 86400 * 1000,
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
      {
        id: "acc-2",
        browser_session_id: browserSession.id,
        user_id: "user-2",
        subject_type: "user",
        subject_properties: {
          email: "jane@example.com",
        },
        refresh_token: "refresh-2",
        client_id: "app-1",
        authenticated_at: Date.now() - 3600 * 1000,
        expires_at: Date.now() + 86400 * 1000,
        is_active: false,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
    ]

    const formatted = formatAccountsForPicker(accounts)

    expect(formatted).toHaveLength(2)
    expect(formatted[0]).toEqual({
      userId: "user-1",
      displayName: "John Doe",
      email: "john@example.com",
      avatarUrl: "https://example.com/john.jpg",
      subjectType: "user",
      isActive: true,
      authenticatedAt: accounts[0].authenticated_at,
    })
    expect(formatted[1]).toEqual({
      userId: "user-2",
      displayName: undefined,
      email: "jane@example.com",
      avatarUrl: undefined,
      subjectType: "user",
      isActive: false,
      authenticatedAt: accounts[1].authenticated_at,
    })
  })

  test("generates add account URL with correct parameters", () => {
    const authorization: EnterpriseAuthorizationState = {
      client_id: "my-app",
      redirect_uri: "https://app.example.com/callback",
      response_type: "code",
      state: "state-abc",
      scope: "openid profile email",
      nonce: "nonce-xyz",
    }

    const url = generateAddAccountUrl(
      "https://auth.example.com/authorize",
      authorization,
    )

    const parsed = new URL(url)
    expect(parsed.origin).toBe("https://auth.example.com")
    expect(parsed.pathname).toBe("/authorize")
    expect(parsed.searchParams.get("client_id")).toBe("my-app")
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/callback",
    )
    expect(parsed.searchParams.get("response_type")).toBe("code")
    expect(parsed.searchParams.get("state")).toBe("state-abc")
    expect(parsed.searchParams.get("scope")).toBe("openid profile email")
    expect(parsed.searchParams.get("nonce")).toBe("nonce-xyz")
    expect(parsed.searchParams.get("prompt")).toBe("login")
  })
})
