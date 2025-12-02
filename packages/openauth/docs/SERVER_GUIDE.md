# OpenAuth Server Guide

A comprehensive guide for implementing authentication servers using OpenAuth. This guide covers both the standard `issuer()` for simple applications and the enterprise `createMultiTenantIssuer()` for multi-tenant SaaS platforms.

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Regular Issuer](#2-regular-issuer)
3. [Multi-Tenant Enterprise Issuer](#3-multi-tenant-enterprise-issuer)
4. [Providers](#4-providers)
5. [Client Integration](#5-client-integration)
6. [Theming](#6-theming)
7. [Storage](#7-storage)
8. [Deployment](#8-deployment)

---

## 1. Quick Start

### Minimal Setup with Regular Issuer

Here is the simplest possible OpenAuth server using the Password provider:

```typescript
// issuer.ts
import { issuer } from "@openauthjs/openauth"
import { PasswordProvider } from "@openauthjs/openauth/provider/password"
import { PasswordUI } from "@openauthjs/openauth/ui/password"
import { MemoryStorage } from "@openauthjs/openauth/storage/memory"
import { createSubjects } from "@openauthjs/openauth/subject"
import { object, string } from "valibot"

// Define your subjects (what goes in the JWT)
const subjects = createSubjects({
  user: object({
    userID: string(),
    email: string(),
  }),
})

// Create the issuer
const app = issuer({
  storage: MemoryStorage(),
  subjects,
  providers: {
    password: PasswordProvider(
      PasswordUI({
        sendCode: async (email, code) => {
          // In production, send this via email
          console.log(`Verification code for ${email}: ${code}`)
        },
      }),
    ),
  },
  async success(ctx, value) {
    if (value.provider === "password") {
      // Look up or create user in your database
      const userID = await findOrCreateUser(value.email)

      return ctx.subject("user", {
        userID,
        email: value.email,
      })
    }
    throw new Error("Unknown provider")
  },
})

export default app
```

### Running the Server

**Node.js:**

```typescript
import { serve } from "@hono/node-server"
serve(app, { port: 3000 })
```

**Bun:**

```typescript
export default app
```

**Cloudflare Workers:**

```typescript
export default app
```

---

## 2. Regular Issuer

The regular `issuer()` function creates an OpenAuth server suitable for single-tenant applications.

### Full Configuration

```typescript
import { issuer } from "@openauthjs/openauth"
import { DynamoStorage } from "@openauthjs/openauth/storage/dynamo"
import { GoogleProvider } from "@openauthjs/openauth/provider/google"
import { GithubProvider } from "@openauthjs/openauth/provider/github"
import { PasswordProvider } from "@openauthjs/openauth/provider/password"
import { PasswordUI } from "@openauthjs/openauth/ui/password"
import { CodeProvider } from "@openauthjs/openauth/provider/code"
import { CodeUI } from "@openauthjs/openauth/ui/code"
import { Select } from "@openauthjs/openauth/ui/select"
import { THEME_SST } from "@openauthjs/openauth/ui/theme"
import { createSubjects } from "@openauthjs/openauth/subject"
import { object, string, optional } from "valibot"

// Define subjects
const subjects = createSubjects({
  user: object({
    userID: string(),
    email: string(),
    name: optional(string()),
  }),
  admin: object({
    adminID: string(),
    workspaceID: string(),
  }),
})

const app = issuer({
  // Storage adapter (required)
  storage: DynamoStorage({
    table: "openauth-store",
    pk: "pk",
    sk: "sk",
  }),

  // Subject definitions (required)
  subjects,

  // Authentication providers (required)
  providers: {
    google: GoogleProvider({
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      scopes: ["openid", "email", "profile"],
    }),
    github: GithubProvider({
      clientID: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      scopes: ["user:email"],
    }),
    password: PasswordProvider(
      PasswordUI({
        sendCode: async (email, code) => {
          await sendEmail({
            to: email,
            subject: "Your verification code",
            body: `Your code is: ${code}`,
          })
        },
      }),
    ),
    code: CodeProvider(
      CodeUI({
        sendCode: async (claims, code) => {
          await sendEmail({
            to: claims.email,
            subject: "Your login code",
            body: `Your code is: ${code}`,
          })
        },
      }),
    ),
  },

  // UI Theme (optional)
  theme: THEME_SST,

  // Provider selection UI (optional)
  select: Select({
    providers: {
      google: { display: "Google" },
      github: { display: "GitHub" },
      password: { display: "Email & Password" },
      code: { hide: true }, // Hide from selection
    },
  }),

  // Token TTL configuration (optional)
  ttl: {
    access: 60 * 60 * 24 * 30, // 30 days
    refresh: 60 * 60 * 24 * 365, // 1 year
    reuse: 60, // 60 second reuse window
    retention: 0, // No retention after reuse
  },

  // Client authorization check (optional)
  async allow(input, req) {
    // Allow localhost in development
    const redir = new URL(input.redirectURI).hostname
    if (redir === "localhost" || redir === "127.0.0.1") {
      return true
    }
    // Check against allowed domains
    const allowedDomains = ["myapp.com", "staging.myapp.com"]
    return allowedDomains.some((domain) => redir.endsWith(domain))
  },

  // Success callback (required)
  async success(ctx, value) {
    let userID: string
    let email: string
    let name: string | undefined

    switch (value.provider) {
      case "google":
        // Extract from Google ID token
        const googleUser = value.tokenset.id
        email = googleUser.email
        name = googleUser.name
        userID = await findOrCreateUser({
          email,
          provider: "google",
          providerId: googleUser.sub,
        })
        break

      case "github":
        // Fetch user info from GitHub API
        const githubUser = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${value.tokenset.access}`,
          },
        }).then((r) => r.json())

        email = githubUser.email
        name = githubUser.name
        userID = await findOrCreateUser({
          email,
          provider: "github",
          providerId: githubUser.id.toString(),
        })
        break

      case "password":
        email = value.email
        userID = await findOrCreateUser({ email, provider: "password" })
        break

      case "code":
        email = value.claims.email
        userID = await findOrCreateUser({ email, provider: "code" })
        break

      default:
        throw new Error(`Unknown provider: ${value.provider}`)
    }

    return ctx.subject("user", {
      userID,
      email,
      name,
    })
  },

  // CORS configuration (optional)
  cors: {
    origins: ["https://myapp.com", "https://staging.myapp.com"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    headers: ["Content-Type", "Authorization"],
    maxAge: 86400,
  },
})

export default app
```

### Subjects Definition

Subjects define what information is encoded in the JWT access token. Use a validation library that follows the [standard-schema specification](https://github.com/standard-schema/standard-schema):

```typescript
// subjects.ts
import { createSubjects } from "@openauthjs/openauth/subject"
import { object, string, optional, array } from "valibot"

export const subjects = createSubjects({
  // Regular user
  user: object({
    userID: string(),
    email: string(),
    name: optional(string()),
  }),

  // Admin with workspace context
  admin: object({
    adminID: string(),
    workspaceID: string(),
    permissions: array(string()),
  }),

  // Service account for machine-to-machine auth
  service: object({
    serviceID: string(),
    clientID: string(),
  }),
})

// Export type for use in client code
export type Subjects = typeof subjects
```

**Best Practices for Subjects:**

- Only include data that rarely changes (userID, email)
- Avoid frequently changing data (roles, preferences)
- Keep the payload small for better performance
- Place subjects in a shared module for client/server use

---

## 3. Multi-Tenant Enterprise Issuer

For SaaS applications requiring multi-tenant support, use `createMultiTenantIssuer()`:

### When to Use Multi-Tenant Issuer

Use `createMultiTenantIssuer()` when you need:

- **Multi-tenant isolation**: Each tenant has isolated data and configuration
- **White-label branding**: Per-tenant themes, logos, and custom CSS
- **Multi-account sessions**: Users logged into multiple accounts simultaneously
- **RBAC integration**: Role-based access control with token enrichment
- **OIDC prompt parameters**: Support for `prompt=login`, `select_account`, etc.

### Basic Multi-Tenant Setup

```typescript
// enterprise-issuer.ts
import { createMultiTenantIssuer } from "@openauthjs/openauth/enterprise"
import { TenantServiceImpl } from "@openauthjs/openauth/tenant"
import { SessionServiceImpl, hexToSecret } from "@openauthjs/openauth/session"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"
import { GoogleProvider } from "@openauthjs/openauth/provider/google"
import { PasswordProvider } from "@openauthjs/openauth/provider/password"
import { PasswordUI } from "@openauthjs/openauth/ui/password"
import { createSubjects } from "@openauthjs/openauth/subject"
import { object, string, array } from "valibot"

// Subjects with tenant context
const subjects = createSubjects({
  user: object({
    userID: string(),
    tenantID: string(),
    email: string(),
    roles: array(string()),
    permissions: array(string()),
  }),
})

export default {
  async fetch(request: Request, env: Env) {
    // Initialize storage
    const storage = CloudflareStorage({ namespace: env.AUTH_KV })

    // Initialize services
    const tenantService = new TenantServiceImpl(storage)
    const sessionService = new SessionServiceImpl(storage)

    // Create enterprise issuer
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret: hexToSecret(env.SESSION_SECRET),

      subjects,

      providers: {
        google: GoogleProvider({
          clientID: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          scopes: ["openid", "email", "profile"],
        }),
        password: PasswordProvider(
          PasswordUI({
            sendCode: async (email, code) => {
              // Send verification email
            },
          }),
        ),
      },

      // Tenant resolution configuration
      tenantResolver: {
        baseDomain: "auth.myapp.com",
        pathPrefix: "/tenants",
        headerName: "X-Tenant-ID",
        queryParam: "tenant",
      },

      // Success callback with tenant context
      onSuccess: async (ctx, value, tenant) => {
        const userID = await findOrCreateUser({
          email: value.email || value.properties?.email,
          tenantId: tenant.id,
          provider: value.provider,
        })

        return ctx.subject("user", {
          userID,
          tenantID: tenant.id,
          email: value.email || value.properties?.email,
          roles: value.roles,
          permissions: value.permissions,
        })
      },

      // Optional: Client authorization per tenant
      onAllow: async (input, req, tenant) => {
        // Check if client is allowed for this tenant
        const allowedClients = tenant.settings.allowedClients || []
        return allowedClients.includes(input.clientID)
      },
    })

    return app.fetch(request, env)
  },
}
```

### Tenant Resolution Strategies

The enterprise issuer resolves tenants in the following priority order:

#### 1. Custom Domain

```
auth.acme-corp.com -> tenant "acme-corp"
```

#### 2. Subdomain

```
acme-corp.auth.myapp.com -> tenant "acme-corp"
```

#### 3. Path Prefix

```
/tenants/acme-corp/authorize -> tenant "acme-corp"
```

#### 4. Header

```
X-Tenant-ID: acme-corp -> tenant "acme-corp"
```

#### 5. Query Parameter

```
/authorize?tenant=acme-corp -> tenant "acme-corp"
```

### Per-Tenant Branding

Each tenant can have custom branding:

```typescript
// Create tenant with branding
await tenantService.createTenant({
  id: "acme-corp",
  name: "Acme Corporation",
  domain: "auth.acme-corp.com",
  branding: {
    theme: {
      primary: "#FF5E00",
      secondary: "#333333",
      background: "#FFFFFF",
      text: "#1A1A1A",
      fontFamily: "Inter, sans-serif",
    },
    logoLight: "https://acme.com/logo-dark.svg",
    logoDark: "https://acme.com/logo-light.svg",
    favicon: "https://acme.com/favicon.ico",
    customCss: `
      .btn-primary { border-radius: 8px; }
    `,
  },
  settings: {
    maxAccountsPerSession: 3,
    sessionLifetime: 604800, // 7 days
    allowPublicRegistration: true,
    requireEmailVerification: true,
    allowedProviders: ["google", "password"],
  },
})
```

### Multi-Account Session Management

The enterprise issuer supports multi-account browser sessions (like Google's account switcher):

```typescript
// Session configuration
const sessionConfig = {
  maxAccountsPerSession: 3, // Max accounts per browser
  sessionLifetimeSeconds: 604800, // 7 days
  slidingWindowSeconds: 86400, // Extend session on activity
  cookieName: "__session",
}

