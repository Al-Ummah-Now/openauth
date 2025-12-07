# OpenAuth Provider TypeScript Interfaces

Complete TypeScript type definitions and interfaces for provider configuration.

## Base Types

### Provider Type

```typescript
type ProviderType =
  | "google"
  | "github"
  | "microsoft"
  | "apple"
  | "facebook"
  | "discord"
  | "slack"
  | "spotify"
  | "twitch"
  | "x"
  | "yahoo"
  | "linkedin"
  | "jumpcloud"
  | "keycloak"
  | "cognito"
  | "oauth2"
  | "oidc"
  | "password"
  | "code"
```

### Provider Base Configuration

```typescript
interface ProviderBase {
  type: string
  clientID: string
}

interface OAuth2ProviderBase extends ProviderBase {
  clientSecret: string
  endpoint: {
    authorization: string
    token: string
    jwks?: string
  }
  scopes: string[]
  pkce?: boolean
  query?: Record<string, string>
}

interface OidcProviderBase extends ProviderBase {
  issuer: string
  scopes?: string[]
  query?: Record<string, string>
}

interface CustomProviderBase extends ProviderBase {
  // Custom provider specific fields
}
```

## OAuth2 Provider Configurations

### Google

```typescript
interface GoogleConfig {
  clientID: string
  clientSecret: string
  scopes?: string[]
  query?: Record<string, string>
  pkce?: boolean
}
```

### GitHub

```typescript
interface GithubConfig {
  clientID: string
  clientSecret: string
  scopes?: string[]
  query?: Record<string, string>
  pkce?: boolean
}
```

### Microsoft

```typescript
interface MicrosoftConfig {
  clientID: string
  clientSecret: string
  tenant: string
  scopes?: string[]
  query?: Record<string, string>
  pkce?: boolean
}
```

### Apple

```typescript
interface AppleConfig {
  clientID: string
  clientSecret: string
  scopes?: string[]
  responseMode?: "query" | "form_post"
  query?: Record<string, string>
  pkce?: boolean
}
```

### Facebook

```typescript
interface FacebookConfig {
  clientID: string
  clientSecret: string
  scopes?: string[]
  query?: Record<string, string>
  pkce?: boolean
}
```

### Discord

```typescript
interface DiscordConfig {
  clientID: string
  clientSecret: string
  scopes?: string[]
  query?: Record<string, string>
  pkce?: boolean
}
```

### Slack

```typescript
interface SlackConfig {
  clientID: string
  clientSecret: string
  team: string
  scopes: ("email" | "profile" | "openid")[]
  query?: Record<string, string>
  pkce?: boolean
}
```

### Spotify

```typescript
interface SpotifyConfig {
  clientID: string
  clientSecret: string
  scopes?: string[]
  query?: Record<string, string>
  pkce?: boolean
}
```

### Twitch

```typescript
interface TwitchConfig {
  clientID: string
  clientSecret: string
  scopes?: string[]
  query?: Record<string, string>
  pkce?: boolean
}
```

### X (Twitter)

```typescript
interface XConfig {
  clientID: string
  clientSecret: string
  scopes?: string[]
  query?: Record<string, string>
  // pkce is automatically enabled and cannot be disabled
}
```

### Yahoo

```typescript
interface YahooConfig {
  clientID: string
  clientSecret: string
  scopes?: string[]
  query?: Record<string, string>
  pkce?: boolean
}
```

### LinkedIn

```typescript
interface LinkedInConfig {
  clientID: string
  clientSecret: string
  scopes?: string[]
  query?: Record<string, string>
  pkce?: boolean
}
```

### JumpCloud

```typescript
interface JumpCloudConfig {
  clientID: string
  clientSecret: string
  scopes?: string[]
  query?: Record<string, string>
  pkce?: boolean
}
```

### Keycloak

```typescript
interface KeycloakConfig {
  clientID: string
  clientSecret: string
  baseUrl: string
  realm: string
  scopes?: string[]
  query?: Record<string, string>
  pkce?: boolean
}
```

### Cognito

