/**
 * CLI Utility Functions
 *
 * Pure functions extracted for testability.
 */

import { createHash } from "crypto"

export interface MigrationFile {
  name: string
  path: string
  checksum: string
}

export interface AppliedMigration {
  name: string
  applied_at: number
  checksum: string | null
}

export interface ParsedArgs {
  dbName?: string
  isLocal: boolean
  isRemote: boolean
  isPreview: boolean
  configFile?: string
  withSeed: boolean
  force: boolean
}

export interface WranglerOptions {
  isLocal: boolean
  isRemote: boolean
  isPreview: boolean
  configFile?: string
}

/**
 * Calculate SHA-256 checksum of content
 */
export function calculateChecksum(content: string): string {
  return createHash("sha256").update(content).digest("hex").substring(0, 16)
}

/**
 * Strip JSON comments for JSONC support
 */
export function stripJsonComments(content: string): string {
  content = content.replace(/\/\/.*$/gm, "")
  content = content.replace(/\/\*[\s\S]*?\*\//g, "")
  return content
}

/**
 * Extract database name from parsed JSON config
 */
export function extractDbNameFromJson(config: any): string | null {
  if (Array.isArray(config.d1_databases) && config.d1_databases.length > 0) {
    const db = config.d1_databases[0]
    if (db.database_name) {
      return db.database_name
    }
  }
  return null
}

/**
 * Build wrangler command arguments
 */
export function buildWranglerArgs(
  dbName: string,
  options: WranglerOptions,
): string[] {
  const args = ["d1", "execute", dbName]
  if (options.isLocal) args.push("--local")
  if (options.isPreview) {
    args.push("--remote", "--preview")
  } else if (options.isRemote) {
    args.push("--remote")
  }
  if (options.configFile) args.push("--config", options.configFile)
  return args
}

/**
 * Parse command line arguments
 */
export function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    isLocal: false,
    isRemote: false,
    isPreview: false,
    withSeed: true,
    force: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--local") {
      result.isLocal = true
    } else if (arg === "--remote") {
      result.isRemote = true
    } else if (arg === "--preview") {
      result.isPreview = true
    } else if (arg === "--no-seed") {
      result.withSeed = false
    } else if (arg === "--seed") {
      result.withSeed = true
    } else if (arg === "--force") {
      result.force = true
    } else if (arg === "--config" || arg === "-c") {
      result.configFile = args[++i]
    } else if (!arg.startsWith("-")) {
      result.dbName = arg
    }
  }

  return result
}

/**
 * Parse applied migrations from wrangler JSON output
 */
export function parseAppliedMigrationsOutput(
  output: string,
): AppliedMigration[] {
  const migrations: AppliedMigration[] = []
  try {
    const lines = output.split("\n")
    for (const line of lines) {
      if (line.includes('"name"')) {
        const match = line.match(
          /"name":\s*"([^"]+)".*?"applied_at":\s*(\d+).*?"checksum":\s*(?:"([^"]*)"|\d+|null)/,
        )
        if (match) {
          migrations.push({
            name: match[1],
            applied_at: parseInt(match[2]),
            checksum: match[3] || null,
          })
        }
      }
    }
  } catch {
    // Parse error, return empty
  }
  return migrations
}

/**
 * Build SQL for recording a migration
 */
export function buildRecordMigrationSql(
  migrationName: string,
  checksum: string,
  timestamp: number = Date.now(),
): string {
  return `INSERT INTO _openauth_migrations (name, applied_at, checksum) VALUES ('${migrationName}', ${timestamp}, '${checksum}')`
}

/**
 * Build SQL for verifying a migration was recorded
 */
export function buildVerifyMigrationSql(migrationName: string): string {
  return `SELECT name FROM _openauth_migrations WHERE name = '${migrationName}'`
}

/**
 * Check if wrangler output indicates the migration record exists
 */
export function migrationRecordExistsInOutput(
  output: string,
  migrationName: string,
): boolean {
  return output.includes(migrationName)
}
