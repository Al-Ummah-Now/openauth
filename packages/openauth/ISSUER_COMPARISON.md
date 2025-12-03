# OpenAuth Issuer Comparison Report

**Generated:** 2025-12-02
**Comparison:** Regular Issuer vs. Enterprise Issuer

## Executive Summary

The enterprise issuer (`/src/enterprise/issuer.ts`) is **significantly incomplete** compared to the regular issuer (`/src/issuer.ts`). While the architecture and middleware setup is well-designed, **critical OAuth/OIDC functionality is missing or broken**, making it non-functional for actual OAuth flows.

**Critical Issues:** 10
**High Priority Issues:** 8
**Medium Priority Issues:** 5
**Total Missing Features:** 23+

---

## Feature Comparison Matrix

| Feature | Regular Issuer | Enterprise Issuer | Status | Priority |
|---------|----------------|-------------------|--------|----------|
| **Core OAuth Endpoints** |
| `/authorize` endpoint | ✅ Full implementation | ⚠️ Partial - missing provider flow | 🔴 Critical |
| `/token` endpoint | ✅ Complete with all grant types | ❌ **Missing entirely** | 🔴 Critical |
| `/userinfo` endpoint | ✅ Implemented | ❌ Missing | 🔴 Critical |
| **Token Operations** |
| Access token generation | ✅ Full JWT signing | ❌ Missing | 🔴 Critical |
| Refresh token generation | ✅ With rotation | ❌ Missing | 🔴 Critical |
| Token storage | ✅ Complete | ❌ Missing | 🔴 Critical |
| Token encryption | ✅ RSA-OAEP-512 | ❌ Missing | 🔴 Critical |
| **Grant Types** |
| authorization_code | ✅ Implemented | ❌ Missing | 🔴 Critical |
| refresh_token | ✅ With reuse detection | ❌ Missing | 🔴 Critical |
| client_credentials | ✅ Implemented | ❌ Missing | 🔴 Critical |
| **Authorization Flow** |
| Authorization state storage | ✅ Encrypted cookies | ⚠️ Placeholder only | 🔴 Critical |
| PKCE validation | ✅ S256 method | ❌ Missing | 🔴 Critical |
| Code exchange | ✅ Secure exchange | ❌ Missing | 🔴 Critical |
| State parameter handling | ✅ Full support | ⚠️ Partial | 🟡 High |
| **Success Callback & Token Issuance** |
| `ctx.subject()` implementation | ✅ Returns tokens | 🐛 Returns JSON, not tokens | 🔴 Critical |
| Response type 'code' | ✅ Generates auth code | ❌ Missing | 🔴 Critical |
| Response type 'token' | ✅ Implicit flow | ❌ Missing | 🔴 Critical |
| Redirect with tokens | ✅ Proper OAuth redirects | ❌ Missing | 🔴 Critical |
| **Cryptographic Operations** |
| Signing keys (JWT) | ✅ RS256 with rotation | ❌ Missing | 🔴 Critical |
| Encryption keys | ✅ RSA-OAEP-512 | ❌ Missing | 🔴 Critical |
| Cookie encryption | ✅ Full encryption | 🐛 No encryption (plain JSON) | 🔴 Critical |
| JWKS endpoint | ✅ Returns public keys | 🐛 Returns empty array | 🔴 Critical |
| **Cookie/State Management** |
| `auth.set()` - encryption | ✅ Encrypted JWE | 🐛 Plain JSON.stringify | 🔴 Critical |
| `auth.get()` - decryption | ✅ Decrypts JWE | 🐛 Plain JSON.parse | 🔴 Critical |
| `auth.unset()` | ✅ Proper deletion | ✅ Works | ✅ OK |
| Authorization cookie TTL | ✅ 24 hours | ⚠️ Not set | 🟡 High |
| Secure/SameSite flags | ✅ Correct settings | ✅ Correct | ✅ OK |
| **Storage Operations** |
| OAuth code storage | ✅ Implemented | ❌ Missing | 🔴 Critical |
| Refresh token storage | ✅ With next token | ❌ Missing | 🔴 Critical |
| Token invalidation | ✅ Scan & delete | ⚠️ Placeholder only | 🟡 High |
| **Token Security** |
| Refresh token reuse detection | ✅ Time window + retention | ❌ Missing | 🟡 High |
| Token revocation (RFC 7009) | ✅ Full support | ❌ Missing | 🟡 High |
| Token introspection (RFC 7662) | ✅ Full support | ❌ Missing | 🟡 High |
| Rate limiting | ✅ Sliding window | ❌ Missing | 🟢 Medium |
| JTI (token ID) in access tokens | ✅ Generated | ❌ Missing | 🟡 High |
| **Client Authentication** |
| Client credentials flow | ✅ Implemented | ❌ Missing | 🟡 High |
| Client authenticator integration | ✅ D1ClientAdapter | ❌ Missing | 🟢 Medium |
| Basic auth header extraction | ✅ Implemented | ❌ Missing | 🟢 Medium |
| Public vs confidential clients | ✅ Supported | ❌ Missing | 🟢 Medium |
| **Well-Known Endpoints** |
| JWKS endpoint | ✅ Returns real keys | 🐛 Empty array | 🔴 Critical |
| OAuth server metadata | ✅ Complete | ⚠️ Incomplete claims | 🟡 High |
| OIDC configuration | ❌ N/A | ⚠️ Incomplete | 🟢 Medium |
| **Provider Integration** |
| Provider routing | ✅ Dynamic routes | ✅ Dynamic routes | ✅ OK |
| Provider success callback | ✅ Full flow | 🐛 Broken flow | 🔴 Critical |
| Provider client credentials | ✅ Supported | ❌ Missing | 🟡 High |
| **Error Handling** |
| OAuth error formatting | ✅ Spec-compliant | ✅ Spec-compliant | ✅ OK |
| Error redirects | ✅ To redirect_uri | ✅ To redirect_uri | ✅ OK |
| Unknown state error | ✅ Handled | ✅ Handled | ✅ OK |
| **Audit & Monitoring** |
| Audit service integration | ✅ Optional | ❌ Missing | 🟢 Medium |
| Token usage events | ✅ All events | ❌ Missing | 🟢 Medium |
| Logging | ✅ logger() middleware | ✅ logger() middleware | ✅ OK |
| **Enterprise-Specific Features** |
| Multi-tenant support | ❌ N/A | ✅ Implemented | ✅ OK |
| Tenant resolution | ❌ N/A | ✅ Middleware | ✅ OK |
| Session management | ❌ N/A | ✅ Middleware | ✅ OK |
| RBAC integration | ❌ N/A | ✅ Token enrichment | ✅ OK |
| Tenant-scoped storage | ❌ N/A | ⚠️ Partial | 🟢 Medium |
| Account picker UI | ❌ N/A | ✅ Implemented | ✅ OK |
| OIDC prompt parameter | ❌ N/A | ✅ Implemented | ✅ OK |
| Multiple browser sessions | ❌ N/A | ✅ Implemented | ✅ OK |

