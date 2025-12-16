# OpenAuth - Copilot Instructions

## Project Overview

OpenAuth is an enterprise-grade OAuth 2.0 / OpenID Connect authentication library built with TypeScript for Cloudflare Workers and edge runtimes. It provides multi-tenant support, RBAC, session management, and dynamic identity providers.

## Tech Stack

- **Runtime**: Cloudflare Workers, Bun, Node.js
- **Language**: TypeScript (strict mode)
- **Framework**: Hono (web framework)
- **Database**: Cloudflare D1 (SQLite)
- **Package Manager**: pnpm
- **Test Runner**: Bun test
- **Formatter**: Prettier

## Repository Structure

```
packages/openauth/
├── src/
│   ├── enterprise/      # Multi-tenant issuer, RBAC, sessions
│   ├── session/         # Session management (D1 adapter, admin service)
│   ├── rbac/            # Role-based access control
│   ├── client/          # OAuth client adapters
│   ├── provider/        # Identity providers (Google, GitHub, etc.)
│   ├── migrations/      # D1 database migrations
│   └── ui/              # Login/consent UI components
├── bin/                 # CLI tools (migrate command)
├── test/                # Test files (*.test.ts)
└── docs/                # Documentation
```

## Build & Test Commands

```bash
# Install dependencies
pnpm install

# Build the package
bun run build

# Run all tests
bun test

# Run specific test file
bun test test/migration-utils.test.ts

# Format code (required before commit)
npx prettier --write src test bin
```

## Code Style Guidelines

- Use TypeScript strict mode
- Prefer `async/await` over callbacks
- Use Hono's Context for request handling
- All public APIs should have JSDoc comments
- HTML in templates must use `escapeHtml()` for user input
- SQL migrations should be idempotent (use IF NOT EXISTS where possible)

## Security Requirements

- Always validate OAuth parameters (client_id, redirect_uri, response_type)
- Escape all user-controlled values in HTML output
- Use parameterized queries for database operations
- Never expose internal errors to clients
- Validate redirect URIs against registered clients

## Testing Conventions

- Test files use `*.test.ts` suffix
- Use Bun's test runner with `describe`, `test`, `expect`
- Mock external services in tests
- Test both success and error paths

## Migration System

Migrations are in `src/migrations/` with numeric prefixes (001*, 002*, etc.).
The CLI (`bin/cli.ts`) handles:

- Schema change detection (ADD COLUMN, CREATE TABLE, etc.)
- Idempotent execution (checks if changes already applied)
- Migration tracking in `_openauth_migrations` table

## PR Requirements

- All tests must pass
- Code must be formatted with Prettier
- Security-sensitive changes need review
- Update documentation for new features
