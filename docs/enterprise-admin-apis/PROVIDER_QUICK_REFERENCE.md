# OpenAuth Provider Configuration Quick Reference

Minimal configuration examples for each provider.

## OAuth2 Providers (Require: clientID, clientSecret)

### Google

```typescript
GoogleProvider({
  clientID: "YOUR_CLIENT_ID",
  clientSecret: "YOUR_CLIENT_SECRET",
})
```

### GitHub

```typescript
GithubProvider({
  clientID: "YOUR_CLIENT_ID",
  clientSecret: "YOUR_CLIENT_SECRET",
})
```

### Microsoft

```typescript
MicrosoftProvider({
  tenant: "YOUR_TENANT_ID",
  clientID: "YOUR_CLIENT_ID",
  clientSecret: "YOUR_CLIENT_SECRET",
})
```

### Apple

```typescript
AppleProvider({
  clientID: "YOUR_SERVICE_ID",
  clientSecret: "YOUR_CLIENT_SECRET",
})
```

### Facebook

```typescript
FacebookProvider({
  clientID: "YOUR_APP_ID",
  clientSecret: "YOUR_APP_SECRET",
})
```

### Discord

```typescript
DiscordProvider({
  clientID: "YOUR_CLIENT_ID",
  clientSecret: "YOUR_CLIENT_SECRET",
})
```

### Slack

```typescript
SlackProvider({
  team: "T1234567890",
  clientID: "YOUR_CLIENT_ID",
  clientSecret: "YOUR_CLIENT_SECRET",
  scopes: ["openid", "email", "profile"],
})
```

### Spotify

```typescript
SpotifyProvider({
  clientID: "YOUR_CLIENT_ID",
  clientSecret: "YOUR_CLIENT_SECRET",
})
```

### Twitch

```typescript
TwitchProvider({
  clientID: "YOUR_CLIENT_ID",
  clientSecret: "YOUR_CLIENT_SECRET",
})
```

### X (Twitter)

```typescript
XProvider({
  clientID: "YOUR_CLIENT_ID",
  clientSecret: "YOUR_CLIENT_SECRET",
})
// Note: PKCE is automatically enabled
```

### Yahoo

```typescript
YahooProvider({
  clientID: "YOUR_CLIENT_ID",
  clientSecret: "YOUR_CLIENT_SECRET",
})
```

### LinkedIn

```typescript
LinkedInAdapter({
  clientID: "YOUR_CLIENT_ID",
  clientSecret: "YOUR_CLIENT_SECRET",
})
```

### JumpCloud

```typescript
JumpCloudProvider({
  clientID: "YOUR_CLIENT_ID",
  clientSecret: "YOUR_CLIENT_SECRET",
})
```

## Enterprise Providers

### Keycloak

```typescript
KeycloakProvider({
  baseUrl: "https://your-keycloak-domain.com",
  realm: "your-realm",
  clientID: "YOUR_CLIENT_ID",
  clientSecret: "YOUR_CLIENT_SECRET",
})
```

### Cognito

```typescript
CognitoProvider({
  domain: "your-domain",
  region: "us-east-1",
  clientID: "YOUR_CLIENT_ID",
  clientSecret: "YOUR_CLIENT_SECRET",
})
```

## OIDC Providers (Require: clientID, issuer)

### Google OIDC

```typescript
GoogleOidcProvider({
  clientID: "YOUR_CLIENT_ID",
})
```

### Microsoft OIDC

```typescript
MicrosoftOidcProvider({
  clientID: "YOUR_CLIENT_ID",
})
```

### Apple OIDC

```typescript
AppleOidcProvider({
  clientID: "YOUR_CLIENT_ID",
})
```

### Facebook OIDC

```typescript
FacebookOidcProvider({
  clientID: "YOUR_CLIENT_ID",
})
```

### Generic OIDC

```typescript
OidcProvider({
  clientID: "YOUR_CLIENT_ID",
  issuer: "https://auth.example.com",
  scopes: ["openid", "profile", "email"],
})
```