**Legend:**
- ✅ Working - Feature is fully implemented and functional
- ⚠️ Partial - Feature is partially implemented or has limitations
- ❌ Missing - Feature is completely absent
- 🐛 Bug - Feature is broken or returns incorrect values
- 🔴 Critical - Blocks core OAuth functionality
- 🟡 High - Important for production use
- 🟢 Medium - Nice to have, not blocking

---

## Critical Issues (Priority: 🔴 Critical)

### 1. `/token` Endpoint - **COMPLETELY MISSING**

**Impact:** No way to exchange authorization codes for tokens. OAuth flow is non-functional.

**Regular Issuer:**
```typescript
app.post("/token", cors({...}), async (c) => {
  const form = await c.req.formData()
  const grantType = form.get("grant_type")

  if (grantType === "authorization_code") {
    // 50+ lines of code exchange logic
    const code = form.get("code")
    const payload = await Storage.get(storage, ["oauth:code", code])
    // Validate redirect_uri, client_id, PKCE
    const tokens = await generateTokens(c, payload)
    return c.json({
      access_token: tokens.access,
      token_type: "bearer",
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refresh,
    })
  }

  if (grantType === "refresh_token") {
    // 40+ lines of refresh logic with reuse detection
  }

  if (grantType === "client_credentials") {
    // 30+ lines of client credentials flow
  }
})
```

**Enterprise Issuer:**
```typescript
// NOTHING - endpoint doesn't exist at all
```

**Fix Required:**
- Implement full `/token` endpoint with all 3 grant types
- Add PKCE validation for authorization_code grant
- Add refresh token reuse detection
- Add client credentials flow
- Integrate with tenant-scoped storage
- Add RBAC claims to generated tokens

---

### 2. Token Generation - **COMPLETELY MISSING**

**Impact:** No JWT signing, no token creation, OAuth is non-functional.

**Regular Issuer:**
```typescript
async function generateTokens(ctx: Context, value: {
  type: string
  properties: any
  subject: string
  clientID: string
  ttl: { access: number; refresh: number }
  timeUsed?: number
  nextToken?: string
}) {
  const refreshToken = value.nextToken ?? crypto.randomUUID()

  // Store next refresh token for rotation
  await Storage.set(storage!,
    ["oauth:refresh", value.subject, refreshToken],
    { ...value, nextToken: crypto.randomUUID() },
    value.ttl.refresh
  )

  // Sign JWT access token
  const tokens = {
    access: await new SignJWT({
      mode: "access",
      type: value.type,
      properties: value.properties,
      jti: crypto.randomUUID(),
      aud: value.clientID,
      iss: issuer(ctx),
      sub: value.subject,
    })
      .setExpirationTime(Math.floor(accessTimeUsed + value.ttl.access))
      .setProtectedHeader(await signingKey().then((k) => ({
        alg: k.alg,
        kid: k.id,
        typ: "JWT",
      })))
      .sign(await signingKey().then((item) => item.private)),
    expiresIn: Math.floor(accessTimeUsed + value.ttl.access - Date.now() / 1000),
    refresh: [value.subject, refreshToken].join(":"),
  }

  return tokens
}
```

**Enterprise Issuer:**
```typescript
// NOTHING - no generateTokens function exists
// No JWT signing logic
// No token storage logic
```

**Fix Required:**
- Implement `generateTokens()` function
- Set up signing keys with lazy loading
- Implement refresh token rotation
- Add RBAC claims to JWT payload
- Add tenant_id to JWT claims
- Implement audit logging for token generation

---

### 3. Cryptographic Keys - **COMPLETELY MISSING**

**Impact:** Cannot sign JWTs, cannot encrypt cookies, complete security failure.

**Regular Issuer:**
```typescript
const allSigning = lazy(() =>
  Promise.all([signingKeys(storage), legacySigningKeys(storage)]).then(
    ([a, b]) => [...a, ...b],
  ),
)
const allEncryption = lazy(() => encryptionKeys(storage))
const signingKey = lazy(() => allSigning().then((all) => all[0]))
const encryptionKey = lazy(() => allEncryption().then((all) => all[0]))
```

**Enterprise Issuer:**
```typescript
// NOTHING - no key setup at all
// No signingKey()
// No encryptionKey()
// No key rotation support
```

