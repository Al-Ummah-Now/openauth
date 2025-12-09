#!/usr/bin/env node
/**
 * OpenAuth CLI
 *
 * Provides commands for managing OpenAuth in your project.
 *
 * Usage:
 *   npx openauth migrate [database-name] [--local] [--config <file>]
 *
 * If database-name is not provided, reads from wrangler config.
 * Supports: wrangler.toml, wrangler.json, wrangler.jsonc
 * Use --config to specify a custom config file (e.g., wrangler.qa.json)
 */
import { execSync, spawnSync } from "child_process"
import { readFileSync, readdirSync, existsSync } from "fs"
import { createHash } from "crypto"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
// Migrations are in src/migrations relative to package root
const migrationsDir = join(__dirname, "..", "src", "migrations")
// Migration tracking table name
const MIGRATIONS_TABLE = "_openauth_migrations"
/**
 * Strip JSON comments (single-line and multi-line) for JSONC support
 */
function stripJsonComments(content) {
  // Remove single-line comments
  content = content.replace(/\/\/.*$/gm, "")
  // Remove multi-line comments
  content = content.replace(/\/\*[\s\S]*?\*\//g, "")
  return content
}
/**
 * Parse a specific config file to get database name
 */
function parseConfigFile(configPath) {
  if (!existsSync(configPath)) {
    return null
  }
  const content = readFileSync(configPath, "utf-8")
  // Determine file type by extension
  if (configPath.endsWith(".toml")) {
    const match = content.match(/database_name\s*=\s*"([^"]+)"/)
    if (match) {
      return { databaseName: match[1], configFile: configPath }
    }
  } else if (configPath.endsWith(".jsonc")) {
    try {
      const stripped = stripJsonComments(content)
      const config = JSON.parse(stripped)
      const dbName = extractDbNameFromJson(config)
      if (dbName) {
        return { databaseName: dbName, configFile: configPath }
      }
    } catch {
      // Invalid JSONC
    }
  } else if (configPath.endsWith(".json")) {
    try {
      const config = JSON.parse(content)
      const dbName = extractDbNameFromJson(config)
      if (dbName) {
        return { databaseName: dbName, configFile: configPath }
      }
    } catch {
      // Invalid JSON
    }
  }
  return null
}
/**
 * Parse wrangler config to get database name
 * Supports: wrangler.toml, wrangler.json, wrangler.jsonc
 */
function parseWranglerConfig(customConfig) {
  // If custom config specified, use only that
  if (customConfig) {
    return parseConfigFile(customConfig)
  }
  const cwd = process.cwd()
  // Try wrangler.toml first
  const tomlResult = parseConfigFile(join(cwd, "wrangler.toml"))
  if (tomlResult) return tomlResult
  // Try wrangler.json
  const jsonResult = parseConfigFile(join(cwd, "wrangler.json"))
  if (jsonResult) return jsonResult
  // Try wrangler.jsonc
  const jsoncResult = parseConfigFile(join(cwd, "wrangler.jsonc"))
  if (jsoncResult) return jsoncResult
  return null
}
/**
 * Extract database name from parsed JSON config
 */
function extractDbNameFromJson(config) {
  // Check d1_databases array
  if (Array.isArray(config.d1_databases) && config.d1_databases.length > 0) {
    const db = config.d1_databases[0]
    if (db.database_name) {
      return db.database_name
    }
  }
  return null
}
/**
 * Calculate checksum of file content
 */
function calculateChecksum(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}
/**
 * Build wrangler command arguments
 */
function buildWranglerArgs(dbName, options) {
  const args = ["d1", "execute", dbName]
  if (options.isLocal) args.push("--local")
  if (options.isRemote) args.push("--remote")
  if (options.configFile) args.push("--config", options.configFile)
  return args
}
/**
 * Execute a SQL command and return the output
 */
function executeSqlCommand(dbName, sql, options) {
  const args = buildWranglerArgs(dbName, options)
  args.push("--command", sql)
  // Don't use shell: true to avoid escaping issues with SQL quotes
  const result = spawnSync("wrangler", args, {
    encoding: "utf-8",
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  })
  return {
    success: result.status === 0,
    output: result.stdout || result.stderr || "",
  }
}
/**
 * Execute a SQL file
 */