// The session service handles:
// - Adding accounts to sessions (up to 3)
// - Switching active accounts
// - Removing accounts
// - Session expiration with sliding window
```

**Session API Endpoints:**

```
GET  /session/accounts       - List accounts in current session
POST /session/switch         - Switch active account
POST /session/remove         - Remove an account
POST /session/logout         - Sign out all accounts
```

### RBAC Integration

When `rbacService` is provided, tokens are automatically enriched with roles and permissions:

```typescript
import { RBACServiceImpl, RBACAdapter } from "@openauthjs/openauth/rbac"

// Initialize RBAC
const rbacAdapter = new RBACAdapter(env.AUTH_DB) // D1 database
const rbacService = new RBACServiceImpl(rbacAdapter, storage)

const { app } = createMultiTenantIssuer({
  // ... other config
  rbacService,

  onSuccess: async (ctx, value, tenant) => {
    // value.roles and value.permissions are populated by RBAC service
    return ctx.subject("user", {
      userID: value.userID,
      tenantID: tenant.id,
      roles: value.roles, // e.g., ["admin", "editor"]
      permissions: value.permissions, // e.g., ["posts:write", "users:read"]
    })
  },
})
```

**RBAC API Endpoints:**

```
POST /rbac/check             - Check single permission
POST /rbac/check-batch       - Check multiple permissions
GET  /rbac/permissions       - Get user's permissions