**Fix Required:**
- Import and set up `signingKeys()`, `encryptionKeys()`, `legacySigningKeys()`
- Create lazy loaders for keys
- Implement key rotation support
- Handle tenant-scoped keys if needed

---

### 4. Cookie Encryption - **BROKEN (Security Vulnerability)**

**Impact:** Authorization state is stored in plain text cookies. Critical security vulnerability.

**Regular Issuer:**
```typescript
async set(ctx, key, maxAge, value) {
  setCookie(ctx, key, await encrypt(value), {
    maxAge,
    httpOnly: true,
    ...(ctx.req.url.startsWith("https://")
      ? { secure: true, sameSite: "None" }
      : {}),
  })
},

async function encrypt(value: any) {
  return await new CompactEncrypt(
    new TextEncoder().encode(JSON.stringify(value)),
  )
    .setProtectedHeader({ alg: "RSA-OAEP-512", enc: "A256GCM" })
    .encrypt(await encryptionKey().then((k) => k.public))
}
```

**Enterprise Issuer:**
```typescript
async set(ctx, key, maxAge, value) {
  const { setCookie } = await import("hono/cookie")
  setCookie(ctx, key, JSON.stringify(value), { // ❌ PLAIN TEXT!
    maxAge,
    httpOnly: true,
    ...(ctx.req.url.startsWith("https://")
      ? { secure: true, sameSite: "None" }
      : {}),
  })
},

async get(ctx: Context, key: string) {
  const { getCookie } = await import("hono/cookie")
  const raw = getCookie(ctx, key)
  if (!raw) return
  try {
    return JSON.parse(raw) // ❌ NO DECRYPTION!
  } catch {
    return undefined
  }
},
```

**Fix Required:**
- Implement `encrypt()` function using CompactEncrypt
- Implement `decrypt()` function using compactDecrypt
- Use encryption in `auth.set()` and `auth.get()`

---

### 5. `ctx.subject()` - **BROKEN (Returns JSON instead of OAuth response)**

**Impact:** After authentication, tokens are not issued. OAuth flow breaks.

**Regular Issuer:**
```typescript
async subject(type, properties, subjectOpts) {
  const authorization = await getAuthorization(ctx)
  const subject = subjectOpts?.subject || await resolveSubject(type, properties)

  if (authorization.response_type === "token") {
    // Implicit flow
    const tokens = await generateTokens(ctx, {...})
    location.hash = new URLSearchParams({
      access_token: tokens.access,
      refresh_token: tokens.refresh,
      state: authorization.state || "",
    }).toString()
    await auth.unset(ctx, "authorization")
    return ctx.redirect(location.toString(), 302)
  }

  if (authorization.response_type === "code") {
    // Authorization code flow
    const code = crypto.randomUUID()
    await Storage.set(storage, ["oauth:code", code], {...}, 60)
    const location = new URL(authorization.redirect_uri)
    location.searchParams.set("code", code)
    location.searchParams.set("state", authorization.state || "")
    await auth.unset(ctx, "authorization")
    return ctx.redirect(location.toString(), 302)
  }
}
```

**Enterprise Issuer:**
```typescript
async subject(type, props, opts) {
  // Add account to session (good!)
  if (session && props.userID) {
    await addAccountToSession(ctx, config.sessionService, {...})
  }

  // Call invalidate if provided
  if (successOpts?.invalidate) {
    const subject = opts?.subject || (await resolveSubject(type, props))
    await successOpts.invalidate(subject)
  }

  // ❌ WRONG - returns JSON instead of OAuth redirect!
  return ctx.json({
    type,
    properties: props,
    tenantId: tenant.id,
    roles: rbacClaims.roles,
    permissions: rbacClaims.permissions,
  })
}
```

**Fix Required:**
- Implement authorization code generation and storage
- Implement token generation for implicit flow
- Build proper OAuth redirect responses
- Integrate RBAC claims into JWT payload
- Add tenant_id to JWT claims

---

### 6. JWKS Endpoint - **BROKEN (Returns empty array)**

**Impact:** Clients cannot verify JWT signatures. Token validation is impossible.

**Regular Issuer:**
```typescript
app.get("/.well-known/jwks.json", cors({...}), async (c) => {
  const all = await allSigning()
  return c.json({
    keys: all.map((item) => ({
      ...item.jwk,
      alg: item.alg,
      exp: item.expired
        ? Math.floor(item.expired.getTime() / 1000)
        : undefined,
    })),
  })
})
```

**Enterprise Issuer:**
```typescript
app.get("/.well-known/jwks.json", cors({...}), async (c) => {
  // ❌ WRONG - returns empty array!
  return c.json({ keys: [] })
})
```

**Fix Required:**
- Load signing keys from storage
- Convert keys to JWK format
- Return proper JWKS response with key metadata

---

### 7. Authorization Code Storage - **MISSING**

**Impact:** Code exchange will fail. No way to retrieve authorization payload.

**Regular Issuer:**
```typescript
if (authorization.response_type === "code") {
  const code = crypto.randomUUID()
  await Storage.set(
    storage,
    ["oauth:code", code],
    {
      type,
      properties,
      subject,
      redirectURI: authorization.redirect_uri,
      clientID: authorization.client_id,
      pkce: authorization.pkce,
      ttl: { access: ..., refresh: ... },
    },
    60 // 60 second TTL
  )
  const location = new URL(authorization.redirect_uri)
  location.searchParams.set("code", code)
  location.searchParams.set("state", authorization.state || "")
  return ctx.redirect(location.toString(), 302)
}
```

**Enterprise Issuer:**
```typescript
// NOTHING - no code storage, no code generation
```