function executeSqlFile(dbName, filePath, options) {
  // Check if file exists first
  if (!existsSync(filePath)) {
    return { success: false, error: `Migration file not found: ${filePath}` }
  }
  const args = buildWranglerArgs(dbName, options)
  args.push("--file", filePath)
  const result = spawnSync("wrangler", args, {
    encoding: "utf-8",
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  })
  if (result.status !== 0) {
    const errorOutput = result.stderr || result.stdout || ""
    return { success: false, error: errorOutput }
  }
  return { success: result.status === 0 }
}
/**
 * Get list of already applied migrations from database
 */
function getAppliedMigrations(dbName, options) {
  const sql = `SELECT name FROM ${MIGRATIONS_TABLE}`
  const result = executeSqlCommand(dbName, sql, options)
  if (!result.success) {
    // Table might not exist yet, return empty set
    return new Set()
  }
  // Parse output - wrangler returns JSON results
  const applied = new Set()
  try {
    // Try to extract migration names from output
    const matches = result.output.match(/"name":\s*"([^"]+)"/g)
    if (matches) {
      for (const match of matches) {
        const name = match.match(/"name":\s*"([^"]+)"/)?.[1]
        if (name) applied.add(name)
      }
    }
  } catch {
    // Ignore parse errors
  }
  return applied
}
/**
 * Record a migration as applied
 */