## Custom Providers

### Password

```typescript
PasswordProvider(
  PasswordUI({
    copy: {
      error_email_taken: "Email already registered",
    },
    sendCode: async (email, code) => {
      await sendEmail(email, `Code: ${code}`)
    },
  }),
)
```

### Code (PIN)

```typescript
CodeProvider({
  length: 6,
  request: (req, state, form, error) => myUI.render(),
  sendCode: async (claims, code) => {
    await sendEmail(claims.email, `Code: ${code}`)
  },
})
```

---

## Field Reference

### Required by Provider Type

**OAuth2 Providers (All)**

- `clientID`: Application client ID
- `clientSecret`: Application client secret

**Special Requirements**

- Microsoft: `+ tenant`
- Slack: `+ team, scopes`
- Apple: `clientSecret` required (unlike some OAuth2)
- Keycloak: `+ baseUrl, realm`
- Cognito: `+ domain, region`

**OIDC Providers**

- `clientID`: Application client ID
- `issuer`: Authorization server base URL
- No client secret required

### Optional Fields (All OAuth2)

- `scopes`: Array of scope strings
- `query`: Record<string, string> of custom parameters
- `pkce`: boolean (default: false, except X which requires true)

### Special Flags

| Provider | Special Flag | Value       | Purpose                        |
| -------- | ------------ | ----------- | ------------------------------ |
| Apple    | responseMode | "form_post" | Required for email/name scopes |
| X        | pkce         | true        | Automatically enforced         |

---

## Common Scope Patterns

### Email + Profile

```typescript
scopes: ["openid", "profile", "email"]
```

### GitHub User Access

```typescript
scopes: ["read:user", "user:email"]
```

### Microsoft Graph

```typescript
scopes: ["User.Read", "Calendars.Read"]
```

### Spotify User Data

```typescript
scopes: ["user-read-private", "user-read-email"]
```

---

## Error Codes by Provider

All OAuth2 errors follow RFC 6749:

- `invalid_request`
- `unauthorized_client`
- `access_denied` (most common)
- `unsupported_response_type`
- `invalid_scope`
- `server_error`
- `temporarily_unavailable`

---

## Complete Provider Configuration Template

```typescript
import { issuer } from "@openauthjs/openauth"
import {
  GoogleProvider,
  GithubProvider,
  MicrosoftProvider,
  KeycloakProvider,
  CognitoProvider,
  PasswordProvider,
  CodeProvider,
} from "@openauthjs/openauth/provider"

export default issuer({
  providers: {
    // OAuth2
    google: GoogleProvider({
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    github: GithubProvider({
      clientID: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),

    // OIDC
    microsoft: MicrosoftOidcProvider({
      clientID: process.env.MICROSOFT_CLIENT_ID!,
    }),

    // Enterprise
    keycloak: KeycloakProvider({
      baseUrl: process.env.KEYCLOAK_URL!,
      realm: process.env.KEYCLOAK_REALM!,
      clientID: process.env.KEYCLOAK_CLIENT_ID!,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
    }),

    // Passwordless
    code: CodeProvider({
      length: 6,
      sendCode: async (claims, code) => {
        // Send PIN code via email
      },
      request: async (req, state, form, error) => {
        // Render UI
      },
    }),
  },
})
```

---

## Environment Variables Example

```bash
# OAuth2 Providers
OPENAUTH_GOOGLE_CLIENT_ID=xxx
OPENAUTH_GOOGLE_CLIENT_SECRET=xxx

OPENAUTH_GITHUB_CLIENT_ID=xxx
OPENAUTH_GITHUB_CLIENT_SECRET=xxx

# Microsoft (requires tenant)
OPENAUTH_MICROSOFT_TENANT=xxx
OPENAUTH_MICROSOFT_CLIENT_ID=xxx
OPENAUTH_MICROSOFT_CLIENT_SECRET=xxx

# Keycloak (requires baseUrl, realm)
OPENAUTH_KEYCLOAK_BASE_URL=https://keycloak.example.com
OPENAUTH_KEYCLOAK_REALM=master
OPENAUTH_KEYCLOAK_CLIENT_ID=xxx
OPENAUTH_KEYCLOAK_CLIENT_SECRET=xxx

# Cognito (requires domain, region)
OPENAUTH_COGNITO_DOMAIN=your-domain
OPENAUTH_COGNITO_REGION=us-east-1
OPENAUTH_COGNITO_CLIENT_ID=xxx
OPENAUTH_COGNITO_CLIENT_SECRET=xxx
```