**Fix Required:**
- Generate authorization codes
- Store code with payload in tenant-scoped storage
- Set 60-second TTL
- Include PKCE challenge in stored payload

---

### 8. PKCE Validation - **MISSING**

**Impact:** Public clients (SPAs, mobile apps) are vulnerable to authorization code interception.

**Regular Issuer:**
```typescript
if (payload.pkce) {
  const codeVerifier = form.get("code_verifier")?.toString()
  if (!codeVerifier)
    return c.json({
      error: "invalid_grant",
      error_description: "Missing code_verifier",
    }, 400)

  if (!(await validatePKCE(
    codeVerifier,
    payload.pkce.challenge,
    payload.pkce.method,
  ))) {
    return c.json({
      error: "invalid_grant",
      error_description: "Code verifier does not match",
    }, 400)
  }
}
```

**Enterprise Issuer:**
```typescript
// NOTHING - no PKCE validation in enterprise issuer
```

**Fix Required:**
- Import `validatePKCE` from `../pkce.js`
- Validate code_verifier in `/token` endpoint
- Support S256 method

---

### 9. Authorization State Retrieval - **BROKEN**

**Impact:** Cannot retrieve authorization parameters after provider callback.

**Regular Issuer:**
```typescript
async function getAuthorization(ctx: Context) {
  const match =
    (await auth.get(ctx, "authorization")) || ctx.get("authorization")
  if (!match) throw new UnknownStateError()
  return match as AuthorizationState
}

// Used in success callback:
const authorization = await getAuthorization(ctx)
```

**Enterprise Issuer:**
```typescript
// No getAuthorization() function
// Provider success callback cannot retrieve auth state
// Authorization parameters are lost after provider redirect

// The enterprise code does this:
const authorization = ctx.get("authorization") as
  | EnterpriseAuthorizationState
  | undefined

// ❌ This will be undefined after provider redirect because
// it's not stored in an encrypted cookie
```

**Fix Required:**
- Implement `getAuthorization()` helper
- Store authorization state in encrypted cookie during `/authorize`
- Retrieve from cookie in provider success callback
- Handle UnknownStateError

---

### 10. `/userinfo` Endpoint - **MISSING**

**Impact:** OIDC clients cannot retrieve user information. OIDC compliance is broken.

**Regular Issuer:**
```typescript
app.get("/userinfo", async (c) => {
  const header = c.req.header("Authorization")
  if (!header) {
    return c.json({
      error: "invalid_request",
      error_description: "Missing Authorization header",
    }, 400)
  }

  const [type, token] = header.split(" ")
  if (type !== "Bearer") {
    return c.json({
      error: "invalid_request",
      error_description: "Missing or invalid Authorization header",
    }, 400)
  }

  const result = await jwtVerify<{...}>(token, ...)
  const validated = await input.subjects[result.payload.type]["~standard"].validate(result.payload.properties)

  if (!validated.issues && result.payload.mode === "access") {
    return c.json(validated.value as SubjectSchema)
  }

  return c.json({
    error: "invalid_token",
    error_description: "Invalid token",
  })
})
```

**Enterprise Issuer:**
```typescript
// NOTHING - /userinfo endpoint doesn't exist
```

**Fix Required:**
- Implement `/userinfo` endpoint
- Extract and verify Bearer token
- Validate JWT signature
- Return subject properties
- Add RBAC claims (roles, permissions, tenant_id)

---

## High Priority Issues (Priority: 🟡 High)

### 11. Refresh Token Reuse Detection - **MISSING**

**Impact:** Refresh tokens can be reused maliciously. No security against token replay attacks.

**Regular Issuer:**
```typescript
if (grantType === "refresh_token") {
  const payload = await Storage.get(storage, key)

  const generateRefreshToken = payload.timeUsed === undefined

  if (ttlRefreshReuse <= 0) {
    await Storage.remove(storage, key)
  } else if (payload.timeUsed === undefined) {
    payload.timeUsed = Date.now()
    await Storage.set(storage, key, payload, ttlRefreshReuse + ttlRefreshRetention)
  } else if (Date.now() > payload.timeUsed + ttlRefreshReuse * 1000) {
    // Token reused past allowed interval - invalidate all tokens
    await auth.invalidate(subject)

    if (input.audit?.hooks?.onTokenReused) {
      void input.audit.service.logTokenUsage({...})
    }

    return c.json({
      error: "invalid_grant",
      error_description: "Refresh token has been used or expired",
    }, 400)
  }
}
```

**Enterprise Issuer:**
```typescript
// NOTHING - no refresh token logic at all
```

**Fix Required:**
- Implement refresh token storage
- Track `timeUsed` timestamp
- Implement reuse window (default 60 seconds)
- Invalidate all tokens on reuse detection
- Add audit logging

---

### 12. Token Invalidation - **PLACEHOLDER ONLY**

**Impact:** Cannot revoke user sessions. No way to force logout.

**Regular Issuer:**
```typescript
async invalidate(subject: string) {
  // Scan all refresh tokens for this subject
  const keys = await Array.fromAsync(
    Storage.scan(this.storage, ["oauth:refresh", subject]),
  )
  for (const [key] of keys) {
    await Storage.remove(this.storage, key)
  }
}
```

**Enterprise Issuer:**
```typescript
async invalidate(subject: string) {
  // ⚠️ PLACEHOLDER - doesn't actually do anything
  const tenant = getTenant((globalThis as any).__currentCtx)
  if (tenant) {
    const tenantStorage = new TenantStorageImpl(config.storage, tenant.id)
    // ❌ No implementation - just creates storage instance
  }
}
```

**Fix Required:**
- Implement Storage.scan() for tenant-scoped storage
- Remove all refresh tokens for subject
- Handle tenant isolation properly
- Add error handling