# Admin endpoints
POST /rbac/admin/roles       - Create role
POST /rbac/admin/permissions - Create permission
POST /rbac/admin/assign      - Assign role to user
```

---

## 4. Providers

OpenAuth supports multiple authentication providers out of the box.

### OAuth2 Providers

#### Google

```typescript
import { GoogleProvider } from "@openauthjs/openauth/provider/google"

GoogleProvider({
  clientID: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  scopes: ["openid", "email", "profile"],
  query: {
    access_type: "offline", // Get refresh token
    prompt: "consent", // Force consent screen
  },
})
```

#### Google OIDC (No client secret needed)

```typescript
import { GoogleOidcProvider } from "@openauthjs/openauth/provider/google"

GoogleOidcProvider({
  clientID: process.env.GOOGLE_CLIENT_ID!,
})
```

#### GitHub

```typescript
import { GithubProvider } from "@openauthjs/openauth/provider/github"

GithubProvider({
  clientID: process.env.GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  scopes: ["user:email", "read:user"],
})
```

#### Facebook

```typescript
import { FacebookProvider } from "@openauthjs/openauth/provider/facebook"

FacebookProvider({
  clientID: process.env.FACEBOOK_APP_ID!,
  clientSecret: process.env.FACEBOOK_APP_SECRET!,
  scopes: ["email", "public_profile"],
})
```

#### Microsoft

```typescript
import { MicrosoftProvider } from "@openauthjs/openauth/provider/microsoft"

