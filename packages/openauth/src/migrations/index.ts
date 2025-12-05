/**
 * Database Migrations for OpenAuth Enterprise Features
 *
 * Run migrations using the CLI:
 *
 * ```bash
 * npx openauth migrate
 * ```
 *
 * Or specify the database name explicitly:
 *
 * ```bash
 * npx openauth migrate my-auth-db
 * ```
 *
 * Add to your build script for automatic migrations:
 *
 * ```json
 * {
 *   "scripts": {
 *     "build": "openauth migrate && tsc"
 *   }
 * }
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
 * @packageDocumentation
 */

// This module is documentation-only.
// Migrations are run via the CLI: npx openauth migrate