---

### 13. Token Revocation Endpoint (RFC 7009) - **MISSING**

**Impact:** No way to revoke tokens. Cannot implement logout functionality.

**Regular Issuer:**
```typescript
app.post("/token/revoke", async (c) => {
  if (!clientAuthenticator) { return 501 }

  const form = await c.req.formData()
  const token = form.get("token")?.toString()
  const tokenTypeHint = form.get("token_type_hint")?.toString()

  const credentials = extractClientCredentials(c, form, false)
  const authResult = await clientAuthenticator.authenticateClient(...)

  // Revoke refresh token or access token
  if (tokenTypeHint === "refresh_token" || token.includes(":")) {
    await revocationService.revokeRefreshToken(subject, tokenId)
  } else {
    const result = await jwtVerify(token, ...)
    if (result.payload.aud !== credentials.clientId) {
      return c.json({}) // Don't reveal if token exists
    }
    await revocationService.revokeAccessToken(tokenId)
  }

  return c.json({}) // Always return success per RFC 7009
})
```

**Enterprise Issuer:**
```typescript
// NOTHING - /token/revoke endpoint doesn't exist
```

**Fix Required:**
- Implement `/token/revoke` endpoint
- Support both access and refresh tokens
- Implement client authentication
- Add rate limiting
- Follow RFC 7009 spec (always return success)

---

### 14. Token Introspection Endpoint (RFC 7662) - **MISSING**

**Impact:** Resource servers cannot validate tokens. No introspection capability.

**Regular Issuer:**
```typescript
app.post("/token/introspect", async (c) => {
  if (!clientAuthenticator) { return 501 }

  const form = await c.req.formData()
  const token = form.get("token")?.toString()

  const credentials = extractClientCredentials(c, form)
  const authResult = await clientAuthenticator.authenticateClient(...)

  const allowed = await checkRateLimit(credentials.clientId!, "token_introspect")
  if (!allowed) { return 429 }

  const result = await jwtVerify(token, ...)

  // Only allow introspection if token belongs to requesting client
  if (result.payload.aud !== credentials.clientId) {
    return c.json({ active: false })
  }

  // Check revocation
  const isRevoked = await revocationService.isAccessTokenRevoked(tokenId)
  if (isRevoked) {
    return c.json({ active: false })
  }

  return c.json({
    active: true,
    scope: result.payload.scope,
    client_id: result.payload.aud,
    username: result.payload.sub,
    token_type: "Bearer",
    exp: result.payload.exp,
    ...
  })
})
```

**Enterprise Issuer:**
```typescript
// NOTHING - /token/introspect endpoint doesn't exist
```

**Fix Required:**
- Implement `/token/introspect` endpoint
- Require client authentication
- Check token ownership (aud claim)
- Check revocation status
- Add rate limiting
- Return proper introspection response

---

### 15. Client Authentication - **MISSING**

**Impact:** Cannot authenticate confidential clients. Client credentials flow is broken.

**Regular Issuer:**
```typescript
let clientAuthenticator: ClientAuthenticator | undefined
if (input.clientDb) {
  const clientAdapter = new D1ClientAdapter({
    database: input.clientDb,
  })
  clientAuthenticator = new ClientAuthenticator({
    adapter: clientAdapter,
  })
}

function extractClientCredentials(c: Context, form: FormData, requireSecret: boolean = true) {
  const authHeader = c.req.header("Authorization")
  let clientId: string | undefined
  let clientSecret: string | undefined

  if (authHeader) {
    const [type, credentials] = authHeader.split(" ")
    if (type === "Basic" && credentials) {
      const decoded = atob(credentials)
      const colonIndex = decoded.indexOf(":")
      clientId = decoded.substring(0, colonIndex)
      clientSecret = decoded.substring(colonIndex + 1)
    }
  }

  // Fall back to form data
  if (!clientId || !clientSecret) {
    clientId = form.get("client_id")?.toString()
    clientSecret = form.get("client_secret")?.toString()
  }

  return { clientId, clientSecret }
}
```

**Enterprise Issuer:**
```typescript
// NOTHING - no client authentication setup
// No ClientAuthenticator
// No D1ClientAdapter
// No extractClientCredentials()
```

**Fix Required:**
- Set up ClientAuthenticator if clientDb provided
- Implement extractClientCredentials() helper
- Support Basic auth and form data
- Handle public vs confidential clients

---

### 16. Revocation Service - **MISSING**

**Impact:** Cannot track revoked tokens. No JTI-based revocation.

**Regular Issuer:**
```typescript
const revocationService = new RevocationService({
  storage,
  revocationTTL: ttlAccess, // Match access token TTL
})

// In token generation:
const tokens = {
  access: await new SignJWT({
    mode: "access",
    type: value.type,
    properties: value.properties,
    jti: crypto.randomUUID(), // ✅ JTI for revocation tracking
    ...
  })
}
```

**Enterprise Issuer:**
```typescript
// NOTHING - no RevocationService
// No JTI in access tokens
// No revocation tracking
```

**Fix Required:**
- Initialize RevocationService
- Add JTI to access token claims
- Implement revocation checking
- Add tenant isolation

---

### 17. State Parameter Validation - **INCOMPLETE**

**Impact:** CSRF protection may be weak.

**Regular Issuer:**
```typescript
// State is stored in authorization cookie
await auth.set(c, "authorization", AUTHORIZATION_COOKIE_TTL, authorization)

// State is validated in callbacks
const authorization = await getAuthorization(ctx)
// If cookie doesn't exist or is invalid, UnknownStateError is thrown
```

