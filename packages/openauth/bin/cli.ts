#!/usr/bin/env node
/**
 * OpenAuth CLI
 *
 * Provides commands for managing OpenAuth in your project.
 *
 * Usage:
 *   npx openauth migrate [database-name] [--local] [--remote] [--config <file>]
 *
 * If database-name is not provided, reads from wrangler config.
 * Supports: wrangler.toml, wrangler.json, wrangler.jsonc
 */

import { execSync, spawnSync } from "child_process"
import { createHash } from "crypto"
import { readFileSync, existsSync, readdirSync } from "fs"
import { basename, dirname, join } from "path"
import { fileURLToPath } from "url"
import {
  parseSchemaChanges,
  isAlreadyAppliedError,
  type SchemaChange,
} from "../src/migrations/utils.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Migration directory
const migrationsDir = join(__dirname, "..", "src", "migrations")

interface MigrationFile {
  name: string
  path: string
  checksum: string
}

interface AppliedMigration {
  name: string
  applied_at: number
  checksum: string | null
}

/**
 * Calculate SHA-256 checksum of a file
 */
function calculateChecksum(filePath: string): string {
  const content = readFileSync(filePath, "utf-8")
  return createHash("sha256").update(content).digest("hex").substring(0, 16)
}

/**
 * Get all migration files in order
 */
