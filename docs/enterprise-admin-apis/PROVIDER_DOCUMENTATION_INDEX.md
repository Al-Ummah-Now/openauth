# OpenAuth Provider Documentation Index

Complete documentation set for OpenAuth provider configuration, including references, quick guides, TypeScript types, and schema definitions.

## Documents Included

### 1. **PROVIDER_CONFIGURATION_REFERENCE.md** (Primary Reference)

Comprehensive documentation for all 18 providers covering:

- Google, GitHub, Microsoft, Apple, Facebook, Discord, Slack, Spotify, Twitch, X, Yahoo, LinkedIn, JumpCloud
- Keycloak, Cognito (Enterprise)
- Generic OAuth2 and OIDC providers
- Password and Code (PIN) custom providers

**For each provider:**

- Provider type and variants (OAuth2 | OIDC | Custom)
- Complete endpoint URLs (authorization, token, jwks)
- Required and optional configuration fields
- Default scopes and common scope patterns
- Special requirements and notes
- Complete working examples

**Special sections:**

- Common OAuth2 parameters reference
- OIDC-specific configuration
- Error handling and codes
- Scope reference by provider
- Security considerations
- Provider comparison summary table

**Use this for:** In-depth provider information, admin UI documentation, API docs

---

### 2. **PROVIDER_QUICK_REFERENCE.md** (Developer Quick Start)

Minimal configuration examples for immediate implementation:

- Single-line configuration for each provider
- Copy-paste examples for all 18 providers
- Common scope patterns
- Error code reference
- Troubleshooting checklist
- Environment variable patterns
- Complete configuration template

**Use this for:** Quick setup, copy-paste examples, troubleshooting

---

### 3. **PROVIDER_SCHEMA.json** (Machine-Readable Schema)

Structured JSON schema for programmatic consumption:

- All 18 providers with metadata
- Required and optional fields per provider
- Endpoint information (manual and templated)
- Field type definitions and validation rules
- Common scopes dictionary
- Error codes reference
- Provider capability matrix (OAuth2, OIDC, auto-discovery)
- Validation rules by category

**Use this for:**

- Dynamic form generation (Admin UI)
- Configuration validation
- API schema generation
- Code generation tools
- Testing and validation

---

### 4. **PROVIDER_TYPES.md** (TypeScript Types)

Complete TypeScript interface definitions:

- Individual provider config interfaces
- Union types for all configurations
- Token response types
- Error types per provider
- State management types
- Callback handler types
- Success response types
- Type-safe examples with `satisfies` keyword

**For each provider type:**

- Config interface with field types
- Success response interface
- Error union types
- State management interfaces
- Handler callback signatures

**Use this for:** TypeScript development, IDE autocomplete, type safety

---

### 5. **PROVIDER_DOCUMENTATION_INDEX.md** (This File)

Navigation guide for the complete documentation set with usage recommendations.

---

## Quick Navigation by Use Case

### I need to add a new provider to my app

1. Open **PROVIDER_QUICK_REFERENCE.md**
2. Find your provider in the list
3. Copy the configuration example
4. Set your environment variables

### I'm building an Admin UI for dynamic provider configuration

1. Use **PROVIDER_SCHEMA.json** as your source of truth
2. Parse required/optional fields per provider
3. Implement field validation using `validation` rules
4. Map field types to UI components

### I need complete configuration details for documentation

1. Start with **PROVIDER_CONFIGURATION_REFERENCE.md**
2. Each provider has detailed sections with:
   - Endpoint URLs
   - Field descriptions
   - Scope information
   - Special requirements
   - Working examples

### I'm developing with TypeScript

1. Reference **PROVIDER_TYPES.md** for interfaces
2. Use interfaces for type checking
3. Use `satisfies` keyword for compile-time validation
4. Check callback handler signatures for custom providers

### I'm troubleshooting a configuration issue

1. Check **PROVIDER_QUICK_REFERENCE.md** troubleshooting section
2. Verify fields against **PROVIDER_CONFIGURATION_REFERENCE.md**
3. Check **PROVIDER_SCHEMA.json** validation rules
4. Use **PROVIDER_TYPES.md** to verify TypeScript types

---

## Provider Categories

### OAuth2 Providers (16)

Require: `clientID`, `clientSecret`

**Public Platforms:**

- Google (also OIDC)
- GitHub
- Apple (also OIDC)
- Facebook (also OIDC)
- Discord
- Slack (also OIDC)
- Spotify
- Twitch
- X (Twitter)
- Yahoo
- LinkedIn

**Enterprise:**

- Microsoft (also OIDC)
- JumpCloud
- Keycloak
- Cognito

**Generic:**

- Custom OAuth2

### OIDC Providers (6)

Require: `clientID`, `issuer`

**Pre-configured:**

- Google
- Microsoft
- Apple
- Facebook
- Slack (variants)

**Generic:**

- Custom OIDC

### Custom Providers (2)

No credentials required (use callbacks instead)

- **Password**: Email/password with PIN verification
- **Code**: Passwordless PIN code authentication

---

## Field Reference by Provider

### Most Common Required Fields

```
All OAuth2:
  - clientID
  - clientSecret

All OIDC:
  - clientID
  - issuer (no secret needed)

Special additions:
  - Microsoft: + tenant
  - Slack: + team, scopes (required, not optional)
  - Keycloak: + baseUrl, realm
  - Cognito: + domain, region
  - Apple: requires secret (unlike some OAuth2)
```

### Optional Common Fields

```
All OAuth2/OIDC:
  - scopes (array)
  - query (object)
  - pkce (boolean)

Special:
  - Apple: responseMode ("query" | "form_post")
```