**Enterprise Issuer:**
```typescript
// State is in context but not validated from encrypted cookie
const authorization = ctx.get("authorization") as
  | EnterpriseAuthorizationState
  | undefined

// ❌ No validation that state came from encrypted cookie
// ❌ State could be spoofed since it's just in context
```

**Fix Required:**
- Store authorization state in encrypted cookie
- Validate state from cookie in provider callback
- Throw UnknownStateError if state is missing/invalid

---

### 18. Client Credentials Grant - **MISSING**

**Impact:** Service-to-service authentication is broken. M2M auth doesn't work.

**Regular Issuer:**
```typescript
if (grantType === "client_credentials") {
  const provider = form.get("provider")
  const match = input.providers[provider.toString()]

  if (!match.client)
    return c.json({ error: "this provider does not support client_credentials" }, 400)

  const clientID = form.get("client_id")
  const clientSecret = form.get("client_secret")

  const response = await match.client({
    clientID: clientID.toString(),
    clientSecret: clientSecret.toString(),
    params: Object.fromEntries([...form.entries()]),
  })

  return input.success({
    async subject(type, properties, opts) {
      const tokens = await generateTokens(c, {...})
      return c.json({
        access_token: tokens.access,
        refresh_token: tokens.refresh,
      })
    },
  }, { provider: provider.toString(), ...response }, c.req.raw)
}
```

**Enterprise Issuer:**
```typescript
// NOTHING - client_credentials grant not implemented
```

**Fix Required:**
- Implement client_credentials grant in /token endpoint
- Validate client credentials
- Call provider.client() if supported
- Return access token (no refresh token for client credentials)

---

## Medium Priority Issues (Priority: 🟢 Medium)

### 19. Rate Limiting - **MISSING**

**Impact:** No protection against brute force or DoS attacks.

**Regular Issuer:**
```typescript
async function checkRateLimit(
  clientId: string,
  endpoint: string,
  limit: number = 60,
  window: number = 60,
): Promise<boolean> {
  if (!storage) return true

  const now = Date.now()
  const key = ["ratelimit", endpoint, clientId]

  const log = (await Storage.get<number[]>(storage, key)) || []
  const windowStart = now - window * 1000
  const recentRequests = log.filter((timestamp) => timestamp > windowStart)

  if (recentRequests.length >= limit) {
    return false
  }

  recentRequests.push(now)
  await Storage.set(storage, key, recentRequests, window)

  return true
}

// Used in introspection and revocation endpoints
const allowed = await checkRateLimit(credentials.clientId!, "token_introspect")
if (!allowed) {
  return c.json({
    error: "slow_down",
    error_description: "Rate limit exceeded. Please try again later.",
  }, 429)
}
```

**Enterprise Issuer:**
```typescript
// NOTHING - no rate limiting
```

**Fix Required:**
- Implement checkRateLimit() function
- Apply to /token, /token/introspect, /token/revoke
- Use sliding window algorithm
- Store rate limit data in tenant-scoped storage

---

### 20. Audit Service Integration - **MISSING**

**Impact:** No audit trail for token operations. Compliance and debugging issues.

**Regular Issuer:**
```typescript
// In token generation:
if (input.audit?.hooks?.onTokenGenerated) {
  void input.audit.service.logTokenUsage({
    token_id: refreshToken,
    subject: value.subject,
    event_type: "generated",
    client_id: value.clientID,
    timestamp: Date.now(),
  })
}

// In token refresh:
if (input.audit?.hooks?.onTokenRefreshed) {
  void input.audit.service.logTokenUsage({...})
}

// In token reuse detection:
if (input.audit?.hooks?.onTokenReused) {
  void input.audit.service.logTokenUsage({...})
}

// In token revocation:
if (input.audit?.hooks?.onTokenRevoked) {
  void input.audit.service.logTokenUsage({...})
}
```

**Enterprise Issuer:**
```typescript
// NOTHING - no audit integration
```

**Fix Required:**
- Add audit config to EnterpriseIssuerConfig
- Fire audit events for token operations
- Add tenant_id to audit logs
- Use async logging (non-blocking)

---

### 21. Tenant-Scoped Storage - **INCOMPLETE**

**Impact:** Token isolation between tenants may be weak.

**Regular Issuer:**
```typescript
// Direct storage operations
await Storage.set(storage, ["oauth:code", code], {...}, 60)
await Storage.get(storage, ["oauth:code", code])
await Storage.remove(storage, ["oauth:code", code])
```

**Enterprise Issuer:**
```typescript
// Tenant storage wrapper exists but not used consistently
const tenantStorage = getTenantStorage(ctx)
const storage = tenantStorage || config.storage

// ❌ But then just uses global storage in most places
// ❌ Token operations don't use tenant-scoped keys
```

**Fix Required:**
- Use TenantStorageImpl consistently
- Prefix all storage keys with tenant_id
- Ensure token isolation
- Update invalidate() to use tenant storage

---

### 22. OAuth Server Metadata - **INCOMPLETE**

**Impact:** Clients may not discover all capabilities correctly.

**Regular Issuer:**
```typescript
app.get("/.well-known/oauth-authorization-server", async (c) => {
  const iss = issuer(c)
  return c.json({
    issuer: iss,
    authorization_endpoint: `${iss}/authorize`,
    token_endpoint: `${iss}/token`,
    jwks_uri: `${iss}/.well-known/jwks.json`,
    response_types_supported: ["code", "token"],
    grant_types_supported: [
      "authorization_code",
      "refresh_token",
      "client_credentials",
    ],
  })
})
```