function getMigrationFiles(): MigrationFile[] {
  if (!existsSync(migrationsDir)) {
    return []
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") && /^\d{3}_/.test(f))
    .sort()

  return files.map((name) => {
    const path = join(migrationsDir, name)
    return {
      name,
      path,
      checksum: calculateChecksum(path),
    }
  })
}

/**
 * Strip JSON comments for JSONC support
 */
function stripJsonComments(content: string): string {
  content = content.replace(/\/\/.*$/gm, "")
  content = content.replace(/\/\*[\s\S]*?\*\//g, "")
  return content
}

/**
 * Parse a specific config file to get database name
 */
function parseConfigFile(configPath: string): {
  databaseName: string
  configFile: string
} | null {
  if (!existsSync(configPath)) {
    return null
  }

  const content = readFileSync(configPath, "utf-8")

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
 */
function parseWranglerConfig(customConfig?: string): {
  databaseName: string
  configFile: string
} | null {
  if (customConfig) {
    return parseConfigFile(customConfig)
  }

  const cwd = process.cwd()

  const tomlResult = parseConfigFile(join(cwd, "wrangler.toml"))
  if (tomlResult) return tomlResult

  const jsonResult = parseConfigFile(join(cwd, "wrangler.json"))
  if (jsonResult) return jsonResult

  const jsoncResult = parseConfigFile(join(cwd, "wrangler.jsonc"))
  if (jsoncResult) return jsoncResult

  return null
}

/**
 * Extract database name from parsed JSON config
 */
function extractDbNameFromJson(config: any): string | null {
  if (Array.isArray(config.d1_databases) && config.d1_databases.length > 0) {
    const db = config.d1_databases[0]
    if (db.database_name) {
      return db.database_name
    }
  }
  return null
}

interface WranglerOptions {
  isLocal: boolean
  isRemote: boolean
  configFile?: string
}

/**
 * Build wrangler command arguments
 */
function buildWranglerArgs(dbName: string, options: WranglerOptions): string[] {
  const args = ["d1", "execute", dbName]
  if (options.isLocal) args.push("--local")
  if (options.isRemote) args.push("--remote")
  if (options.configFile) args.push("--config", options.configFile)
  return args
}

/**
 * Execute a SQL file
 */
function executeSqlFile(
  dbName: string,
  filePath: string,
  options: WranglerOptions,
): { success: boolean; error?: string } {
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

  return { success: true }
}

/**
 * Execute raw SQL command
 */
function executeSql(
  dbName: string,
  sql: string,
  options: WranglerOptions,
): { success: boolean; output?: string; error?: string } {
  const args = buildWranglerArgs(dbName, options)
  args.push("--command", sql)

  const result = spawnSync("wrangler", args, {
    encoding: "utf-8",
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  })

  if (result.status !== 0) {
    const errorOutput = result.stderr || result.stdout || ""
    return { success: false, error: errorOutput }
  }

  return { success: true, output: result.stdout }
}

/**
 * Check if migrations table exists
 */
function checkMigrationsTableExists(
  dbName: string,
  options: WranglerOptions,
): boolean {
  const result = executeSql(
    dbName,
    "SELECT name FROM sqlite_master WHERE type='table' AND name='_openauth_migrations'",
    options,
  )
  return (
    result.success && (result.output?.includes("_openauth_migrations") ?? false)
  )
}

/**
 * Check if a column exists in a table
 */
function checkColumnExists(
  dbName: string,
  tableName: string,
  columnName: string,
  options: WranglerOptions,
): boolean {
  const result = executeSql(
    dbName,
    `SELECT name FROM pragma_table_info('${tableName}') WHERE name = '${columnName}'`,
    options,
  )
  return result.success && (result.output?.includes(columnName) ?? false)
}

/**
 * Check if a table exists
 */
function checkTableExists(
  dbName: string,
  tableName: string,
  options: WranglerOptions,
): boolean {
  const result = executeSql(
    dbName,
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`,
    options,
  )
  return result.success && (result.output?.includes(tableName) ?? false)
}

/**
 * Check if an index exists
 */
function checkIndexExists(
  dbName: string,
  indexName: string,
  options: WranglerOptions,
): boolean {
  const result = executeSql(
    dbName,
    `SELECT name FROM sqlite_master WHERE type='index' AND name='${indexName}'`,
    options,
  )
  return result.success && (result.output?.includes(indexName) ?? false)
}

/**
 * Check if migration is already applied by examining schema
 * This handles cases where tracking table failed to record
 */
function isMigrationAlreadyApplied(
  dbName: string,
  migrationPath: string,
  options: WranglerOptions,
): { applied: boolean; reason?: string } {
  const content = readFileSync(migrationPath, "utf-8")
  const changes = parseSchemaChanges(content)

  if (changes.length === 0) {
    // No detectable schema changes - can't pre-check
    return { applied: false }
  }

  for (const change of changes) {
    switch (change.type) {
      case "add_column":
        if (checkColumnExists(dbName, change.table, change.column!, options)) {
          return {
            applied: true,
            reason: `Column ${change.table}.${change.column} already exists`,
          }
        }
        break

      case "drop_column":
        if (!checkColumnExists(dbName, change.table, change.column!, options)) {
          return {
            applied: true,
            reason: `Column ${change.table}.${change.column} already dropped`,
          }
        }
        break

      case "create_table":
        if (checkTableExists(dbName, change.table, options)) {
          return {
            applied: true,
            reason: `Table ${change.table} already exists`,
          }
        }
        break

      case "drop_table":
        if (!checkTableExists(dbName, change.table, options)) {
          return {
            applied: true,
            reason: `Table ${change.table} already dropped`,
          }
        }
        break

      case "create_index":
        if (checkIndexExists(dbName, change.index!, options)) {
          return {
            applied: true,
            reason: `Index ${change.index} already exists`,
          }
        }
        break
    }
  }

  return { applied: false }
}

/**
 * Get applied migrations from database
 */
function getAppliedMigrations(
  dbName: string,
  options: WranglerOptions,
): AppliedMigration[] {
  const result = executeSql(
    dbName,
    "SELECT name, applied_at, checksum FROM _openauth_migrations ORDER BY name",
    options,
  )

  if (!result.success || !result.output) {
    return []
  }

  // Parse wrangler JSON output
  const migrations: AppliedMigration[] = []
  try {
    // Wrangler outputs JSON with results
    const lines = result.output.split("\n")
    for (const line of lines) {
      if (line.includes('"name"')) {
        // Try to parse as part of results array
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
 * Record a migration as applied
 */
function recordMigration(
  dbName: string,
  migration: MigrationFile,
  options: WranglerOptions,
): { success: boolean; error?: string } {
  const now = Date.now()
  const sql = `INSERT INTO _openauth_migrations (name, applied_at, checksum) VALUES ('${migration.name}', ${now}, '${migration.checksum}')`
  return executeSql(dbName, sql, options)
}

function printHelp() {
  console.log(`
OpenAuth CLI

Usage:
  openauth migrate [database-name] [options]    Apply pending migrations
  openauth seed [database-name] [options]       Apply seed data only
  openauth status [database-name] [options]     Show migration status
  openauth help                                 Show this help message

Options:
  --local              Apply to local D1 database (for development)
  --remote             Apply to remote D1 database (production)
  --config, -c <file>  Use a specific wrangler config file
  --no-seed            Skip seed data (migrate only applies schema)
  --force              Force re-run all migrations (ignores tracking)

Examples:
  openauth migrate                       # Auto-detect from wrangler config
  openauth migrate --local               # Local database
  openauth migrate --remote              # Remote database
  openauth migrate --no-seed --local     # Skip seed data
  openauth migrate my-auth-db --remote   # Specify database name
  openauth status --local                # Show which migrations are applied
  openauth seed --local                  # Apply only seed data

Migrations are tracked in the _openauth_migrations table.
Only pending migrations are applied (safe to run multiple times).
`)
}

interface ParsedArgs {
  dbName?: string
  isLocal: boolean
  isRemote: boolean
  configFile?: string
  withSeed: boolean
  force: boolean
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    isLocal: false,
    isRemote: false,
    withSeed: true,
    force: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--local") {
      result.isLocal = true
    } else if (arg === "--remote") {
      result.isRemote = true
    } else if (arg === "--no-seed") {
      result.withSeed = false
    } else if (arg === "--seed") {
      result.withSeed = true
    } else if (arg === "--force") {
      result.force = true
    } else if (arg === "--config" || arg === "-c") {
      result.configFile = args[++i]
      if (!result.configFile) {
        console.error("Error: --config requires a file path")
        process.exit(1)
      }
    } else if (!arg.startsWith("-")) {
      result.dbName = arg
    }
  }

  return result
}

function resolveDbName(parsed: ParsedArgs): string {
  if (parsed.dbName) {
    return parsed.dbName
  }

  const config = parseWranglerConfig(parsed.configFile)
  if (config) {
    console.log(
      `Found database in ${config.configFile}: ${config.databaseName}`,
    )
    return config.databaseName
  }

  if (parsed.configFile) {
    console.error(`Error: Could not read database from ${parsed.configFile}`)
  } else {
    console.error(
      "Error: No database name provided and couldn't find wrangler config",
    )
    console.error("Supported: wrangler.toml, wrangler.json, wrangler.jsonc")
  }
  process.exit(1)
}

function checkWrangler() {
  try {
    execSync("wrangler --version", { stdio: "ignore" })
  } catch {
    console.error("Error: wrangler CLI not found")
    console.error("Install it with: npm install -g wrangler")
    process.exit(1)
  }
}

function migrate(args: string[]) {
  const parsed = parseArgs(args)

  if (parsed.isLocal && parsed.isRemote) {
    console.error("Error: Cannot specify both --local and --remote")
    process.exit(1)
  }

  const dbName = resolveDbName(parsed)
  checkWrangler()

  const options: WranglerOptions = {
    isLocal: parsed.isLocal,
    isRemote: parsed.isRemote,
    configFile: parsed.configFile,
  }

  const target = parsed.isLocal
    ? " (local)"
    : parsed.isRemote
      ? " (remote)"
      : ""

  // Get all migration files
  const migrations = getMigrationFiles()
  if (migrations.length === 0) {
    console.error("Error: No migration files found in", migrationsDir)
    process.exit(1)
  }

  console.log(`\nOpenAuth Migration - ${dbName}${target}`)
  console.log("=".repeat(50))

  // Separate schema migrations from seed
  const schemaMigrations = migrations.filter(
    (m) => !m.name.includes("seed") && !m.name.includes("002_seed"),
  )
  const seedMigration = migrations.find(
    (m) => m.name.includes("seed") || m.name.includes("002_seed"),
  )

  // Check if migrations table exists
  const tableExists = checkMigrationsTableExists(dbName, options)

  // Get applied migrations (only if table exists)
  const applied = tableExists ? getAppliedMigrations(dbName, options) : []
  const appliedNames = new Set(applied.map((m) => m.name))

  // Determine which schema migrations to run
  let pendingMigrations: MigrationFile[]
  if (parsed.force) {
    console.log("Force mode: running all migrations")
    pendingMigrations = schemaMigrations
  } else {
    pendingMigrations = schemaMigrations.filter(
      (m) => !appliedNames.has(m.name),
    )
  }

  if (pendingMigrations.length === 0 && !parsed.withSeed) {
    console.log("\nAll migrations are already applied.")
    return
  }

  // Run pending schema migrations
  let appliedCount = 0
  for (const migration of pendingMigrations) {
    const existingMigration = applied.find((a) => a.name === migration.name)

    // Check for checksum mismatch (modified migration)
    if (
      existingMigration &&
      existingMigration.checksum !== migration.checksum
    ) {
      console.log(
        `\nWarning: ${migration.name} has been modified since it was applied.`,
      )
      console.log(`  Applied checksum: ${existingMigration.checksum}`)
      console.log(`  Current checksum: ${migration.checksum}`)
      if (!parsed.force) {
        console.log("  Use --force to re-apply.")
        continue
      }
    }

    // Pre-check: Is migration already applied by examining schema?
    // This catches cases where tracking table failed to record
    const schemaCheck = isMigrationAlreadyApplied(
      dbName,
      migration.path,
      options,
    )
    if (schemaCheck.applied) {
      console.log(`\nSkipping: ${migration.name}`)
      console.log(`  ${schemaCheck.reason}`)
      // Try to record it since it wasn't tracked
      const recordResult = recordMigration(dbName, migration, options)
      if (recordResult.success) {
        console.log(`  Recorded in migrations table`)
      }
      continue
    }

    console.log(`\nApplying: ${migration.name}`)
    const result = executeSqlFile(dbName, migration.path, options)

    if (!result.success) {
      // Check if error indicates migration was already applied
      if (result.error && isAlreadyAppliedError(result.error)) {
        console.log(`  Already applied (schema exists)`)
        // Record it since it wasn't tracked
        const recordResult = recordMigration(dbName, migration, options)
        if (recordResult.success) {
          console.log(`  Recorded in migrations table`)
        }
        appliedCount++
        continue
      }

      console.error(`Error: Failed to apply ${migration.name}`)
      if (result.error) {
        console.error(result.error)
      }
      process.exit(1)
    }

    // Record the migration (after first migration creates the table)
    if (
      migration.name === "001_schema.sql" ||
      tableExists ||
      appliedCount > 0
    ) {
      const recordResult = recordMigration(dbName, migration, options)
      if (!recordResult.success) {
        console.warn(`Warning: Could not record migration ${migration.name}`)
        // Retry once after a short delay (D1 might need time to commit)
        setTimeout(() => {
          const retryResult = recordMigration(dbName, migration, options)
          if (retryResult.success) {
            console.log(`  Migration recorded on retry`)
          }
        }, 500)
      }
    }

    console.log(`  Applied successfully (checksum: ${migration.checksum})`)
    appliedCount++
  }

  // Apply seed if requested
  if (parsed.withSeed && seedMigration) {
    const seedApplied = appliedNames.has(seedMigration.name)
    const shouldRunSeed = !seedApplied || parsed.force

    if (shouldRunSeed) {
      console.log(`\nApplying: ${seedMigration.name}`)
      const seedResult = executeSqlFile(dbName, seedMigration.path, options)

      if (!seedResult.success) {
        console.error(`Error: Failed to apply ${seedMigration.name}`)
        if (seedResult.error) {
          console.error(seedResult.error)
        }
        process.exit(1)
      }

      // Record seed migration
      if (!seedApplied) {
        const recordResult = recordMigration(dbName, seedMigration, options)
        if (!recordResult.success) {
          console.warn(
            `Warning: Could not record migration ${seedMigration.name}`,
          )
        }
      }

      console.log(
        `  Applied successfully (checksum: ${seedMigration.checksum})`,
      )
      appliedCount++
    } else {
      console.log(`\nSkipping: ${seedMigration.name} (already applied)`)
    }
  }

  console.log("\n" + "=".repeat(50))
  if (appliedCount > 0) {
    console.log(`Migration complete! Applied ${appliedCount} migration(s).`)
  } else {
    console.log("No new migrations to apply.")
  }
}

function status(args: string[]) {
  const parsed = parseArgs(args)

  if (parsed.isLocal && parsed.isRemote) {
    console.error("Error: Cannot specify both --local and --remote")
    process.exit(1)
  }

  const dbName = resolveDbName(parsed)
  checkWrangler()

  const options: WranglerOptions = {
    isLocal: parsed.isLocal,
    isRemote: parsed.isRemote,
    configFile: parsed.configFile,
  }

  const target = parsed.isLocal
    ? " (local)"
    : parsed.isRemote
      ? " (remote)"
      : ""

  console.log(`\nOpenAuth Migration Status - ${dbName}${target}`)
  console.log("=".repeat(50))

  // Get all migration files
  const migrations = getMigrationFiles()
  if (migrations.length === 0) {
    console.error("Error: No migration files found")
    process.exit(1)
  }

  // Check if migrations table exists
  const tableExists = checkMigrationsTableExists(dbName, options)
  if (!tableExists) {
    console.log("\nMigrations table does not exist yet.")
    console.log("Run 'openauth migrate' to initialize the database.\n")
    console.log("Pending migrations:")
    for (const m of migrations) {
      console.log(`  [ ] ${m.name}`)
    }
    return
  }

  // Get applied migrations
  const applied = getAppliedMigrations(dbName, options)
  const appliedMap = new Map(applied.map((m) => [m.name, m]))

  console.log("\nMigration Status:")
  console.log("-".repeat(50))

  for (const migration of migrations) {
    const appliedMigration = appliedMap.get(migration.name)

    if (appliedMigration) {
      const checksumMatch = appliedMigration.checksum === migration.checksum
      const date = new Date(appliedMigration.applied_at).toISOString()
      const status = checksumMatch ? "[x]" : "[!]"
      const warning = checksumMatch ? "" : " (MODIFIED)"
      console.log(`  ${status} ${migration.name}${warning}`)
      console.log(`      Applied: ${date}`)
      if (!checksumMatch) {
        console.log(`      Applied checksum: ${appliedMigration.checksum}`)
        console.log(`      Current checksum: ${migration.checksum}`)
      }
    } else {
      console.log(`  [ ] ${migration.name}`)
      console.log(`      Pending`)
    }
  }

  const pending = migrations.filter((m) => !appliedMap.has(m.name))
  console.log("-".repeat(50))
  console.log(
    `Total: ${migrations.length} | Applied: ${applied.length} | Pending: ${pending.length}`,
  )
}

function seed(args: string[]) {
  const parsed = parseArgs(args)

  if (parsed.isLocal && parsed.isRemote) {
    console.error("Error: Cannot specify both --local and --remote")
    process.exit(1)
  }

  const dbName = resolveDbName(parsed)
  checkWrangler()

  const migrations = getMigrationFiles()
  const seedMigration = migrations.find(
    (m) => m.name.includes("seed") || m.name.includes("002_seed"),
  )

  if (!seedMigration) {
    console.error("Error: Seed file not found")
    process.exit(1)
  }

  const options: WranglerOptions = {
    isLocal: parsed.isLocal,
    isRemote: parsed.isRemote,
    configFile: parsed.configFile,
  }

  const target = parsed.isLocal
    ? " (local)"
    : parsed.isRemote
      ? " (remote)"
      : ""

  console.log(`Applying seed data to ${dbName}${target}...`)
  const result = executeSqlFile(dbName, seedMigration.path, options)

  if (!result.success) {
    console.error("Error: Failed to apply seed data")
    if (result.error) {
      console.error(result.error)
    }
    process.exit(1)
  }

  console.log("Seed data applied successfully!")
}

// Parse command line arguments
const args = process.argv.slice(2)
const command = args[0]

switch (command) {
  case "migrate":
    migrate(args.slice(1))
    break
  case "seed":
    seed(args.slice(1))
    break
  case "status":
    status(args.slice(1))
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
