# @al-ummah-now/openauth

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.12] - 2025-12-17

### Added

- add full theme support to account picker UI

## [1.0.11] - 2025-12-17

## [1.0.10] - 2025-12-16

### Added

- add sign-out option to account picker UI

### Fixed

- address Copilot security review comments
- resolve TypeScript boolean | undefined errors in CLI
- address security review comments

### Changed

- improve URL construction readability in account picker

### Documentation

- add GitHub Copilot custom instructions

## [1.0.9] - 2025-12-14

### Documentation

- add session analytics documentation

## [1.0.8] - 2025-12-14

### Added

- add pre-release tags/notes and automatic CHANGELOG generation
- add RBAC security features

### Documentation

- update MDX docs for v1.0.7 features
- add RBAC security features to MDX documentation
- add comprehensive documentation for RBAC security and release workflow
- update CHANGELOG v1.0.7 with all missing features and fixes
- update CHANGELOG with RBAC security features

### Added

- RBAC security features:
  - System role update protection - prevents modifying system roles
  - Self-grant prevention - users cannot assign roles to themselves
  - Privilege escalation prevention - cannot assign system roles you don't have
- New error codes: `cannot_modify_system_role`, `privilege_escalation_denied`, `self_assignment_denied`

## [1.0.7] - 2024-12-13

### Added

- **Enterprise Admin APIs** (Phases 1-6) - comprehensive admin management endpoints
- **Force password reset** functionality for user accounts
- **M2M token verification** - `verifyM2MToken` function for machine-to-machine auth
- **Circuit breaker and retry logic** in ClientD1Adapter for resilience
- **Migration tracking** - proper tracking in CLI to prevent duplicate migrations
- **CLI enhancements**:
  - `--remote` flag for explicit remote D1 database operations
  - `--config` flag for custom wrangler configuration files
- **RBAC seed data** - default clients, roles, and permissions
- GitHub Release creation with auto-generated release notes on publish

### Changed

- Merged RBAC apps into OAuth clients - removed separate `rbac_apps` table
- Permission routes now nested under clients for RESTful design:
  - `POST /clients/:clientId/permissions`
  - `GET /clients/:clientId/permissions`
  - `DELETE /clients/:clientId/permissions/:permissionId`
- Renamed `app_id` to `client_id` throughout RBAC system
- Consolidated oauth_clients schema - fixed id/client_id mismatch
- Consolidated all migrations into single schema file

### Fixed

- Merge roles instead of overwriting in enterprise issuer
- Shell escaping issue in migration CLI
- Migration state tracking to prevent duplicate column errors
- CLI output formatting to match project standards

## [1.0.6] - 2024-12-13

### Fixed

- Run seed data by default during migrate command
- Generate client IDs as UUIDs instead of prefixed random strings
- Use selected account from `account_hint`/`login_hint` for silent auth
- Add `prompt=none` to account picker links for silent auth

## [1.0.5] - 2024-12-12

### Added

- JWKS support to bearerAuth middleware for remote key fetching
- Key caching with configurable TTL for JWKS endpoints

### Fixed

- TypeScript errors in bearerAuth middleware

## [1.0.4] - 2024-12-11

### Added

- CLI tool for database migrations (`npx openauth migrate`)
- Support for custom migration directories
- Seed data execution option

## [1.0.3] - 2024-12-10

### Added

- Enterprise middleware composition (`enterpriseAuth`)
- Client authentication middleware
- Endpoint-specific rate limiting

### Changed

- Improved rate limiting with sliding window algorithm

## [1.0.2] - 2024-12-09

### Added

- User management service with D1 adapter
- User API routes for CRUD operations
- User identity linking support

## [1.0.1] - 2024-12-08

### Added

- Dynamic provider system for runtime IdP configuration
- Provider encryption service for secure secret storage
- TTL cache for provider configurations

## [1.0.0] - 2024-12-07

### Added

- Initial release with enterprise features
- Multi-tenant issuer with configurable tenant resolution
- RBAC system with roles, permissions, and token enrichment
- M2M authentication with scope validation
- OAuth client management with secret hashing
- Rate limiting middleware
- Bearer authentication with JWT validation
- D1 database adapters for all services
- Comprehensive test suite

### Based On