**Enterprise Issuer:**
```typescript
app.get("/.well-known/oauth-authorization-server", async (c) => {
  // Similar, but missing some claims:
  // - No userinfo_endpoint
  // - No revocation_endpoint
  // - No introspection_endpoint
  // - No token_endpoint_auth_methods_supported
})
```

**Fix Required:**
- Add missing endpoints to metadata
- Add `userinfo_endpoint`
- Add `revocation_endpoint`
- Add `introspection_endpoint`
- Add `token_endpoint_auth_methods_supported`

---

### 23. OIDC Configuration - **INCOMPLETE**

**Impact:** OIDC clients may have incomplete configuration.

**Enterprise Issuer:**
```typescript
app.get("/.well-known/openid-configuration", async (c) => {
  return c.json({
    // Missing some standard OIDC claims:
    // - No end_session_endpoint
    // - No check_session_iframe
    // - No backchannel_logout_supported
    // - No frontchannel_logout_supported
  })
})
```

**Fix Required:**
- Add logout endpoints
- Add session management endpoints
- Add logout capabilities
- Match OIDC Discovery spec

---

## Code-by-Code Comparison

### `/authorize` Endpoint

**Regular Issuer Flow:**
1. Extract query parameters ✅
2. Build authorization state ✅
3. Validate required parameters (redirect_uri, response_type, client_id) ✅
4. Call `input.start()` hook if provided ✅
5. Check `allow()` for client authorization ✅
6. **Store authorization state in encrypted cookie** ✅
7. Redirect to provider or show provider selection ✅

**Enterprise Issuer Flow:**
1. Extract query parameters (including OIDC params) ✅
2. Build authorization state (EnterpriseAuthorizationState) ✅
3. Validate required parameters ✅
4. Check `onAllow()` for client authorization ✅
5. Get browser session from context ✅
6. Handle account_hint, login_hint ✅
7. Handle prompt parameter (none, login, consent, select_account) ✅
8. Handle max_age parameter ✅
9. **❌ MISSING: Store authorization state in encrypted cookie**
10. Redirect to provider or show provider/account selection ✅

**Gaps:**
- Authorization state is NOT stored in encrypted cookie
- Authorization state will be lost after provider redirect
- Provider success callback cannot retrieve authorization parameters
- This breaks the entire OAuth flow

---

### Provider Success Callback

**Regular Issuer Flow:**
1. Provider calls `auth.success()` with authentication result ✅
2. `auth.success()` wraps it with `ctx.subject()` ✅
3. User's `input.success()` callback is called ✅
4. User calls `ctx.subject(type, properties)` ✅
5. **`ctx.subject()` retrieves authorization state from cookie** ✅
6. **Generates authorization code or tokens** ✅
7. **Stores code/tokens in storage** ✅
8. **Redirects to redirect_uri with code/tokens** ✅

**Enterprise Issuer Flow:**
1. Provider calls `auth.success()` with authentication result ✅
2. Get tenant from context ✅
3. Get or create browser session ✅
4. Enrich with RBAC claims ✅
5. Build EnterpriseAuthResult ✅
6. Call user's `config.onSuccess()` callback ✅
7. User calls `enterpriseCtx.subject(type, properties)` ✅
8. **❌ BROKEN: `subject()` just returns JSON**
9. **❌ MISSING: No authorization code generation**
10. **❌ MISSING: No token generation**
11. **❌ MISSING: No OAuth redirect**

**Gaps:**
- `ctx.subject()` returns JSON instead of OAuth response
- No authorization code flow implementation
- No implicit flow (response_type=token) implementation
- Session is created/updated (good!) but OAuth flow is broken
- RBAC claims are computed but never added to JWT

---

### Cookie/State Management

**Regular Issuer:**
```typescript
// ENCRYPTED cookies
async set(ctx, key, maxAge, value) {
  setCookie(ctx, key, await encrypt(value), {...})
}

async get(ctx: Context, key: string) {
  const raw = getCookie(ctx, key)
  if (!raw) return
  return decrypt(raw).catch((ex) => {
    console.error("failed to decrypt", key, ex)
  })
}

async function encrypt(value: any) {
  return await new CompactEncrypt(
    new TextEncoder().encode(JSON.stringify(value)),
  )
    .setProtectedHeader({ alg: "RSA-OAEP-512", enc: "A256GCM" })
    .encrypt(await encryptionKey().then((k) => k.public))
}

async function decrypt(value: string) {
  return JSON.parse(
    new TextDecoder().decode(
      await compactDecrypt(
        value,
        await encryptionKey().then((v) => v.private),
      ).then((value) => value.plaintext),
    ),
  )
}
```

**Enterprise Issuer:**
```typescript
// PLAIN TEXT cookies (security vulnerability!)
async set(ctx, key, maxAge, value) {
  const { setCookie } = await import("hono/cookie")
  setCookie(ctx, key, JSON.stringify(value), {...}) // ❌ NO ENCRYPTION
}

async get(ctx: Context, key: string) {
  const { getCookie } = await import("hono/cookie")
  const raw = getCookie(ctx, key)
  if (!raw) return
  try {
    return JSON.parse(raw) // ❌ NO DECRYPTION
  } catch {
    return undefined
  }
}

// ❌ NO encrypt() function
// ❌ NO decrypt() function
```

**Security Impact:** **CRITICAL**
Authorization state (including PKCE challenges, redirect URIs, client IDs) is stored in plain text cookies. This is a major security vulnerability.

---

## Summary of Required Changes

### Immediate Blockers (Must Fix First)