MicrosoftProvider({
  clientID: process.env.AZURE_CLIENT_ID!,
  clientSecret: process.env.AZURE_CLIENT_SECRET!,
  scopes: ["openid", "email", "profile"],
})
```

#### Apple

```typescript
import { AppleProvider } from "@openauthjs/openauth/provider/apple"

AppleProvider({
  clientID: process.env.APPLE_CLIENT_ID!,
  clientSecret: process.env.APPLE_CLIENT_SECRET!,
  scopes: ["name", "email"],
})
```

#### Discord

```typescript
import { DiscordProvider } from "@openauthjs/openauth/provider/discord"

DiscordProvider({
  clientID: process.env.DISCORD_CLIENT_ID!,
  clientSecret: process.env.DISCORD_CLIENT_SECRET!,
  scopes: ["identify", "email"],
})
```

### Password Provider

Email/password authentication with verification codes:

```typescript
import { PasswordProvider } from "@openauthjs/openauth/provider/password"
import { PasswordUI } from "@openauthjs/openauth/ui/password"

PasswordProvider(
  PasswordUI({
    // Copy customization
    copy: {
      error_email_taken: "This email is already registered.",
      error_invalid_password: "Invalid email or password.",
      error_invalid_code: "Invalid verification code.",
    },

    // Send verification code
    sendCode: async (email, code) => {
      await sendEmail({
        to: email,
        subject: "Verify your email",
        body: `Your verification code is: ${code}`,
      })
    },

    // Password validation
    validatePassword: (password) => {
      if (password.length < 8) {
        return "Password must be at least 8 characters"
      }
      if (!/[A-Z]/.test(password)) {
        return "Password must contain an uppercase letter"
      }
      if (!/[0-9]/.test(password)) {
        return "Password must contain a number"
      }
      return undefined // Valid
    },
  }),
)
```

**Password Provider Routes:**

- `GET /password/authorize` - Login form
- `POST /password/authorize` - Submit login
- `GET /password/register` - Registration form
- `POST /password/register` - Submit registration
- `GET /password/change` - Password reset form
- `POST /password/change` - Submit password reset

### Code Provider

Passwordless authentication via email/SMS codes:

```typescript
import { CodeProvider } from "@openauthjs/openauth/provider/code"
import { CodeUI } from "@openauthjs/openauth/ui/code"