```typescript
interface CognitoConfig {
  clientID: string
  clientSecret: string
  domain: string
  region: string
  scopes?: string[]
  query?: Record<string, string>
  pkce?: boolean
}
```

## OIDC Provider Configurations

### Google OIDC

```typescript
interface GoogleOidcConfig {
  clientID: string
  scopes?: string[]
  query?: Record<string, string>
}
```

### Microsoft OIDC

```typescript
interface MicrosoftOidcConfig {
  clientID: string
  scopes?: string[]
  query?: Record<string, string>
}
```

### Apple OIDC

```typescript
interface AppleOidcConfig {
  clientID: string
  scopes?: string[]
  query?: Record<string, string>
}
```

### Facebook OIDC

```typescript
interface FacebookOidcConfig {
  clientID: string
  scopes?: string[]
  query?: Record<string, string>
}
```

### Generic OIDC

```typescript
interface OidcConfig {
  clientID: string
  issuer: string
  scopes?: string[]
  query?: Record<string, string>
}
```

## Generic Providers

### Generic OAuth2

```typescript
interface Oauth2Config {
  clientID: string
  clientSecret: string
  endpoint: {
    authorization: string
    token: string
    jwks?: string
  }
  scopes: string[]
  pkce?: boolean
  query?: Record<string, string>
  type?: string
}
```

## Token Response Types

### OAuth2 Token Response

```typescript
interface Oauth2Token {
  access: string // access_token from provider
  refresh: string // refresh_token from provider
  expiry: number // expires_in in seconds
  id?: Record<string, any> // Decoded ID token (if JWKS provided)
  raw: Record<string, any> // Raw token response
}
```

### Token Response Data

```typescript
interface TokenResponseData {
  access_token: string
  token_type: string // Usually "Bearer"
  expires_in?: number
  refresh_token?: string
  id_token?: string // JWT token
  scope?: string
  [key: string]: any
}
```

### ID Token Payload

```typescript
interface IdTokenPayload {
  iss: string // Issuer
  sub: string // Subject (user ID)
  aud: string | string[] // Audience (must match clientID)
  exp: number // Expiration time (unix timestamp)
  iat: number // Issued at (unix timestamp)
  nonce?: string // For OIDC, must match request nonce
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
  [key: string]: any
}
```

## Callback/Handler Types

### OAuth2 Success Response

```typescript
interface OAuth2SuccessResponse<Properties> {
  clientID: string
  tokenset: Oauth2Token
}

// Example:
type GoogleSuccess = OAuth2SuccessResponse<{
  tokenset: Oauth2Token
  clientID: string
}>
```

### OIDC Success Response

```typescript
interface OidcSuccessResponse {
  id: JWTPayload // Decoded ID token claims
  clientID: string
}
```

### Password Provider Success Response

```typescript
interface PasswordSuccessResponse {
  email: string
}
```

### Code Provider Success Response

```typescript
interface CodeSuccessResponse<Claims = Record<string, string>> {
  claims: Claims
}
```

## Error Types

### OAuth Error

```typescript
interface OAuthError {
  error: string
  error_description?: string
  error_uri?: string
  state?: string
}
```

### Password Provider Errors

```typescript
type PasswordLoginError =
  | { type: "invalid_password" }
  | { type: "invalid_email" }

type PasswordRegisterError =
  | { type: "invalid_code" }
  | { type: "email_taken" }
  | { type: "invalid_email" }
  | { type: "invalid_password" }
  | { type: "password_mismatch" }
  | { type: "validation_error"; message?: string }

type PasswordChangeError =
  | { type: "invalid_email" }
  | { type: "invalid_code" }
  | { type: "invalid_password" }
  | { type: "password_mismatch" }
  | { type: "validation_error"; message: string }
```

### Code Provider Errors

```typescript
type CodeProviderError =
  | { type: "invalid_code" }
  | { type: "invalid_claim"; key: string; value: string }
```

## State Types

### OAuth2 Provider State

```typescript
interface Oauth2ProviderState {
  state: string // CSRF protection token
  redirect: string // Callback URL
  codeVerifier?: string // For PKCE flow
}
```