1. **Set up cryptographic keys** - Import and initialize signing/encryption keys
2. **Implement cookie encryption/decryption** - Fix `auth.set()` and `auth.get()`
3. **Implement `getAuthorization()` helper** - Retrieve auth state from cookie
4. **Implement token generation** - Create `generateTokens()` function
5. **Implement `/token` endpoint** - Full implementation with all grant types
6. **Fix `ctx.subject()` implementation** - Return OAuth redirects, not JSON
7. **Implement JWKS endpoint** - Return real signing keys
8. **Implement `/userinfo` endpoint** - For OIDC compliance

### High Priority (Fix Soon)

9. **Add refresh token logic** - With reuse detection
10. **Add PKCE validation** - In `/token` endpoint
11. **Fix token invalidation** - With tenant scoping
12. **Add token revocation** - `/token/revoke` endpoint
13. **Add token introspection** - `/token/introspect` endpoint
14. **Add client authentication** - ClientAuthenticator setup
15. **Add authorization code storage** - In `ctx.subject()`

### Medium Priority (Nice to Have)

16. **Add rate limiting** - To token endpoints
17. **Add audit integration** - For compliance
18. **Improve tenant storage** - Consistent use of TenantStorageImpl
19. **Complete metadata endpoints** - Add missing claims
20. **Add client credentials grant** - For M2M auth

---

## Recommended Implementation Order

### Phase 1: Core OAuth Flow (Days 1-3)
1. Set up signing and encryption keys
2. Implement encrypt/decrypt for cookies
3. Implement getAuthorization() helper
4. Store authorization state in encrypted cookie in `/authorize`
5. Implement generateTokens() with JWT signing
6. Fix ctx.subject() to generate codes and redirect

### Phase 2: Token Endpoint (Days 4-5)
7. Implement `/token` endpoint with authorization_code grant
8. Add PKCE validation
9. Add refresh_token grant with reuse detection
10. Add client_credentials grant
11. Fix JWKS endpoint to return real keys

### Phase 3: OIDC & Security (Days 6-7)
12. Implement `/userinfo` endpoint
13. Fix token invalidation with tenant scoping
14. Add RevocationService and `/token/revoke`
15. Add `/token/introspect` endpoint
16. Add client authentication

### Phase 4: Production Readiness (Days 8-9)
17. Add rate limiting to all token endpoints
18. Integrate audit logging
19. Improve tenant-scoped storage
20. Complete metadata endpoints
21. Add comprehensive error handling
22. Add unit tests

### Phase 5: Documentation & Testing (Day 10)
23. Document enterprise-specific OAuth flows
24. Add integration tests
25. Update API documentation
26. Add migration guide

---

## Risk Assessment

### Critical Risks
- **Security Vulnerability:** Plain text cookies expose authorization state
- **Non-Functional:** OAuth flow is completely broken without `/token` endpoint
- **Data Leakage:** No tenant isolation for tokens
- **Auth Bypass:** No PKCE validation allows code interception

### Business Impact
- **Cannot Deploy to Production:** Enterprise issuer is not functional
- **Security Audit Failure:** Major vulnerabilities in cookie handling
- **OIDC Non-Compliance:** Missing required endpoints
- **No Token Management:** Cannot revoke or introspect tokens

### Technical Debt
- **Incomplete Implementation:** ~70% of OAuth features missing
- **Copy-Paste Required:** Must duplicate logic from regular issuer
- **Maintenance Burden:** Two issuers with different capabilities
- **Breaking Changes:** Fixing these issues will require API changes

---

## Testing Recommendations

After implementing fixes, test these scenarios:

### Authorization Code Flow
1. ✅ Start `/authorize` request with PKCE
2. ✅ Authorization state is encrypted in cookie
3. ✅ Redirect to provider
4. ✅ Provider callback retrieves encrypted authorization state
5. ✅ Generate authorization code
6. ✅ Store code with PKCE challenge in tenant storage
7. ✅ Redirect to redirect_uri with code
8. ✅ Exchange code for tokens at `/token`
9. ✅ Validate PKCE verifier
10. ✅ Return access and refresh tokens
11. ✅ JWT includes RBAC claims and tenant_id

### Refresh Token Flow
1. ✅ Submit refresh token to `/token`
2. ✅ Validate refresh token exists in storage
3. ✅ Detect reuse if used before
4. ✅ Invalidate all tokens on reuse detection
5. ✅ Generate new tokens with rotation
6. ✅ Return new access and refresh tokens

### Client Credentials Flow
1. ✅ Submit client_id and client_secret to `/token`
2. ✅ Validate client credentials
3. ✅ Call provider.client() if supported
4. ✅ Return access token (no refresh token)

### Token Revocation
1. ✅ Submit token to `/token/revoke`
2. ✅ Authenticate client
3. ✅ Revoke token
4. ✅ Return success (always)

### Token Introspection
1. ✅ Submit token to `/token/introspect`
2. ✅ Authenticate client
3. ✅ Verify token ownership
4. ✅ Check revocation status
5. ✅ Return active status and claims

### Multi-Tenant Scenarios
1. ✅ Tokens are isolated per tenant
2. ✅ Token invalidation is tenant-scoped
3. ✅ RBAC claims are tenant-specific
4. ✅ Sessions are tenant-scoped

---

## Conclusion

The enterprise issuer has **excellent infrastructure** (multi-tenancy, sessions, RBAC, theme resolution) but is **missing the core OAuth functionality**. It's approximately **30% complete** compared to the regular issuer.

**Estimated Effort:** 8-10 developer days to reach feature parity with the regular issuer.

**Recommendation:** Implement the fixes in the order suggested above. Focus on getting the basic OAuth flow working first (Phase 1-2), then add security and production features (Phase 3-4).

The good news is that the enterprise-specific features (multi-tenancy, sessions, RBAC) are well-implemented. The missing pieces are mostly OAuth standard features that can be adapted from the regular issuer with tenant isolation added.