CodeProvider(
  CodeUI({
    length: 6, // Code length (default: 6)

    copy: {
      code_info: "We'll send a verification code to your email",
      button_request: "Send Code",
      button_verify: "Verify",
    },

    sendCode: async (claims, code) => {
      // claims contains form data (email, phone, etc.)
      if (claims.email) {
        await sendEmail({
          to: claims.email,
          subject: "Your login code",
          body: `Your code is: ${code}`,
        })
      } else if (claims.phone) {
        await sendSMS({
          to: claims.phone,
          body: `Your code is: ${code}`,
        })
      }
    },
  }),
)
```

### Custom OAuth2 Provider

For providers not included by default:

```typescript
import { Oauth2Provider } from "@openauthjs/openauth/provider/oauth2"

// Generic OAuth2 provider
Oauth2Provider({
  type: "custom",
  clientID: process.env.CUSTOM_CLIENT_ID!,
  clientSecret: process.env.CUSTOM_CLIENT_SECRET!,
  endpoint: {
    authorization: "https://auth.example.com/oauth/authorize",
    token: "https://auth.example.com/oauth/token",
    jwks: "https://auth.example.com/.well-known/jwks.json", // Optional
  },
  scopes: ["openid", "email", "profile"],
  pkce: true, // Enable PKCE if required
  query: {
    // Additional query parameters
    audience: "https://api.example.com",
  },
})
```

### Custom OIDC Provider

For OpenID Connect providers:

```typescript
import { OidcProvider } from "@openauthjs/openauth/provider/oidc"

OidcProvider({
  type: "custom-oidc",
  clientID: process.env.OIDC_CLIENT_ID!,
  clientSecret: process.env.OIDC_CLIENT_SECRET!,
  issuer: "https://idp.example.com",
  scopes: ["openid", "email", "profile"],
})
```

---

## 5. Client Integration

### Creating a Client

```typescript
// client.ts
import { createClient } from "@openauthjs/openauth/client"

const client = createClient({
  clientID: "my-web-app",
  issuer: "https://auth.myapp.com",
})
```

### Authorization Flow (SSR)

```typescript
// pages/login.ts
import { client } from "../client"

export async function GET(request: Request) {
  const redirectURI = "https://myapp.com/callback"

  const { url, challenge } = await client.authorize(redirectURI, "code")

  // Store challenge in session for later verification
  cookies.set("oauth_challenge", JSON.stringify(challenge))

  // Redirect to auth server
  return redirect(url)
}
```

### Authorization Flow (SPA with PKCE)

```typescript
// For single-page applications
const redirectURI = "https://myapp.com/callback"

const { url, challenge } = await client.authorize(redirectURI, "code", {
  pkce: true,
  provider: "google", // Optional: skip provider selection
})

// Store challenge in sessionStorage for later
sessionStorage.setItem("oauth_challenge", JSON.stringify(challenge))

// Redirect to auth server
window.location.href = url
```

### Token Exchange

```typescript
// pages/callback.ts
import { client } from "../client"
import { subjects } from "../subjects"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")

  // Retrieve stored challenge
  const challenge = JSON.parse(cookies.get("oauth_challenge") || "{}")

  // Verify state matches
  if (state !== challenge.state) {
    throw new Error("State mismatch")
  }

  // Exchange code for tokens
  const result = await client.exchange(
    code!,
    "https://myapp.com/callback",
    challenge.verifier, // For PKCE flow
  )

  if (result.err) {
    // Handle error
    console.error("Token exchange failed:", result.err)
    return redirect("/login?error=exchange_failed")
  }

  const { access, refresh, expiresIn } = result.tokens

  // Store tokens securely
  cookies.set("access_token", access, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: expiresIn,
  })

  cookies.set("refresh_token", refresh, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  })

  return redirect("/dashboard")
}
```

### Token Verification

```typescript
// middleware.ts
import { client } from "./client"
import { subjects } from "./subjects"

export async function verifyAuth(request: Request) {
  const accessToken = cookies.get("access_token")
  const refreshToken = cookies.get("refresh_token")

  if (!accessToken) {
    return { authenticated: false }
  }

  // Verify token and optionally refresh
  const result = await client.verify(subjects, accessToken, {
    refresh: refreshToken,
  })

  if (result.err) {
    // Token invalid or expired and couldn't refresh
    return { authenticated: false, error: result.err }
  }

  // If tokens were refreshed, update cookies
  if (result.tokens) {
    cookies.set("access_token", result.tokens.access)
    cookies.set("refresh_token", result.tokens.refresh)
  }

  return {
    authenticated: true,
    subject: result.subject,
    // result.subject.type - "user" or "admin"
    // result.subject.properties - { userID, email, ... }
  }
}
```

### Token Refresh

```typescript
// For SPAs that need to manually refresh
const result = await client.refresh(refreshToken, {
  access: accessToken, // Optional: skip if access token is still valid
})

