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
// Single migration file
const migrationFile = join(
  __dirname,
  "..",
  "src",
  "migrations",
  "001_schema.sql",
)
/**
 * Strip JSON comments for JSONC support
 */
function stripJsonComments(content) {
  content = content.replace(/\/\/.*$/gm, "")
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
function parseWranglerConfig(customConfig) {
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
function extractDbNameFromJson(config) {
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
function buildWranglerArgs(dbName, options) {
  const args = ["d1", "execute", dbName]
  if (options.isLocal) args.push("--local")
  if (options.isRemote) args.push("--remote")
  if (options.configFile) args.push("--config", options.configFile)
  return args
}
/**
 * Execute a SQL file
 */
function executeSqlFile(dbName, filePath, options) {
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
  openauth help                                 Show this help message

Options:
  --local              Apply to local D1 database (for development)
  --remote             Apply to remote D1 database (production)
  --config, -c <file>  Use a specific wrangler config file

Examples:
  openauth migrate                       # Auto-detect from wrangler config
  openauth migrate --local               # Local database
  openauth migrate --remote              # Remote database (production)
  openauth migrate my-auth-db --remote   # Specify database, remote
  openauth migrate -c wrangler.qa.json --remote

The migrate command applies the OpenAuth database schema to your D1 database.
The schema is idempotent - safe to run multiple times.
`)
}
function migrate(args) {
  let dbName
  let isLocal = false
  let isRemote = false
  let configFile
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--local") {
      isLocal = true
    } else if (arg === "--remote") {
      isRemote = true
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
  if (isLocal && isRemote) {
    console.error("Error: Cannot specify both --local and --remote")
    process.exit(1)
  }
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
  // Check migration file exists
  if (!existsSync(migrationFile)) {
    console.error(`Error: Migration file not found: ${migrationFile}`)
    console.error(
      "This may indicate the openauth package was not installed correctly.",
    )
    process.exit(1)
  }
  const options = { isLocal, isRemote, configFile }
  const target = isLocal ? " (local)" : isRemote ? " (remote)" : ""
  console.log(`Applying OpenAuth schema to ${dbName}${target}...`)
  const result = executeSqlFile(dbName, migrationFile, options)
  if (!result.success) {
    console.error("Error: Failed to apply schema")
    if (result.error) {
      console.error(result.error)
    }
    process.exit(1)
  }
  console.log("Schema applied successfully!")
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