### OIDC Provider State

```typescript
interface OidcProviderState {
  state: string // CSRF protection token
  nonce: string // For ID token validation
  redirect: string // Callback URL
}
```

### Password Provider States

```typescript
type PasswordRegisterState =
  | { type: "start" }
  | {
      type: "code"
      code: string
      email: string
      password: string
    }

type PasswordChangeState =
  | { type: "start"; redirect: string }
  | {
      type: "code"
      code: string
      email: string
      redirect: string
    }
  | {
      type: "update"
      redirect: string
      email: string
    }
```

### Code Provider States

```typescript
type CodeProviderState =
  | { type: "start" }
  | {
      type: "code"
      resend?: boolean
      code: string
      claims: Record<string, string>
    }
```

## Custom Provider Callbacks

### Password Provider Callbacks

```typescript
interface PasswordConfig {
  login: (
    req: Request,
    form?: FormData,
    error?: PasswordLoginError,
  ) => Promise<Response>

  register: (
    req: Request,
    state: PasswordRegisterState,
    form?: FormData,
    error?: PasswordRegisterError,
  ) => Promise<Response>

  change: (
    req: Request,
    state: PasswordChangeState,
    form?: FormData,
    error?: PasswordChangeError,
  ) => Promise<Response>

  sendCode: (email: string, code: string) => Promise<void>

  validatePassword?:
    | StandardSchema
    | ((password: string) => Promise<string | undefined> | string | undefined)

  length?: number
  hasher?: PasswordHasher<any>
}
```

### Code Provider Callbacks

```typescript
interface CodeProviderConfig<Claims = Record<string, string>> {
  request: (
    req: Request,
    state: CodeProviderState,
    form?: FormData,
    error?: CodeProviderError,
  ) => Promise<Response>

  sendCode: (claims: Claims, code: string) => Promise<void | CodeProviderError>

  length?: number
}
```

## Provider Factory Types

### Provider Factory Functions

```typescript
// OAuth2 Providers
function GoogleProvider(config: GoogleConfig): Provider<OAuth2SuccessResponse>
function GithubProvider(config: GithubConfig): Provider<OAuth2SuccessResponse>
function MicrosoftProvider(
  config: MicrosoftConfig,
): Provider<OAuth2SuccessResponse>
function AppleProvider(config: AppleConfig): Provider<OAuth2SuccessResponse>
function FacebookProvider(
  config: FacebookConfig,
): Provider<OAuth2SuccessResponse>
function DiscordProvider(config: DiscordConfig): Provider<OAuth2SuccessResponse>
function SlackProvider(config: SlackConfig): Provider<OAuth2SuccessResponse>
function SpotifyProvider(config: SpotifyConfig): Provider<OAuth2SuccessResponse>
function TwitchProvider(config: TwitchConfig): Provider<OAuth2SuccessResponse>
function XProvider(config: XConfig): Provider<OAuth2SuccessResponse>
function YahooProvider(config: YahooConfig): Provider<OAuth2SuccessResponse>
function LinkedInAdapter(
  config: LinkedInConfig,
): Provider<OAuth2SuccessResponse>
function JumpCloudProvider(
  config: JumpCloudConfig,
): Provider<OAuth2SuccessResponse>
function KeycloakProvider(
  config: KeycloakConfig,
): Provider<OAuth2SuccessResponse>
function CognitoProvider(config: CognitoConfig): Provider<OAuth2SuccessResponse>
function Oauth2Provider(config: Oauth2Config): Provider<OAuth2SuccessResponse>

// OIDC Providers
function GoogleOidcProvider(
  config: GoogleOidcConfig,
): Provider<OidcSuccessResponse>
function MicrosoftOidcProvider(
  config: MicrosoftOidcConfig,
): Provider<OidcSuccessResponse>
function AppleOidcProvider(
  config: AppleOidcConfig,
): Provider<OidcSuccessResponse>
function FacebookOidcProvider(
  config: FacebookOidcConfig,
): Provider<OidcSuccessResponse>
function OidcProvider(config: OidcConfig): Provider<OidcSuccessResponse>

// Custom Providers
function PasswordProvider(
  config: PasswordConfig,
): Provider<PasswordSuccessResponse>
function CodeProvider<Claims extends Record<string, string>>(
  config: CodeProviderConfig<Claims>,
): Provider<CodeSuccessResponse<Claims>>
```