if (result.err) {
  // Refresh failed, user needs to re-authenticate
  window.location.href = "/login"
  return
}

if (result.tokens) {
  // Tokens were refreshed
  localStorage.setItem("access_token", result.tokens.access)
  localStorage.setItem("refresh_token", result.tokens.refresh)
}
```

### User Switching (Multi-Account)

For enterprise multi-tenant setups with multi-account sessions:

```typescript
// Switch to a different account in the session
const response = await fetch("/session/switch", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: "user-456" }),
})

// List all accounts in the session
const accounts = await fetch("/session/accounts").then((r) => r.json())
// [{ userId: "user-123", isActive: true }, { userId: "user-456", isActive: false }]

// Add another account (triggers new auth flow)
window.location.href = "/authorize?prompt=login&..."

// Remove an account from session
await fetch("/session/remove", {
  method: "POST",
  body: JSON.stringify({ userId: "user-456" }),
})
```

---

## 6. Theming

### Theme Properties

```typescript
import type { Theme } from "@openauthjs/openauth/ui/theme"

const myTheme: Theme = {
  // App title (shown in browser tab)
  title: "My App",

  // Favicon URL
  favicon: "https://myapp.com/favicon.svg",

  // Logo (single or light/dark variants)
  logo: "https://myapp.com/logo.svg",
  // OR
  logo: {
    light: "https://myapp.com/logo-dark.svg", // Used on light backgrounds
    dark: "https://myapp.com/logo-light.svg", // Used on dark backgrounds
  },

  // Primary color (buttons, links)
  primary: "#FF5E00",
  // OR
  primary: {
    light: "#FF5E00", // Light mode
    dark: "#FF8C4A", // Dark mode
  },

  // Background color
  background: "#FFFFFF",
  // OR
  background: {
    light: "#FFFFFF",
    dark: "#1A1A1A",
  },

  // Border radius
  radius: "md", // "none" | "sm" | "md" | "lg" | "full"

  // Font configuration
  font: {
    family: "Inter, sans-serif",
    scale: "1", // Font size multiplier
  },

  // Custom CSS (for importing fonts, custom styles)
  css: `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    .btn-primary {
      text-transform: uppercase;
    }
  `,
}
```

### Built-in Themes

```typescript
import {
  THEME_OPENAUTH, // Default minimal theme
  THEME_SST, // SST-inspired theme
  THEME_TERMINAL, // Terminal.shop inspired
  THEME_VERCEL, // Vercel-inspired
  THEME_SUPABASE, // Supabase-inspired
} from "@openauthjs/openauth/ui/theme"

const app = issuer({
  theme: THEME_SST,
  // ...
})
```

### Custom Theme

```typescript
import type { Theme } from "@openauthjs/openauth/ui/theme"

const corporateTheme: Theme = {
  title: "Acme Corp",
  favicon: "https://acme.com/favicon.ico",
  logo: {
    light: "https://acme.com/logo-dark.svg",
    dark: "https://acme.com/logo-light.svg",
  },
  primary: {
    light: "#1E40AF",
    dark: "#60A5FA",
  },
  background: {
    light: "#F8FAFC",
    dark: "#0F172A",
  },
  radius: "lg",
  font: {
    family: "Poppins, sans-serif",
    scale: "1.05",
  },
  css: `
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
  `,
}
```

### Per-Tenant Theming (Enterprise)

In multi-tenant mode, themes can be configured per tenant:

```typescript
// Create tenant with custom branding
await tenantService.createTenant({
  id: "acme-corp",
  name: "Acme Corporation",
  branding: {
    theme: {
      primary: "#FF5E00",
      secondary: "#333",
      background: "#FFF",
      text: "#1A1A1A",
      fontFamily: "Inter",
    },
    logoLight: "https://acme.com/logo-dark.svg",
    logoDark: "https://acme.com/logo-light.svg",
    favicon: "https://acme.com/favicon.ico",
    customCss: `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    `,
  },
})
```

**Theme Resolution Priority (Enterprise):**

1. `tenant.branding.theme` - Per-tenant customization
2. `config.theme` - Default from `createMultiTenantIssuer`
3. Default tenant theme - Tenant with ID "default"
4. `THEME_OPENAUTH` - Hardcoded fallback

---

## 7. Storage

### Memory Storage (Development Only)

```typescript
import { MemoryStorage } from "@openauthjs/openauth/storage/memory"

