# OpenAuth Provider Configuration Reference

A comprehensive reference for all authentication provider implementations in OpenAuth. This document provides complete configuration details for each provider, including required and optional fields, endpoints, default scopes, and special requirements.

## Table of Contents

1. [OAuth2 Providers](#oauth2-providers)
2. [OIDC Providers](#oidc-providers)
3. [Generic Providers](#generic-providers)
4. [Custom/Passwordless Providers](#custompasswordless-providers)
5. [Configuration Parameters](#configuration-parameters)
6. [Error Handling](#error-handling)

---

## OAuth2 Providers

Providers that implement the OAuth 2.0 authorization code flow with optional PKCE support.

### Google

**Type**: OAuth2 | OIDC

**Endpoints**:

- authorization: `https://accounts.google.com/o/oauth2/v2/auth`
- token: `https://oauth2.googleapis.com/token`
- jwks: `https://www.googleapis.com/oauth2/v3/certs`

**Required Fields**:

- `clientID`: string - The OAuth client ID from Google Cloud Console
- `clientSecret`: string - The OAuth client secret from Google Cloud Console (OAuth2 only)

**Optional Fields**:

- `scopes`: string[] - List of OAuth scopes (defaults to provider-specific scopes)
- `query`: Record<string, string> - Additional authorization endpoint parameters
- `pkce`: boolean - Enable PKCE flow (default: false)

**Default Scopes**: Provider determines based on requested scopes

**Notes**: Google supports both OAuth2 and OIDC. Use `GoogleProvider` for OAuth2 or `GoogleOidcProvider` for OIDC.

**Example Usage**:

```typescript
import { GoogleProvider } from "@openauthjs/openauth/provider/google"

export default issuer({
  providers: {
    google: GoogleProvider({
      clientID: "YOUR_CLIENT_ID",
      clientSecret: "YOUR_CLIENT_SECRET",
    }),
  },
})
```

---

### GitHub

**Type**: OAuth2

**Endpoints**:

- authorization: `https://github.com/login/oauth/authorize`
- token: `https://github.com/login/oauth/access_token`

**Required Fields**:

- `clientID`: string - GitHub OAuth app client ID
- `clientSecret`: string - GitHub OAuth app client secret

**Optional Fields**:

- `scopes`: string[] - List of GitHub scopes to request
- `query`: Record<string, string> - Additional authorization parameters
- `pkce`: boolean - Enable PKCE flow (default: false)

**Default Scopes**: None specified (provider-dependent)

**Common Scopes**: `read:user`, `user:email`

**Notes**: GitHub OAuth supports access token requests with detailed scope control for repository and user access.

**Example Usage**:

```typescript
import { GithubProvider } from "@openauthjs/openauth/provider/github"

export default issuer({
  providers: {
    github: GithubProvider({
      clientID: "YOUR_CLIENT_ID",
      clientSecret: "YOUR_CLIENT_SECRET",
      scopes: ["read:user", "user:email"],
    }),
  },
})
```

---

### Microsoft

**Type**: OAuth2 | OIDC

**Endpoints** (OAuth2):

- authorization: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`
- token: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`

**Endpoints** (OIDC):

- issuer: `https://graph.microsoft.com/oidc/userinfo`

**Required Fields**:

- `clientID`: string - Azure AD application client ID
- `clientSecret`: string - Azure AD application client secret (OAuth2 only)
- `tenant`: string - Azure AD tenant ID (OAuth2 only)

**Optional Fields**:

- `scopes`: string[] - List of Microsoft scopes
- `query`: Record<string, string> - Additional authorization parameters
- `pkce`: boolean - Enable PKCE flow (default: false)

**Default Scopes**: Provider-dependent

**Common Scopes**: `User.Read`, `profile`, `email`

**Notes**: Microsoft uses tenant-specific endpoints. Set `tenant` to your Azure AD directory ID. OIDC configuration doesn't require tenant.

**Example Usage**:

```typescript
import {
  MicrosoftProvider,
  MicrosoftOidcProvider,
} from "@openauthjs/openauth/provider/microsoft"

// OAuth2
export default issuer({
  providers: {
    microsoft: MicrosoftProvider({
      tenant: "YOUR_TENANT_ID",
      clientID: "YOUR_CLIENT_ID",
      clientSecret: "YOUR_CLIENT_SECRET",
    }),
  },
})

// OIDC
export default issuer({
  providers: {
    microsoft: MicrosoftOidcProvider({
      clientID: "YOUR_CLIENT_ID",
    }),
  },
})
```

---

### Apple

**Type**: OAuth2 | OIDC

**Endpoints**:

- authorization: `https://appleid.apple.com/auth/authorize`
- token: `https://appleid.apple.com/auth/token`
- jwks: `https://appleid.apple.com/auth/keys`

**Required Fields**:

- `clientID`: string - Apple Services ID
- `clientSecret`: string - Apple client secret

**Optional Fields**:

- `scopes`: string[] - List of requested scopes (`name`, `email`)
- `responseMode`: "query" | "form_post" - Response mode (default: "query")
- `query`: Record<string, string> - Additional authorization parameters
- `pkce`: boolean - Enable PKCE flow (default: false)

**Default Scopes**: None

**Important Notes**:

- Apple requires `responseMode: "form_post"` when requesting `name` or `email` scopes
- Without form_post mode, user data is only returned on first-time signup
- Apple requires a client secret (not just client ID)

**Example Usage**:

```typescript
import { AppleProvider } from "@openauthjs/openauth/provider/apple"

// Without email/name scopes (GET callback)
export default issuer({
  providers: {
    apple: AppleProvider({
      clientID: "YOUR_SERVICE_ID",
      clientSecret: "YOUR_CLIENT_SECRET",
    }),
  },
})

// With email/name scopes (POST callback)
export default issuer({
  providers: {
    apple: AppleProvider({
      clientID: "YOUR_SERVICE_ID",
      clientSecret: "YOUR_CLIENT_SECRET",
      responseMode: "form_post",
      scopes: ["name", "email"],
    }),
  },
})
```

---

### Facebook

**Type**: OAuth2 | OIDC

**Endpoints** (OAuth2):

- authorization: `https://www.facebook.com/v12.0/dialog/oauth`
- token: `https://graph.facebook.com/v12.0/oauth/access_token`

**Endpoints** (OIDC):

- issuer: `https://graph.facebook.com`

**Required Fields**:

- `clientID`: string - Facebook App ID
- `clientSecret`: string - Facebook App Secret (OAuth2 only)

**Optional Fields**:

- `scopes`: string[] - List of Facebook scopes
- `query`: Record<string, string> - Additional authorization parameters
- `pkce`: boolean - Enable PKCE flow (default: false)

**Default Scopes**: None specified

**Common Scopes**: `email`, `public_profile`

**Notes**: Version endpoint uses v12.0 (may vary by API version)

**Example Usage**:

```typescript
import {
  FacebookProvider,
  FacebookOidcProvider,
} from "@openauthjs/openauth/provider/facebook"

export default issuer({
  providers: {
    facebook: FacebookProvider({
      clientID: "YOUR_APP_ID",
      clientSecret: "YOUR_APP_SECRET",
    }),
  },
})
```

---

### Discord

**Type**: OAuth2

**Endpoints**:

- authorization: `https://discord.com/oauth2/authorize`
- token: `https://discord.com/api/oauth2/token`

**Required Fields**:

- `clientID`: string - Discord application client ID
- `clientSecret`: string - Discord application client secret

**Optional Fields**:

- `scopes`: string[] - List of Discord scopes
- `query`: Record<string, string> - Additional authorization parameters
- `pkce`: boolean - Enable PKCE flow (default: false)

**Default Scopes**: None specified

**Common Scopes**: `identify`, `email`, `guilds`

**Notes**: Discord bot and OAuth settings are configured separately in developer portal

**Example Usage**:

```typescript
import { DiscordProvider } from "@openauthjs/openauth/provider/discord"

export default issuer({
  providers: {
    discord: DiscordProvider({
      clientID: "YOUR_CLIENT_ID",
      clientSecret: "YOUR_CLIENT_SECRET",
      scopes: ["identify", "email"],
    }),
  },
})
```

---

### Slack

**Type**: OAuth2 with OIDC support

**Endpoints**:

- authorization: `https://slack.com/openid/connect/authorize`
- token: `https://slack.com/api/openid.connect.token`

**Required Fields**:

- `clientID`: string - Slack application client ID
- `clientSecret`: string - Slack application client secret
- `team`: string - Slack workspace team ID (format: `T1234567890`)
- `scopes`: ("email" | "profile" | "openid")[] - Required scopes (only these three are supported)

**Optional Fields**:

- `query`: Record<string, string> - Additional authorization parameters
- `pkce`: boolean - Enable PKCE flow (default: false)

**Default Scopes**: Must be explicitly set

**Allowed Scopes**: `email`, `profile`, `openid` (restricted set)

**Notes**:

- Uses OpenID Connect protocol
- Team parameter pre-fills workspace if previously authenticated
- Only supports three specific scopes
- User will bypass consent screen if workspace previously authenticated

**Example Usage**:

```typescript
import { SlackProvider } from "@openauthjs/openauth/provider/slack"

export default issuer({
  providers: {
    slack: SlackProvider({
      team: "T1234567890",
      clientID: "YOUR_CLIENT_ID",
      clientSecret: "YOUR_CLIENT_SECRET",
      scopes: ["openid", "email", "profile"],
    }),
  },
})
```

---

### Spotify

**Type**: OAuth2

**Endpoints**:

- authorization: `https://accounts.spotify.com/authorize`
- token: `https://accounts.spotify.com/api/token`

**Required Fields**:

- `clientID`: string - Spotify application client ID
- `clientSecret`: string - Spotify application client secret

**Optional Fields**:

- `scopes`: string[] - List of Spotify scopes
- `query`: Record<string, string> - Additional authorization parameters (e.g., `show_dialog: "true"`)
- `pkce`: boolean - Enable PKCE flow (default: false)

**Default Scopes**: None specified

**Common Scopes**: `user-read-private`, `user-read-email`, `user-modify-playback-state`

**Notes**: Spotify uses standard OAuth 2.0 flow. Scopes control API access level.

**Example Usage**:

```typescript
import { SpotifyProvider } from "@openauthjs/openauth/provider/spotify"

export default issuer({
  providers: {
    spotify: SpotifyProvider({
      clientID: "YOUR_CLIENT_ID",
      clientSecret: "YOUR_CLIENT_SECRET",
      scopes: ["user-read-private", "user-read-email"],
    }),
  },
})
```

---

### Twitch

**Type**: OAuth2

**Endpoints**:

- authorization: `https://id.twitch.tv/oauth2/authorize`
- token: `https://id.twitch.tv/oauth2/token`

**Required Fields**:

- `clientID`: string - Twitch application client ID
- `clientSecret`: string - Twitch application client secret

**Optional Fields**:

- `scopes`: string[] - List of Twitch scopes
- `query`: Record<string, string> - Additional authorization parameters (e.g., `force_verify: "true"`)
- `pkce`: boolean - Enable PKCE flow (default: false)

**Default Scopes**: None specified

**Common Scopes**: `user:read:email`

**Notes**: Twitch enforces scope-based access to API endpoints

**Example Usage**:

```typescript
import { TwitchProvider } from "@openauthjs/openauth/provider/twitch"

export default issuer({
  providers: {
    twitch: TwitchProvider({
      clientID: "YOUR_CLIENT_ID",
      clientSecret: "YOUR_CLIENT_SECRET",
    }),
  },
})
```

---

### X (Twitter)

**Type**: OAuth2

**Endpoints**:

- authorization: `https://twitter.com/i/oauth2/authorize`
- token: `https://api.x.com/2/oauth2/token`

**Required Fields**:

- `clientID`: string - X API application client ID
- `clientSecret`: string - X API application client secret

**Optional Fields**:

- `scopes`: string[] - List of X scopes
- `query`: Record<string, string> - Additional authorization parameters
- `pkce`: boolean - Force PKCE (automatically enabled)

**Default Scopes**: None specified

**Common Scopes**: `tweet.read`, `users.read`, `follows.read`

**PKCE**: Required - `pkce: true` is automatically set and cannot be disabled

**Notes**:

- X requires PKCE for OAuth 2.0 flows (automatically enforced)
- Uses OAuth 2.0 with elevated access requirements
- Requires app approval and use case submission

**Example Usage**:

```typescript
import { XProvider } from "@openauthjs/openauth/provider/x"

export default issuer({
  providers: {
    x: XProvider({
      clientID: "YOUR_CLIENT_ID",
      clientSecret: "YOUR_CLIENT_SECRET",
    }),
  },
})
```

---

### Yahoo

**Type**: OAuth2

**Endpoints**:

- authorization: `https://api.login.yahoo.com/oauth2/request_auth`
- token: `https://api.login.yahoo.com/oauth2/get_token`

**Required Fields**:

- `clientID`: string - Yahoo OAuth application client ID
- `clientSecret`: string - Yahoo OAuth application client secret

**Optional Fields**:

- `scopes`: string[] - List of Yahoo scopes
- `query`: Record<string, string> - Additional authorization parameters
- `pkce`: boolean - Enable PKCE flow (default: false)

**Default Scopes**: None specified

**Common Scopes**: `openid`, `profile`, `email`

**Notes**: Yahoo supports OpenID Connect scopes

**Example Usage**:

```typescript
import { YahooProvider } from "@openauthjs/openauth/provider/yahoo"

export default issuer({
  providers: {
    yahoo: YahooProvider({
      clientID: "YOUR_CLIENT_ID",
      clientSecret: "YOUR_CLIENT_SECRET",
    }),
  },
})
```

---

### LinkedIn

**Type**: OAuth2

**Endpoints**:

- authorization: `https://www.linkedin.com/oauth/v2/authorization`
- token: `https://www.linkedin.com/oauth/v2/accessToken`

**Required Fields**:

- `clientID`: string - LinkedIn application client ID
- `clientSecret`: string - LinkedIn application client secret

**Optional Fields**:

- `scopes`: string[] - List of LinkedIn scopes
- `query`: Record<string, string> - Additional authorization parameters
- `pkce`: boolean - Enable PKCE flow (default: false)

**Default Scopes**: None specified

**Common Scopes**: `profile`, `email`, `openid`

**Notes**: LinkedIn uses standard OAuth 2.0 authorization code flow

**Example Usage**:

```typescript
import { LinkedInAdapter } from "@openauthjs/openauth/provider/linkedin"

export default issuer({
  providers: {
    linkedin: LinkedInAdapter({
      clientID: "YOUR_CLIENT_ID",
      clientSecret: "YOUR_CLIENT_SECRET",
    }),
  },
})
```

---

### JumpCloud

**Type**: OAuth2

**Endpoints**:

- authorization: `https://oauth.id.jumpcloud.com/oauth2/auth`
- token: `https://oauth.id.jumpcloud.com/oauth2/token`

**Required Fields**:

- `clientID`: string - JumpCloud application client ID
- `clientSecret`: string - JumpCloud application client secret

**Optional Fields**:

- `scopes`: string[] - List of JumpCloud scopes
- `query`: Record<string, string> - Additional authorization parameters
- `pkce`: boolean - Enable PKCE flow (default: false)

**Default Scopes**: None specified

**Notes**: JumpCloud is an identity and access management platform

**Example Usage**:

```typescript
import { JumpCloudProvider } from "@openauthjs/openauth/provider/jumpcloud"

export default issuer({
  providers: {
    jumpcloud: JumpCloudProvider({
      clientID: "YOUR_CLIENT_ID",
      clientSecret: "YOUR_CLIENT_SECRET",
    }),
  },
})
```

---

## OIDC Providers

Providers that implement OpenID Connect protocol. Can be used with any OIDC-compliant authorization server.

### Generic OIDC Provider

**Type**: OIDC

**Configuration**:
Uses the OIDC Discovery mechanism to automatically fetch endpoints from `.well-known/openid-configuration`

**Required Fields**:

- `clientID`: string - OIDC application client ID
- `issuer`: string - Base URL of the OIDC authorization server

**Optional Fields**:

- `scopes`: string[] - List of OIDC scopes (default: none)
- `query`: Record<string, string> - Additional authorization parameters

**Default Scopes**: None specified (recommended: `["openid", "profile", "email"]`)

**Auto-Discovered Endpoints**:

- `authorization_endpoint` - From `.well-known/openid-configuration`
- `token_endpoint` - From `.well-known/openid-configuration`
- `jwks_uri` - From `.well-known/openid-configuration`

**Response Flow**:

1. Fetches well-known configuration from `{issuer}/.well-known/openid-configuration`
2. Uses response_mode: form_post (requires POST callback)
3. Validates ID token with JWKS from discovered endpoint
4. Returns decoded JWT claims

**Notes**:

- Callback endpoint must support HTTP POST (form_post response mode)
- ID token is validated with server's public keys
- Nonce is automatically verified
- No client secret required

**Example Usage**:

```typescript
import { OidcProvider } from "@openauthjs/openauth/provider/oidc"

export default issuer({
  providers: {
    oidc: OidcProvider({
      clientID: "YOUR_CLIENT_ID",
      issuer: "https://auth.example.com",
      scopes: ["openid", "profile", "email"],
    }),
  },
})
```

---

### Keycloak

**Type**: OAuth2 (configured as OIDC)

**Endpoints**:

- authorization: `https://{baseUrl}/realms/{realm}/protocol/openid-connect/auth`
- token: `https://{baseUrl}/realms/{realm}/protocol/openid-connect/token`

**Required Fields**:

- `clientID`: string - Keycloak client ID
- `clientSecret`: string - Keycloak client secret
- `baseUrl`: string - Keycloak server base URL (e.g., `https://keycloak.example.com`)
- `realm`: string - Keycloak realm name

**Optional Fields**:

- `scopes`: string[] - List of Keycloak scopes
- `query`: Record<string, string> - Additional authorization parameters
- `pkce`: boolean - Enable PKCE flow (default: false)

**Default Scopes**: None specified

**Common Scopes**: `openid`, `profile`, `email`, `roles`

**Notes**:

- Keycloak is an open-source identity and access management solution
- Realm is a logical namespace/tenant within Keycloak
- OpenID Connect endpoints are available at `/protocol/openid-connect/`

**Example Usage**:

```typescript
import { KeycloakProvider } from "@openauthjs/openauth/provider/keycloak"

export default issuer({
  providers: {
    keycloak: KeycloakProvider({
      baseUrl: "https://your-keycloak-domain.com",
      realm: "your-realm",
      clientID: "YOUR_CLIENT_ID",
      clientSecret: "YOUR_CLIENT_SECRET",
      scopes: ["openid", "profile", "email"],
    }),
  },
})
```

---

### Cognito

**Type**: OAuth2 (AWS Cognito)

**Endpoints**:

- authorization: `https://{domain}.auth.{region}.amazoncognito.com/oauth2/authorize`
- token: `https://{domain}.auth.{region}.amazoncognito.com/oauth2/token`

**Required Fields**:

- `clientID`: string - Cognito application client ID
- `clientSecret`: string - Cognito application client secret
- `domain`: string - Cognito domain name (without the auth suffix)
- `region`: string - AWS region (e.g., `us-east-1`)

**Optional Fields**:

- `scopes`: string[] - List of Cognito scopes
- `query`: Record<string, string> - Additional authorization parameters
- `pkce`: boolean - Enable PKCE flow (default: false)

**Default Scopes**: None specified

**Common Scopes**: `openid`, `profile`, `email`, `aws.cognito.signin.user.admin`

**Notes**:

- Cognito is AWS's managed authentication service
- Domain is configured separately from the full URL (auto-assembled internally)
- Full domain becomes: `https://{domain}.auth.{region}.amazoncognito.com`

**Example Usage**:

```typescript
import { CognitoProvider } from "@openauthjs/openauth/provider/cognito"

export default issuer({
  providers: {
    cognito: CognitoProvider({
      domain: "your-domain",
      region: "us-east-1",
      clientID: "YOUR_CLIENT_ID",
      clientSecret: "YOUR_CLIENT_SECRET",
    }),
  },
})
```

---

## Generic Providers

Pre-configured base providers for custom implementations.

### Generic OAuth2 Provider

**Type**: OAuth2

**Configuration**:
Flexible OAuth 2.0 provider for any OAuth 2.0-compliant service

**Required Fields**:

- `clientID`: string - OAuth application client ID
- `clientSecret`: string - OAuth application client secret
- `endpoint.authorization`: string - Authorization endpoint URL
- `endpoint.token`: string - Token endpoint URL
- `scopes`: string[] - List of scopes to request

**Optional Fields**:

- `endpoint.jwks`: string - JWKS endpoint for ID token validation
- `query`: Record<string, string> - Additional authorization parameters
- `pkce`: boolean - Enable PKCE (Proof Key for Code Exchange)
- `type`: string - Custom provider type identifier

**Token Response**:

- `access_token`: string - Access token for API calls
- `refresh_token`: string - Refresh token (if supported)
- `expires_in`: number - Token expiration in seconds
- `id_token`: string - JWT token (if endpoint.jwks provided)

**Notes**:

- If `endpoint.jwks` is provided, ID tokens are validated
- PKCE is optional (some providers like X require it)
- Access tokens are returned in the success response

**Example Usage**:

```typescript
import { Oauth2Provider } from "@openauthjs/openauth/provider/oauth2"

export default issuer({
  providers: {
    customOAuth: Oauth2Provider({
      clientID: "YOUR_CLIENT_ID",
      clientSecret: "YOUR_CLIENT_SECRET",
      endpoint: {
        authorization: "https://auth.example.com/authorize",
        token: "https://auth.example.com/token",
        jwks: "https://auth.example.com/keys",
      },
      scopes: ["profile", "email"],
      pkce: true,
    }),
  },
})
```

---

## Custom/Passwordless Providers

Custom authentication methods for non-OAuth scenarios.

### Password Provider

**Type**: Custom (Username/Password)

**Configuration**:
Implements traditional email/password authentication with email verification via PIN code

**Required Fields**:

- `login`: (req: Request, form?: FormData, error?: PasswordLoginError) => Promise<Response> - Login screen UI handler
- `register`: (req: Request, state: PasswordRegisterState, form?: FormData, error?: PasswordRegisterError) => Promise<Response> - Registration screen UI handler
- `change`: (req: Request, state: PasswordChangeState, form?: FormData, error?: PasswordChangeError) => Promise<Response> - Password change screen UI handler
- `sendCode`: (email: string, code: string) => Promise<void> - Callback to send verification code to user

**Optional Fields**:

- `length`: number - PIN code length (default: 6)
- `hasher`: PasswordHasher - Custom password hashing implementation (default: Scrypt)
- `validatePassword`: StandardSchema | ((password: string) => Promise<string | undefined> | string | undefined) - Password validation rules

**Return Value**:
Success response contains:

- `email`: string - User's email address

**Login Errors**:

- `invalid_email` - Email format is invalid
- `invalid_password` - Password is incorrect

**Register Errors**:

- `invalid_email` - Email format is invalid
- `email_taken` - Email already registered
- `invalid_password` - Password doesn't meet requirements
- `password_mismatch` - Passwords don't match
- `invalid_code` - Verification code is incorrect
- `validation_error` - Custom validation failed

**Change Password Errors**:

- `invalid_email` - Email format is invalid
- `invalid_code` - Verification code is incorrect
- `invalid_password` - Password doesn't meet requirements
- `password_mismatch` - Passwords don't match
- `validation_error` - Custom validation failed

**Register Flow States**:

- `start` - User enters email and password
- `code` - User enters PIN code verification

**Change Password Flow States**:

- `start` - User enters email
- `code` - User enters PIN code
- `update` - User enters new password

**Password Hashing**:

- Default: Scrypt (N=16384, r=8, p=1)
- Alternative: PBKDF2 (600,000 iterations)

**Notes**:

- Uses PIN code verification sent via email
- Password hashing uses Scrypt by default
- State is stored server-side (10 minutes for verification flow, 24 hours for password change)
- PIN codes are 6 digits by default, timing-safe compared

**Example Usage**:

```typescript
import { PasswordUI } from "@openauthjs/openauth/ui/password"
import { PasswordProvider } from "@openauthjs/openauth/provider/password"

export default issuer({
  providers: {
    password: PasswordProvider(
      PasswordUI({
        copy: {
          error_email_taken: "This email is already taken.",
          error_password_mismatch: "Passwords do not match.",
        },
        sendCode: async (email, code) => {
          // Send PIN code via email
          await sendEmail(email, `Your verification code is: ${code}`)
        },
        validatePassword: (password) => {
          return password.length < 8
            ? "Password must be at least 8 characters"
            : undefined
        },
      }),
    ),
  },
})
```

---

### Code Provider (PIN Code / Passwordless)

**Type**: Custom (PIN Code Authentication)

**Configuration**:
Implements passwordless authentication using PIN codes sent to user-specified claims (email, phone, etc.)

**Required Fields**:

- `request`: (req: Request, state: CodeProviderState, form?: FormData, error?: CodeProviderError) => Promise<Response> - UI handler for code flow
- `sendCode`: (claims: Claims, code: string) => Promise<void | CodeProviderError> - Callback to send PIN code to user

**Optional Fields**:

- `length`: number - PIN code length (default: 6)

**Generic Type Parameter**:

- `Claims`: Record<string, string> - Custom claims object (e.g., `{ email: string; phone: string }`)

**Return Value**:
Success response contains:

- `claims`: Claims - User-provided claims data

**Code Errors**:

- `invalid_code` - PIN code doesn't match
- `invalid_claim` - Provided claim (email/phone) is invalid
  - `key`: string - Claim field name
  - `value`: string - Claim value

**Code Flow States**:

- `start` - User enters claim information (email, phone, etc.)
- `code` - User enters received PIN code
  - `code`: string - Generated PIN code
  - `claims`: Record<string, string> - User-provided claims
  - `resend`: boolean - Whether code was resent

**Notes**:

- Supports custom claims (not limited to email)
- PIN codes are generated with cryptographic randomness
- Timing-safe comparison for verification
- State stored server-side (24 hours)
- Callback can return error to indicate sending failed

**Example Usage**:

```typescript
import { CodeUI } from "@openauthjs/openauth/ui/code"
import { CodeProvider } from "@openauthjs/openauth/provider/code"

// Simple email-based PIN
export default issuer({
  providers: {
    code: CodeProvider(
      CodeUI({
        copy: {
          code_info: "We'll send a PIN code to your email",
        },
        sendCode: async (claims, code) => {
          await sendEmail(claims.email, `Your code: ${code}`)
        },
      }),
    ),
  },
})

// Multi-channel with custom claims
interface MyClaims {
  email: string
  phone: string
}

export default issuer({
  providers: {
    code: CodeProvider<MyClaims>({
      length: 4,
      request: (req, state, form, error) => {
        // Custom UI handler
        return myCodeUI.render({ state, form, error })
      },
      sendCode: async (claims, code) => {
        // Send via email or SMS based on available claims
        if (claims.email) {
          await sendEmail(claims.email, `Code: ${code}`)
        } else if (claims.phone) {
          await sendSMS(claims.phone, `Code: ${code}`)
        } else {
          return { type: "invalid_claim", key: "email|phone", value: "" }
        }
      },
    }),
  },
})
```

---

## Configuration Parameters

### Common OAuth2 Parameters

All OAuth2-based providers support the following common configuration:

**Base Configuration Fields**:

| Field                    | Type                   | Required | Description                               |
| ------------------------ | ---------------------- | -------- | ----------------------------------------- |
| `clientID`               | string                 | Yes      | Application client ID from provider       |
| `clientSecret`           | string                 | Yes      | Application client secret (keep secret)   |
| `scopes`                 | string[]               | No       | OAuth scopes to request                   |
| `endpoint.authorization` | string                 | Yes      | Authorization server endpoint             |
| `endpoint.token`         | string                 | Yes      | Token endpoint URL                        |
| `endpoint.jwks`          | string                 | No       | JWKS endpoint for ID token validation     |
| `query`                  | Record<string, string> | No       | Custom query parameters for auth endpoint |
| `pkce`                   | boolean                | No       | Enable PKCE flow (default: false)         |

**Endpoints Object**:

```typescript
endpoint: {
  authorization: string      // POST code exchange
  token: string              // GET code, returns code + state
  jwks?: string              // Optional: JWKS for ID token validation
}
```

**Query Parameters**:
Additional parameters passed to authorization endpoint:

```typescript
query: {
  access_type: "offline",    // Request refresh token
  prompt: "consent",         // Force consent screen
  response_mode: "form_post" // Use POST for callback
}
```

### OIDC-Specific Parameters

| Field      | Type                   | Required | Description                      |
| ---------- | ---------------------- | -------- | -------------------------------- |
| `clientID` | string                 | Yes      | OIDC application client ID       |
| `issuer`   | string                 | Yes      | Base URL of authorization server |
| `scopes`   | string[]               | No       | OIDC scopes (default: none)      |
| `query`    | Record<string, string> | No       | Custom query parameters          |

**OIDC Auto-Discovery**:
Uses `{issuer}/.well-known/openid-configuration` to fetch:

- `authorization_endpoint`
- `token_endpoint`
- `jwks_uri`

---

## Error Handling

### OAuth2 Errors

Errors returned from authorization endpoint:

```typescript
interface OAuthError {
  error: string // Error code
  error_description?: string // Human-readable description
  error_uri?: string // Link to error documentation
  state?: string // State parameter for CSRF protection
}
```

**Common Error Codes**:

- `invalid_request` - Request is malformed
- `unauthorized_client` - Client not authorized
- `access_denied` - User denied access
- `unsupported_response_type` - Response type not supported
- `invalid_scope` - Requested scope is invalid
- `server_error` - Server encountered error
- `temporarily_unavailable` - Service unavailable

### Provider-Specific Implementation Details

**State Management**:

- State tokens generated as random UUIDs
- Stored server-side with 10-minute expiration for OAuth flows
- Validated on callback for CSRF protection

**PKCE Implementation**:

- Challenge generated using SHA-256
- Code verifier stored server-side
- Method: `S256` (SHA-256 hashing)

**ID Token Validation** (when JWKS provided):

- Signature verified against JWKS
- Audience claim must match clientID
- Nonce verified (for OIDC)

**Token Response Handling**:

```typescript
interface TokenResponse {
  access_token: string
  token_type: string // Usually "Bearer"
  expires_in?: number // Seconds until expiration
  refresh_token?: string
  id_token?: string // JWT if JWKS endpoint provided
  scope?: string
  [key: string]: any // Raw response accessible
}
```

---

## Provider Configuration Summary Table

| Provider       | Type   | Requires Secret | PKCE Support   | Endpoints Discovery | OAuth2 | OIDC |
| -------------- | ------ | --------------- | -------------- | ------------------- | ------ | ---- |
| Google         | OAuth2 | Yes             | Yes            | Manual              | Yes    | Yes  |
| GitHub         | OAuth2 | Yes             | Yes            | Manual              | Yes    | No   |
| Microsoft      | OAuth2 | Yes             | Yes            | Manual              | Yes    | Yes  |
| Apple          | OAuth2 | Yes             | Yes            | Manual              | Yes    | Yes  |
| Facebook       | OAuth2 | Yes             | Yes            | Manual              | Yes    | Yes  |
| Discord        | OAuth2 | Yes             | Yes            | Manual              | Yes    | No   |
| Slack          | OAuth2 | Yes             | Yes            | Manual              | Yes    | Yes  |
| Spotify        | OAuth2 | Yes             | Yes            | Manual              | Yes    | No   |
| Twitch         | OAuth2 | Yes             | Yes            | Manual              | Yes    | No   |
| X (Twitter)    | OAuth2 | Yes             | Yes (required) | Manual              | Yes    | No   |
| Yahoo          | OAuth2 | Yes             | Yes            | Manual              | Yes    | No   |
| LinkedIn       | OAuth2 | Yes             | Yes            | Manual              | Yes    | No   |
| JumpCloud      | OAuth2 | Yes             | Yes            | Manual              | Yes    | No   |
| Keycloak       | OAuth2 | Yes             | Yes            | Manual              | Yes    | Yes  |
| Cognito        | OAuth2 | Yes             | Yes            | Manual              | Yes    | Yes  |
| Generic OAuth2 | OAuth2 | Yes             | Yes            | Manual              | Yes    | No   |
| Generic OIDC   | OIDC   | No              | No             | Automatic           | No     | Yes  |
| Password       | Custom | No              | N/A            | N/A                 | No     | No   |
| Code/PIN       | Custom | No              | N/A            | N/A                 | No     | No   |

---

## Implementation Notes for Dynamic Schema Generation

### For Admin UI Form Generation

**Grouped by Type**:

1. **OAuth2 Providers** - Require clientID, clientSecret, custom scopes
2. **OIDC Providers** - Require clientID, issuer/discovery
3. **Generic Providers** - Require endpoints, clientID, clientSecret, scopes
4. **Custom** - Special handlers for UI/callbacks

**Form Validation**:

- clientID: Non-empty string
- clientSecret: Non-empty string (hidden input)
- endpoints: Valid URLs
- scopes: Array of strings (provider-specific validation)
- tenant/domain/realm: Non-empty strings where applicable

**Required Fields Checklist**:

```typescript
const providerRequirements = {
  google: ["clientID", "clientSecret"],
  github: ["clientID", "clientSecret"],
  microsoft: ["clientID", "clientSecret", "tenant"],
  apple: ["clientID", "clientSecret"],
  facebook: ["clientID", "clientSecret"],
  discord: ["clientID", "clientSecret"],
  slack: ["clientID", "clientSecret", "team", "scopes"],
  spotify: ["clientID", "clientSecret"],
  twitch: ["clientID", "clientSecret"],
  x: ["clientID", "clientSecret"],
  yahoo: ["clientID", "clientSecret"],
  linkedin: ["clientID", "clientSecret"],
  jumpcloud: ["clientID", "clientSecret"],
  keycloak: ["clientID", "clientSecret", "baseUrl", "realm"],
  cognito: ["clientID", "clientSecret", "domain", "region"],
  oidc: ["clientID", "issuer"],
  password: ["login", "register", "change", "sendCode"],
  code: ["request", "sendCode"],
}
```

---

## Scope Reference by Provider

**Google**: Standard OAuth scopes from Google APIs
**GitHub**: `read:user`, `user:email`, repo scopes, etc.
**Microsoft**: `User.Read`, `Calendars.Read`, etc.
**Apple**: `name`, `email`
**Facebook**: `email`, `public_profile`, `user_friends`
**Discord**: `identify`, `email`, `guilds`, `messages.read`
**Slack**: `openid`, `email`, `profile` (restricted set)
**Spotify**: `user-read-private`, `user-read-email`, `user-modify-playback-state`
**Twitch**: `user:read:email`, `user:read:follows`
**X**: `tweet.read`, `users.read`, `follows.read`
**Yahoo**: `openid`, `profile`, `email`
**LinkedIn**: `profile`, `email`, `openid`
**Keycloak**: `openid`, `profile`, `email`, `roles` (realm-specific)
**Cognito**: `openid`, `profile`, `email`, `aws.cognito.signin.user.admin`

---

## Environment Variable Configuration Pattern

For production deployments, use environment variables:

```typescript
const providerConfig = {
  clientID: process.env.OAUTH_CLIENT_ID,
  clientSecret: process.env.OAUTH_CLIENT_SECRET,
  // Additional fields as needed
}
```

**Environment Variable Naming Convention**:

```
OPENAUTH_{PROVIDER_NAME}_CLIENT_ID
OPENAUTH_{PROVIDER_NAME}_CLIENT_SECRET
OPENAUTH_{PROVIDER_NAME}_{FIELD_NAME}
```

Example:

```
OPENAUTH_GOOGLE_CLIENT_ID=xxx
OPENAUTH_GOOGLE_CLIENT_SECRET=xxx
OPENAUTH_MICROSOFT_TENANT=xxx
OPENAUTH_KEYCLOAK_BASE_URL=xxx
```

---

## Security Considerations

1. **Secrets Storage**: Never commit client secrets to version control
2. **PKCE**: Enable for public clients or sensitive flows
3. **State Verification**: Always validate state parameter (automatic)
4. **HTTPS**: Require HTTPS for all OAuth endpoints
5. **Scope Minimization**: Request only needed scopes
6. **Token Storage**: Store refresh tokens securely server-side
7. **Password Hashing**: Use Scrypt (default) or PBKDF2 for password provider
8. **PIN Codes**: Generated cryptographically, timing-safe comparison

---

**Document Version**: 1.0
**Last Updated**: 2024
**Generated from**: OpenAuth Provider Source Code Analysis