---

## Troubleshooting Checklist

- [ ] Client ID and Secret are correct
- [ ] Redirect URI is registered in provider
- [ ] Scopes are valid for provider
- [ ] HTTPS is enforced (if required)
- [ ] Tenant/realm/domain configured (if applicable)
- [ ] PKCE enabled if required (X requires it)
- [ ] responseMode set correctly (Apple needs form_post for email/name)
- [ ] Email/sendCode callback implemented (password/code providers)

---

## Provider Comparison Matrix

| Provider     | OAuth2 | OIDC | Auto-Discovery | PKCE | Requires Secret |
| ------------ | ------ | ---- | -------------- | ---- | --------------- |
| Google       | ✓      | ✓    | -              | ✓    | ✓               |
| GitHub       | ✓      | -    | -              | ✓    | ✓               |
| Microsoft    | ✓      | ✓    | -              | ✓    | ✓               |
| Apple        | ✓      | ✓    | -              | ✓    | ✓               |
| Facebook     | ✓      | ✓    | -              | ✓    | ✓               |
| Discord      | ✓      | -    | -              | ✓    | ✓               |
| Slack        | ✓      | -    | -              | ✓    | ✓               |
| Spotify      | ✓      | -    | -              | ✓    | ✓               |
| Twitch       | ✓      | -    | -              | ✓    | ✓               |
| X            | ✓      | -    | -              | ✓\*  | ✓               |
| Yahoo        | ✓      | -    | -              | ✓    | ✓               |
| LinkedIn     | ✓      | -    | -              | ✓    | ✓               |
| JumpCloud    | ✓      | -    | -              | ✓    | ✓               |
| Keycloak     | ✓      | -    | -              | ✓    | ✓               |
| Cognito      | ✓      | -    | -              | ✓    | ✓               |
| Generic OIDC | -      | ✓    | ✓              | -    | ✗               |

\*X requires PKCE (enforced)

---

## Key Implementation Details

### State Validation

- State token is automatically generated as UUID
- Stored server-side with 10-minute TTL
- Validated on callback (automatic CSRF protection)

### Token Flow

1. User redirected to provider's authorization endpoint
2. User grants permission
3. Provider redirects back with authorization code
4. OpenAuth exchanges code for access token
5. (Optional) ID token validated if JWKS endpoint provided

### PKCE Flow (if enabled)

1. Code challenge generated from code verifier (SHA-256)
2. Challenge sent to authorization endpoint
3. On callback, code verifier used to prove legitimacy
4. Prevents authorization code interception

### Refresh Tokens

If provider returns `refresh_token`:

- Stored in tokenset
- Can be used to get new access tokens without user interaction
- Expiration managed separately from access token

---

## Configuration Schema

**Minimal**

```json
{
  "type": "oauth2|oidc|custom",
  "clientID": "string",
  "clientSecret": "string (if needed)"
}
```

**Full**

```json
{
  "type": "oauth2|oidc|custom",
  "clientID": "string",
  "clientSecret": "string",
  "endpoint": {
    "authorization": "https://...",
    "token": "https://...",
    "jwks": "https://... (optional)"
  },
  "scopes": ["scope1", "scope2"],
  "query": {
    "access_type": "offline",
    "prompt": "consent"
  },
  "pkce": false,
  "special": "provider-specific fields"
}
```

---

**Last Updated**: 2024
**Document Purpose**: Quick reference for provider configuration