function recordMigration(dbName, migrationName, checksum, options) {
  const now = Date.now()
  const sql = `INSERT OR REPLACE INTO ${MIGRATIONS_TABLE} (name, applied_at, checksum) VALUES ('${migrationName}', ${now}, '${checksum}')`
  const result = executeSqlCommand(dbName, sql, options)
  return result.success
}
function printHelp() {
  console.log(`
OpenAuth CLI

Usage:
  openauth migrate [database-name] [options]    Apply database migrations
  openauth help                                 Show this help message

Options:
  --local              Apply to local D1 database (for development)
  --remote             Apply to remote D1 database (production)
  --config, -c <file>  Use a specific wrangler config file
  --mark-applied       Mark all migrations as applied without running them
                       (useful for existing databases that were migrated before tracking)

Examples:
  openauth migrate                       # Auto-detect from wrangler config
  openauth migrate --local               # Local database
  openauth migrate --remote              # Remote database (production)
  openauth migrate my-auth-db --remote   # Specify database, remote
  openauth migrate -c wrangler.qa.json --remote
  openauth migrate --mark-applied        # Mark existing migrations as applied

The migrate command executes OpenAuth SQL migrations against your D1 database.
It tracks applied migrations to prevent duplicate execution.
`)
}
function migrate(args) {
  // Parse args for database name, --local/--remote flags, and --config option
  let dbName
  let isLocal = false
  let isRemote = false
  let markApplied = false
  let configFile
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--local") {
      isLocal = true
    } else if (arg === "--remote") {
      isRemote = true
    } else if (arg === "--mark-applied") {
      markApplied = true
    } else if (arg === "--config" || arg === "-c") {
      configFile = args[++i]
      if (!configFile) {
        console.error("Error: --config requires a file path")
        process.exit(1)
      }
    } else if (!arg.startsWith("-")) {
      dbName = arg
    }
  }
  // Validate mutually exclusive flags
  if (isLocal && isRemote) {
    console.error("Error: Cannot specify both --local and --remote")
    process.exit(1)
  }
  // Try to get database name from wrangler config if not provided
  if (!dbName) {
    const config = parseWranglerConfig(configFile)
    if (config) {
      dbName = config.databaseName
      console.log(`Found database in ${config.configFile}: ${dbName}`)
    } else {
      if (configFile) {
        console.error(`Error: Could not read database from ${configFile}`)
      } else {
        console.error(
          "Error: No database name provided and couldn't find wrangler config",
        )
        console.error("Supported: wrangler.toml, wrangler.json, wrangler.jsonc")
      }
      console.error("Usage: openauth migrate <database-name>")
      process.exit(1)
    }
  }
  // Check if wrangler is available
  try {
    execSync("wrangler --version", { stdio: "ignore" })
  } catch {
    console.error("Error: wrangler CLI not found")
    console.error("Install it with: npm install -g wrangler")
    process.exit(1)
  }
  // Get SQL files sorted by name
  if (!existsSync(migrationsDir)) {
    console.error(`Error: Migrations directory not found: ${migrationsDir}`)
    console.error(
      "This may indicate the openauth package was not installed correctly.",
    )
    process.exit(1)
  }
  const sqlFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
  if (sqlFiles.length === 0) {
    console.error(`Error: No SQL migration files found in ${migrationsDir}`)
    process.exit(1)
  }
  const options = { isLocal, isRemote, configFile }
  // First, ensure the tracking table exists (run 000 migration)
  const trackingMigration = sqlFiles.find((f) => f.startsWith("000_"))
  if (trackingMigration) {
    const trackingPath = join(migrationsDir, trackingMigration)
    console.log(`Ensuring migration tracking table exists...`)
    const trackingResult = executeSqlFile(dbName, trackingPath, options)
    if (!trackingResult.success) {
      console.error("Error: Failed to create migration tracking table")
      if (trackingResult.error) {
        console.error(trackingResult.error)
      }
      process.exit(1)
    }
  }
  // Get already applied migrations
  const appliedMigrations = getAppliedMigrations(dbName, options)
  if (appliedMigrations.size > 0) {
    console.log(`Found ${appliedMigrations.size} previously applied migrations`)
  }
  // Filter out already applied migrations (except 000 which is always safe)
  const pendingMigrations = sqlFiles.filter(
    (f) => !appliedMigrations.has(f) && !f.startsWith("000_"),
  )
  // Handle --mark-applied flag
  if (markApplied) {
    console.log(
      `Marking ${pendingMigrations.length} migration(s) as applied (without executing)...`,
    )
    for (const file of pendingMigrations) {
      const filePath = join(migrationsDir, file)
      const content = readFileSync(filePath, "utf-8")
      const checksum = calculateChecksum(content)
      const recorded = recordMigration(dbName, file, checksum, options)
      if (recorded) {
        console.log(`  Marked ${file} as applied`)
      } else {
        console.warn(`  Warning: Could not mark ${file} as applied`)
      }
    }
    console.log("Done! All migrations marked as applied.")
    return
  }
  if (pendingMigrations.length === 0) {
    console.log("All migrations are already applied. Database is up to date.")
    return
  }
  console.log(
    `Applying ${pendingMigrations.length} new migration(s) to ${dbName}${isLocal ? " (local)" : isRemote ? " (remote)" : ""}...`,
  )
  // Execute each pending SQL file
  let applied = 0
  for (const file of pendingMigrations) {
    const filePath = join(migrationsDir, file)
    const content = readFileSync(filePath, "utf-8")
    const checksum = calculateChecksum(content)
    console.log(`  Applying ${file}...`)
    const result = executeSqlFile(dbName, filePath, options)
    if (!result.success) {
      console.error(`Error applying ${file}`)
      if (result.error) {
        console.error(result.error)
      }
      console.error(
        `${applied} migration(s) were applied before the error occurred.`,
      )
      process.exit(1)
    }
    // Record the migration as applied
    const recorded = recordMigration(dbName, file, checksum, options)
    if (!recorded) {
      console.warn(`  Warning: Could not record ${file} in tracking table`)
    }
    applied++
  }
  console.log(`Successfully applied ${applied} migration(s)!`)
}
// Parse command line arguments
const args = process.argv.slice(2)
const command = args[0]
switch (command) {
  case "migrate":
    migrate(args.slice(1))
    break
  case "help":
  case "--help":
  case "-h":
    printHelp()
    break
  default:
    if (command) {
      console.error(`Unknown command: ${command}`)
    }
    printHelp()
    process.exit(command ? 1 : 0)
}