## Configuration Union Types

### All Supported Configurations

```typescript
type ProviderConfig =
  | GoogleConfig
  | GithubConfig
  | MicrosoftConfig
  | AppleConfig
  | FacebookConfig
  | DiscordConfig
  | SlackConfig
  | SpotifyConfig
  | TwitchConfig
  | XConfig
  | YahooConfig
  | LinkedInConfig
  | JumpCloudConfig
  | KeycloakConfig
  | CognitoConfig
  | GoogleOidcConfig
  | MicrosoftOidcConfig
  | AppleOidcConfig
  | FacebookOidcConfig
  | OidcConfig
  | Oauth2Config
  | PasswordConfig
  | CodeProviderConfig
```

### Success Response Union Types

```typescript
type ProviderSuccessResponse =
  | OAuth2SuccessResponse
  | OidcSuccessResponse
  | PasswordSuccessResponse
  | CodeSuccessResponse
```

## Utility Types

### Token Set Helper

```typescript
interface TokenSet {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  idToken?: string
  raw: TokenResponseData
}
```

### Provider Metadata

```typescript
interface ProviderMetadata {
  id: string
  name: string
  type: "oauth2" | "oidc" | "custom"
  requiresSecret: boolean
  supportsPkce: boolean
  endpoints?: {
    authorization: string
    token: string
    jwks?: string
  }
  discoveryEndpoint?: string
  commonScopes?: string[]
  specialFields?: string[]
}
```

### Configuration Validation Result

```typescript
interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: string[]
}

interface ValidationError {
  field: string
  message: string
  severity: "error" | "warning"
}
```

## Examples

### Using Types in Configuration

```typescript
import {
  GoogleConfig,
  MicrosoftConfig,
  OidcConfig,
  PasswordConfig,
  CodeProviderConfig,
} from "@openauthjs/openauth/provider"

const googleConfig: GoogleConfig = {
  clientID: "...",
  clientSecret: "...",
  scopes: ["openid", "profile", "email"],
}

const oidcConfig: OidcConfig = {
  clientID: "...",
  issuer: "https://auth.example.com",
  scopes: ["openid", "profile"],
}

const passwordConfig: PasswordConfig = {
  login: async (req, form, error) => {
    return new Response("...")
  },
  register: async (req, state, form, error) => {
    return new Response("...")
  },
  change: async (req, state, form, error) => {
    return new Response("...")
  },
  sendCode: async (email, code) => {
    // Send email
  },
}

const codeConfig: CodeProviderConfig<{ email: string }> = {
  request: async (req, state, form, error) => {
    return new Response("...")
  },
  sendCode: async (claims, code) => {
    // Send code to claims.email
  },
}
```

### Type-Safe Provider Integration

```typescript
import { issuer } from "@openauthjs/openauth"
import {
  GoogleProvider,
  MicrosoftProvider,
  OidcProvider,
  PasswordProvider,
  type GoogleConfig,
  type MicrosoftConfig,
  type OidcConfig,
} from "@openauthjs/openauth/provider"

const config = {
  google: {
    clientID: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  } satisfies GoogleConfig,

  microsoft: {
    clientID: process.env.MICROSOFT_CLIENT_ID!,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
    tenant: process.env.MICROSOFT_TENANT!,
  } satisfies MicrosoftConfig,

  oidc: {
    clientID: process.env.OIDC_CLIENT_ID!,
    issuer: process.env.OIDC_ISSUER!,
  } satisfies OidcConfig,
}

export default issuer({
  providers: {
    google: GoogleProvider(config.google),
    microsoft: MicrosoftProvider(config.microsoft),
    oidc: OidcProvider(config.oidc),
  },
})
```

---

**Document Version**: 1.0
**TypeScript Version**: 4.5+
**Last Updated**: 2024