// Basic in-memory storage (data lost on restart)
const storage = MemoryStorage()

// With file persistence
const storage = MemoryStorage({
  persist: "./openauth-data.json",
})
```

**Warning:** Memory storage is not suitable for production. Use it only for development and testing.

### DynamoDB Storage (AWS)

```typescript
import { DynamoStorage } from "@openauthjs/openauth/storage/dynamo"

const storage = DynamoStorage({
  table: "openauth-store",
  pk: "pk", // Primary key column name
  sk: "sk", // Sort key column name
  ttl: "expiry", // TTL column name

  // Optional: Custom endpoint (for local development)
  endpoint: "http://localhost:8000",
})
```

**DynamoDB Table Schema:**

```yaml
TableName: openauth-store
KeySchema:
  - AttributeName: pk
    KeyType: HASH
  - AttributeName: sk
    KeyType: RANGE
AttributeDefinitions:
  - AttributeName: pk
    AttributeType: S
  - AttributeName: sk
    AttributeType: S
TimeToLiveSpecification:
  AttributeName: expiry
  Enabled: true
```

### Cloudflare KV Storage

```typescript
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"

// In Cloudflare Worker
export default {
  async fetch(request: Request, env: Env) {
    const storage = CloudflareStorage({
      namespace: env.AUTH_KV, // KV namespace binding
    })

    const app = issuer({
      storage,
      // ...
    })

    return app.fetch(request, env)
  },
}
```

### Environment Variable Configuration

You can configure storage via environment variable:

```bash
# DynamoDB
OPENAUTH_STORAGE='{"type":"dynamo","options":{"table":"openauth-store"}}'

# Memory
OPENAUTH_STORAGE='{"type":"memory"}'
```

**Note:** Cloudflare storage cannot be configured via environment variable because it requires bindings.

### Custom Storage Adapter

Implement the `StorageAdapter` interface for custom storage:

```typescript
import type { StorageAdapter } from "@openauthjs/openauth/storage/storage"

class PostgresStorage implements StorageAdapter {
  constructor(private pool: Pool) {}

  async get(key: string[]): Promise<Record<string, any> | undefined> {
    const joinedKey = key.join("::")
    const result = await this.pool.query(
      "SELECT value FROM auth_store WHERE key = $1 AND (expiry IS NULL OR expiry > NOW())",
      [joinedKey],
    )
    return result.rows[0]?.value
  }

  async set(key: string[], value: any, expiry?: Date): Promise<void> {
    const joinedKey = key.join("::")
    await this.pool.query(
      `INSERT INTO auth_store (key, value, expiry)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = $2, expiry = $3`,
      [joinedKey, JSON.stringify(value), expiry],
    )
  }

  async remove(key: string[]): Promise<void> {
    const joinedKey = key.join("::")
    await this.pool.query("DELETE FROM auth_store WHERE key = $1", [joinedKey])
  }

  async *scan(prefix: string[]): AsyncIterable<[string[], any]> {
    const joinedPrefix = prefix.join("::") + "::"
    const result = await this.pool.query(
      "SELECT key, value FROM auth_store WHERE key LIKE $1 AND (expiry IS NULL OR expiry > NOW())",
      [joinedPrefix + "%"],
    )
    for (const row of result.rows) {
      yield [row.key.split("::"), JSON.parse(row.value)]
    }
  }
}
```

---

## 8. Deployment

### Cloudflare Workers

```typescript
// worker.ts
import { issuer } from "@openauthjs/openauth"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"

interface Env {
  AUTH_KV: KVNamespace
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const app = issuer({
      storage: CloudflareStorage({ namespace: env.AUTH_KV }),
      providers: {
        // Configure providers with env secrets
      },
      subjects,
      async success(ctx, value) {
        // Handle success
      },
    })

    return app.fetch(request, env)
  },
}
```

**wrangler.toml:**

```toml
name = "openauth-server"
main = "worker.ts"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "AUTH_KV"
id = "your-kv-namespace-id"

[vars]
# Non-secret configuration

# Secrets (set via wrangler secret put)
# GOOGLE_CLIENT_ID
# GOOGLE_CLIENT_SECRET
# SESSION_SECRET
```

### AWS Lambda

```typescript
// handler.ts
import { issuer, aws } from "@openauthjs/openauth"
import { DynamoStorage } from "@openauthjs/openauth/storage/dynamo"

