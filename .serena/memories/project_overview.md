# OpenAuth Project Overview

## Purpose
OpenAuth is an open-source authentication library that provides OAuth 2.0/OIDC-compliant identity services. It supports multiple identity providers, multi-tenant architecture, and enterprise features including RBAC, session management, and audit logging.

## Tech Stack
- **Runtime**: Bun (Node.js compatible)
- **Language**: TypeScript
- **Web Framework**: Hono (lightweight web framework)
- **Validation**: Valibot (schema validation)
- **OAuth Libraries**: Arctic (OAuth provider integrations)
- **JWT**: Jose library
- **Storage**: Supports DynamoDB, Cloudflare D1/KV, in-memory

## Project Structure
```
packages/openauth/
  src/
    provider/        # Identity provider implementations (Google, GitHub, OIDC, Password, etc.)
    enterprise/      # Multi-tenant issuer and enterprise features
    tenant/          # Tenant management (storage, resolver, API, themes)
    session/         # Browser session management
    rbac/            # Role-based access control
    storage/         # Storage adapters (DynamoDB, Cloudflare, Memory)
    services/        # Audit logging services
    security/        # SQL validation, security utilities
    issuer.ts        # Core OAuth issuer implementation
    client.ts        # OAuth client library
```

## Key Components
1. **Providers**: Factory functions returning `Provider` interface with `init()` method
2. **Issuer**: Main Hono app handling OAuth flows (/authorize, /token, etc.)
3. **Enterprise Issuer**: Multi-tenant wrapper with sessions, RBAC, tenant resolution
4. **Storage**: Key-value storage abstraction for tokens, sessions, etc.
