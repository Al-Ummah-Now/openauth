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
import { readFileSync, existsSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Migration files
const schemaFile = join(__dirname, "..", "src", "migrations", "001_schema.sql")
const seedFile = join(__dirname, "..", "src", "migrations", "002_seed.sql")

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

/**
 * Build wrangler command arguments
 */
function buildWranglerArgs(
  dbName: string,
  options: { isLocal: boolean; isRemote: boolean; configFile?: string },
): string[] {
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
  options: { isLocal: boolean; isRemote: boolean; configFile?: string },
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

function printHelp() {
  console.log(`
OpenAuth CLI

Usage:
  openauth migrate [database-name] [options]    Apply database schema
  openauth seed [database-name] [options]       Apply seed data (roles, permissions, clients)
  openauth help                                 Show this help message

Options:
  --local              Apply to local D1 database (for development)
  --remote             Apply to remote D1 database (production)
  --config, -c <file>  Use a specific wrangler config file
  --seed               Also apply seed data after schema (migrate only)

Examples:
  openauth migrate                       # Auto-detect from wrangler config
  openauth migrate --local               # Local database
  openauth migrate --remote              # Remote database (production)
  openauth migrate --seed --local        # Schema + seed data (local)
  openauth migrate my-auth-db --remote   # Specify database, remote
  openauth seed --local                  # Apply only seed data
  openauth migrate -c wrangler.qa.json --remote

The migrate command applies the OpenAuth database schema to your D1 database.
The seed command applies default data (clients, roles, permissions).
Both commands are idempotent - safe to run multiple times.
`)
}

interface ParsedArgs {
  dbName?: string
  isLocal: boolean
  isRemote: boolean
  configFile?: string
  withSeed: boolean
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    isLocal: false,
    isRemote: false,
    withSeed: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--local") {
      result.isLocal = true
    } else if (arg === "--remote") {
      result.isRemote = true
    } else if (arg === "--seed") {
      result.withSeed = true
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

  // Check schema file exists
  if (!existsSync(schemaFile)) {
    console.error(`Error: Schema file not found: ${schemaFile}`)
    console.error(
      "This may indicate the openauth package was not installed correctly.",
    )
    process.exit(1)
  }

  const options = {
    isLocal: parsed.isLocal,
    isRemote: parsed.isRemote,
    configFile: parsed.configFile,
  }
  const target = parsed.isLocal
    ? " (local)"
    : parsed.isRemote
      ? " (remote)"
      : ""

  // Apply schema
  console.log(`Applying OpenAuth schema to ${dbName}${target}...`)
  const schemaResult = executeSqlFile(dbName, schemaFile, options)

  if (!schemaResult.success) {
    console.error("Error: Failed to apply schema")
    if (schemaResult.error) {
      console.error(schemaResult.error)
    }
    process.exit(1)
  }

  console.log("Schema applied successfully!")

  // Apply seed if requested
  if (parsed.withSeed) {
    if (!existsSync(seedFile)) {
      console.error(`Error: Seed file not found: ${seedFile}`)
      process.exit(1)
    }

    console.log(`Applying seed data to ${dbName}${target}...`)
    const seedResult = executeSqlFile(dbName, seedFile, options)

    if (!seedResult.success) {
      console.error("Error: Failed to apply seed data")
      if (seedResult.error) {
        console.error(seedResult.error)
      }
      process.exit(1)
    }

    console.log("Seed data applied successfully!")
  }
}

function seed(args: string[]) {
  const parsed = parseArgs(args)

  if (parsed.isLocal && parsed.isRemote) {
    console.error("Error: Cannot specify both --local and --remote")
    process.exit(1)
  }

  const dbName = resolveDbName(parsed)
  checkWrangler()

  // Check seed file exists
  if (!existsSync(seedFile)) {
    console.error(`Error: Seed file not found: ${seedFile}`)
    console.error(
      "This may indicate the openauth package was not installed correctly.",
    )
    process.exit(1)
  }

  const options = {
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
  const result = executeSqlFile(dbName, seedFile, options)

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