const app = issuer({
  storage: DynamoStorage({ table: process.env.AUTH_TABLE! }),
  providers: {
    // Configure providers
  },
  subjects,
  async success(ctx, value) {
    // Handle success
  },
})

export const handler = aws(app)
```

**serverless.yml:**

```yaml
service: openauth-server

provider:
  name: aws
  runtime: nodejs20.x
  environment:
    AUTH_TABLE: !Ref AuthTable
    GOOGLE_CLIENT_ID: ${ssm:/openauth/google-client-id}
    GOOGLE_CLIENT_SECRET: ${ssm:/openauth/google-client-secret}

functions:
  auth:
    handler: handler.handler
    events:
      - http:
          path: /{proxy+}
          method: any
      - http:
          path: /
          method: any

resources:
  Resources:
    AuthTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: openauth-store
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: pk
            AttributeType: S
          - AttributeName: sk
            AttributeType: S
        KeySchema:
          - AttributeName: pk
            KeyType: HASH
          - AttributeName: sk
            KeyType: RANGE
        TimeToLiveSpecification:
          AttributeName: expiry
          Enabled: true
```

### Node.js Server

```typescript
// server.ts
import { serve } from "@hono/node-server"
import { issuer } from "@openauthjs/openauth"
import { DynamoStorage } from "@openauthjs/openauth/storage/dynamo"

const app = issuer({
  storage: DynamoStorage({ table: "openauth-store" }),
  providers: {
    // Configure providers
  },
  subjects,
  async success(ctx, value) {
    // Handle success
  },
})

serve({
  fetch: app.fetch,
  port: 3000,
})

console.log("OpenAuth server running on http://localhost:3000")
```

### Docker

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
```

### Bun

```typescript
// server.ts
import { issuer } from "@openauthjs/openauth"

const app = issuer({
  // Configuration
})

export default {
  port: 3000,
  fetch: app.fetch,
}
```

```bash
bun run server.ts
```

---

## Appendix: OAuth Endpoints Reference

The issuer exposes the following OAuth/OIDC endpoints:

| Endpoint                                  | Method | Description                    |
| ----------------------------------------- | ------ | ------------------------------ |
| `/authorize`                              | GET    | Start authorization flow       |
| `/token`                                  | POST   | Exchange code for tokens       |
| `/userinfo`                               | GET    | Get user info from token       |
| `/.well-known/jwks.json`                  | GET    | Public signing keys            |
| `/.well-known/oauth-authorization-server` | GET    | OAuth metadata                 |
| `/.well-known/openid-configuration`       | GET    | OIDC discovery                 |
| `/token/introspect`                       | POST   | Token introspection (RFC 7662) |
| `/token/revoke`                           | POST   | Token revocation (RFC 7009)    |

### Provider Endpoints

Each provider exposes routes under `/{provider}/`:

| Endpoint                | Method | Description         |
| ----------------------- | ------ | ------------------- |
| `/{provider}/authorize` | GET    | Start provider auth |
| `/{provider}/callback`  | GET    | OAuth callback      |

For Password provider:
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/password/register` | GET/POST | User registration |
| `/password/change` | GET/POST | Password reset |

---

## Appendix: Error Handling

```typescript
import {
  InvalidAuthorizationCodeError,
  InvalidRefreshTokenError,
  InvalidAccessTokenError,
  InvalidSubjectError,
} from "@openauthjs/openauth/error"

// In client code
const result = await client.exchange(code, redirectURI)

if (result.err) {
  if (result.err instanceof InvalidAuthorizationCodeError) {
    // Code expired or already used
    return redirect("/login?error=invalid_code")
  }
}

const verified = await client.verify(subjects, token, { refresh })

if (verified.err) {
  if (verified.err instanceof InvalidRefreshTokenError) {
    // Refresh token expired or revoked
    return redirect("/login?error=session_expired")
  }
  if (verified.err instanceof InvalidAccessTokenError) {
    // Access token invalid
    return redirect("/login?error=invalid_token")
  }
}
```

---

## Further Reading

- [OpenAuth GitHub Repository](https://github.com/openauthjs/openauth)
- [Hono Documentation](https://hono.dev)
- [OAuth 2.0 Specification](https://oauth.net/2/)
- [OpenID Connect Specification](https://openid.net/connect/)