- Forked from [@openauthjs/openauth](https://github.com/openauthjs/openauth) v0.4.3

---

# Upstream Changelog (@openauthjs/openauth)

The following is the changelog from the upstream OpenAuth project.

## 0.4.3

### Patch Changes

- ec8ca65: include expires_in for refresh response

## 0.4.2

### Patch Changes

- a03e510: fix for fetch timeout, wrap everything in lazy

## 0.4.1

### Patch Changes

- 33959c3: better logging on oidc wellknown errors

## 0.4.0

### Minor Changes

- 4e38fa6: feat: Return expires_in from /token endpoint
- fcaafcf: Return signing alg from jwks.json endpoint

### Patch Changes

- 9e3c2ac: Call password validation callback on password reset
- dc40b02: Fix providers client id case from `clientId` to `clientID`

## 0.3.9

### Patch Changes

- 40f6033: enable logger by default
- 3ce40fd: log dynamo error cause

## 0.3.8

### Patch Changes

- c75005b: retry failed dynamo calls

## 0.3.7

### Patch Changes

- 9036544: Add PKCE option to Oauth2Provider
- 8f214e3: Import only hono type in util.ts
- 4cd9e96: add provider logos for apple, x, facebook, microsoft and slack
- 3e3c9e6: Add password validation callback
- f46946c: Add use: sig to jwks.
- 7d39e76: Add way to modify the dynamo ttl attribute name
- 754d776: Supports forwarded protocol and forwarded port in the relative URL
- 1b5525b: add ability to resend verification code during registration

## 0.3.6

### Patch Changes

- f7bd440: Adding a new default openauth theme

## 0.3.5

### Patch Changes

- b22fb30: fix: enable CORS on well-known routes

## 0.3.4

### Patch Changes

- 34ca2b0: remove catch all route so hono instance can be extended

## 0.3.3

### Patch Changes

- 9712422: fix: add charset meta tag to ui/base.tsx
- 92e7170: Adds support for refresh token reuse interval and reuse detection

## 0.3.2

### Patch Changes

- 03da3e0: fix issue with oidc adapter

## 0.3.1

### Patch Changes

- 8764ed4: support specify custom subject

## 0.3.0

### Minor Changes

- b2af22a: renamed authorizer -> issuer and adapter -> provider

## 0.2.7

### Patch Changes

- 3004802: refactor: export `AuthorizationState` for better reusability
- 2975608: switching signing key algorithm to es256
- c92604b: Adds support for a custom DynamoDB endpoint

## 0.2.6

### Patch Changes

- ca0df5d: ui: support phone mode for code ui
- d8d1580: Add slack adapter
- ce44ed6: fix for password adapter redirect after change password
- 4940bef: fix: add `node:` prefix for built-in modules

## 0.2.5

### Patch Changes

- 8d6a243: fix: eliminate OTP bias and timing attack vulnerability
- 873d1af: support specifying granular ttl for access/refresh token

## 0.2.4

### Patch Changes

- 8b5f490: feat: Add copy customization to Code UI component

## 0.2.3

### Patch Changes

- 80238de: return aud field when verifying token

## 0.2.2

### Patch Changes

- 6da8647: fix copy for code resend

## 0.2.1

### Patch Changes

- 83125f1: Remove predefined scopes from Spotify adapter

## 0.2.0

### Minor Changes

- 8c3f050: BREAKING CHANGE: `client.exchange` and `client.authorize` signatures changed

## 0.1.2

### Patch Changes

- 584728f: Add common ColorScheme
- 41acdc2: ui: missing copy in password.tsx
- 2aa531b: Add GitHub Actions workflow for running tests

## 0.1.1

### Patch Changes

- 04cd031: if only single provider is configured, skip provider selection

## 0.1.0

### Minor Changes

- 3c8cdf8: BREAKING CHANGE: client API no longer throws errors

## 0.0.26

### Patch Changes

- 5dd6aa4: feature: add twitter adapter

## 0.0.25

### Patch Changes

- 7e3fa38: feat(cognito): add CognitoAdapter
- f496e3a: Set input autocomplete attribute in password UI

## 0.0.24

### Patch Changes

- f695881: feature: added apple adapter

## 0.0.23

### Patch Changes

- a585875: remove console.log
- 079c514: feat: add JumpCloud

## 0.0.22

### Patch Changes

- d3391f4: do not import createClient from root

## 0.0.21

### Patch Changes

- acc2c5f: add tests for memory adapter and fixed issues with ttl
- 7630c87: added facebook, discord, and keycloak adapter

## 0.0.20

### Patch Changes

- 1a0ff69: fix for theme not being applied

## 0.0.19

### Patch Changes

- 0864481: allow configuring storage through environment

## 0.0.18

### Patch Changes

- bbf90c5: fix type issues when using ui components

## 0.0.17

### Patch Changes

- f43e320: test
- c10dfdd: test
- 2d81677: test changeset

## 0.0.16

### Patch Changes

- 515635f: rename package

[Unreleased]: https://github.com/Al-Ummah-Now/openauth/compare/v1.0.12...HEAD
[1.0.12]: https://github.com/Al-Ummah-Now/openauth/compare/v1.0.11...v1.0.12
[1.0.11]: https://github.com/Al-Ummah-Now/openauth/compare/v1.0.10...v1.0.11
[1.0.10]: https://github.com/Al-Ummah-Now/openauth/compare/v1.0.9...v1.0.10
[1.0.9]: https://github.com/Al-Ummah-Now/openauth/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/Al-Ummah-Now/openauth/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/Al-Ummah-Now/openauth/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/Al-Ummah-Now/openauth/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/Al-Ummah-Now/openauth/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/Al-Ummah-Now/openauth/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/Al-Ummah-Now/openauth/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/Al-Ummah-Now/openauth/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/Al-Ummah-Now/openauth/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Al-Ummah-Now/openauth/releases/tag/v1.0.0
