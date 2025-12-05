/**
 * Database Migrations for OpenAuth Enterprise Features
 *
 * Provides automatic database setup for OpenAuth enterprise features.
 * Tables are created automatically when using the enterprise issuer.
 *
 * ## Automatic Setup (Recommended)
 *
 * Just pass your D1 database - tables are created automatically:
 *
 * ```typescript
 * import { createMultiTenantIssuer } from "@openauthjs/openauth/enterprise"
 *
 * export default {
 *   fetch: createMultiTenantIssuer({
 *     storage,
 *     clientDb: env.DB,  // Tables auto-created on first request
 *     // ...
 *   }).app.fetch
 * }
 * ```
 *
 * ## CI/CD Usage
 *
 * For production deployments, you may prefer to run migrations explicitly:
 *
 * ```typescript
 * import { ensureMigrations } from "@openauthjs/openauth/migrations"
 *
 * // In a setup script or deployment step
 * await ensureMigrations(env.DB, { verbose: true })
 * ```
 *
 * ## SQL Files
 *
 * The source SQL files are in this directory:
 * - 001_oauth_clients.sql
 * - 002_add_tenant_support.sql
 * - 003_session_management.sql
 * - 004_rbac_schema.sql
 *
 * These are read at build time and embedded into the package.
 *
 * @packageDocumentation
 */

// Re-export everything from the generated file
export {
  MIGRATIONS,
  ensureMigrations,
  ensureMigrationsOnce,
  resetMigrationState,
  getAppliedMigrations,
  type Migration,
} from "./generated.js"