---

## Scope Reference

**Standard OIDC Scopes:**

- `openid` - OpenID Connect authentication
- `profile` - User profile information
- `email` - User email address

**Provider-Specific:**

- GitHub: `read:user`, `user:email`, `repo`
- Microsoft: `User.Read`, `Calendars.Read`
- Slack: Limited to `openid`, `email`, `profile`
- Spotify: `user-read-private`, `user-read-email`
- X: `tweet.read`, `users.read`, `follows.read`

See PROVIDER_CONFIGURATION_REFERENCE.md for complete scope lists per provider.

---

## Endpoint Patterns

### Static Endpoints

Most providers have fixed endpoint URLs (Google, GitHub, Apple, etc.)

### Template Endpoints

Some use variables:

- **Microsoft**: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/...`
- **Keycloak**: `{baseUrl}/realms/{realm}/protocol/openid-connect/...`
- **Cognito**: `https://{domain}.auth.{region}.amazoncognito.com/...`

### Auto-Discovery (OIDC only)

Generic OIDC uses: `{issuer}/.well-known/openid-configuration`

---

## Security Best Practices

1. **Environment Variables**: Never hardcode secrets
2. **HTTPS**: Always use HTTPS for redirect URIs
3. **PKCE**: Enable for sensitive flows
4. **Scopes**: Request minimum necessary scopes
5. **Token Storage**: Store refresh tokens securely server-side
6. **Password Hashing**: Use Scrypt (default) or PBKDF2
7. **State Validation**: Automatic (validates CSRF)

---

## API Documentation Structure

For public API documentation, recommend this structure:

```
1. Provider Overview
   - Type (OAuth2 | OIDC | Custom)
   - Supported variants

2. Configuration Section
   - Required fields table
   - Optional fields table
   - Endpoint URLs

3. Scopes
   - Default scopes
   - Common scopes
   - Link to provider's scope documentation

4. Examples
   - Minimal configuration
   - Full configuration with scopes
   - Error handling

5. Special Requirements
   - Any provider-specific needs
   - Known limitations

6. Troubleshooting
   - Common errors
   - How to get credentials
   - Testing checklist
```

---

## Admin UI Implementation Checklist

- [ ] Load PROVIDER_SCHEMA.json on initialization
- [ ] For each provider, determine required fields
- [ ] For OAuth2 providers, add clientID + clientSecret inputs
- [ ] For OIDC providers, add clientID + issuer inputs
- [ ] For special providers (Microsoft, Keycloak, Cognito), add special fields
- [ ] Add scopes multi-select (optional, show common scopes)
- [ ] Add optional advanced fields (query params, PKCE toggle)
- [ ] Implement field validation per PROVIDER_SCHEMA.json
- [ ] Show endpoint URLs (read-only, for reference)
- [ ] For custom providers, show callback/handler requirements
- [ ] Test with all provider types before release

---

## Code Generation Examples

Using PROVIDER_SCHEMA.json:

### Generate TypeScript interfaces

```typescript
const providers = schema.providers
Object.entries(providers).forEach(([key, provider]) => {
  console.log(`interface ${capitalize(key)}Config {`)
  provider.requiredFields.forEach((field) => {
    console.log(`  ${field}: string`)
  })
  console.log(`}`)
})
```

### Generate form fields

```typescript
provider.requiredFields.forEach((field) => {
  const fieldDef = schema.fieldTypes[field]
  createFormField({
    name: field,
    type: fieldDef.type,
    required: true,
    sensitive: fieldDef.sensitive,
    validation: fieldDef.validation,
  })
})
```

### Generate validation rules

```typescript
const validationRules = {
  [provider.type]: {
    required: provider.requiredFields,
    types: provider.requiredFields.reduce(
      (acc, field) => ({
        ...acc,
        [field]: schema.fieldTypes[field].type,
      }),
      {},
    ),
  },
}
```

---

## Version History

**v1.0 (2024)**

- Initial comprehensive documentation
- 18 providers documented
- JSON schema with machine-readable format
- TypeScript type definitions
- Quick reference guide
- Configuration reference with examples

---

## How These Documents Were Generated

All documents extracted from OpenAuth provider source code:

- `/packages/openauth/src/provider/google.ts`
- `/packages/openauth/src/provider/github.ts`
- ... (all 18 provider implementations)
- `/packages/openauth/src/provider/oauth2.ts` (base OAuth2)
- `/packages/openauth/src/provider/oidc.ts` (base OIDC)
- `/packages/openauth/src/provider/password.ts` (custom)
- `/packages/openauth/src/provider/code.ts` (custom)

Source of truth: Latest implementation files in OpenAuth repository.

---

## Document Usage Rights

These reference documents are generated from OpenAuth source code and should be:

- ✓ Included in API documentation
- ✓ Used in admin UI implementations
- ✓ Shared with developers
- ✓ Embedded in code generation tools
- ✓ Updated as providers change

Maintain consistency with source implementation files.

---

## Support Resources

- **Full Implementation Guide**: See PROVIDER_CONFIGURATION_REFERENCE.md
- **Quick Start**: See PROVIDER_QUICK_REFERENCE.md
- **Schema Reference**: See PROVIDER_SCHEMA.json
- **TypeScript Types**: See PROVIDER_TYPES.md
- **Source Code**: `/packages/openauth/src/provider/*.ts`

---

**Last Updated**: December 2024
**Documentation Version**: 1.0
**Providers Documented**: 18 (16 OAuth2 + 2 Custom, with OIDC variants)
