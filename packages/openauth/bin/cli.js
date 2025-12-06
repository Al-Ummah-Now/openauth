#!/usr/bin/env node

// bin/cli.ts
import { execSync, spawnSync } from "child_process"
import { readFileSync, readdirSync, existsSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
var __filename2 = fileURLToPath(import.meta.url)
var __dirname2 = dirname(__filename2)
var migrationsDir = join(__dirname2, "..", "src", "migrations")
function stripJsonComments(content) {
  content = content.replace(/\/\/.*$/gm, "")
  content = content.replace(/\/\*[\s\S]*?\*\//g, "")
  return content
}
function parseWranglerConfig() {
  const cwd = process.cwd()
  const tomlPath = join(cwd, "wrangler.toml")
  if (existsSync(tomlPath)) {
    const content = readFileSync(tomlPath, "utf-8")
    const match = content.match(/database_name\s*=\s*"([^"]+)"/)
    if (match) {
      return { databaseName: match[1], configFile: "wrangler.toml" }
    }
  }
  const jsonPath = join(cwd, "wrangler.json")
  if (existsSync(jsonPath)) {
    try {
      const content = readFileSync(jsonPath, "utf-8")
      const config = JSON.parse(content)
      const dbName = extractDbNameFromJson(config)
      if (dbName) {
        return { databaseName: dbName, configFile: "wrangler.json" }
      }
    } catch {}
  }
  const jsoncPath = join(cwd, "wrangler.jsonc")
  if (existsSync(jsoncPath)) {
    try {
      const content = readFileSync(jsoncPath, "utf-8")
      const stripped = stripJsonComments(content)
      const config = JSON.parse(stripped)
      const dbName = extractDbNameFromJson(config)
      if (dbName) {
        return { databaseName: dbName, configFile: "wrangler.jsonc" }
      }
    } catch {}
  }
  return null
}
function extractDbNameFromJson(config) {
  if (Array.isArray(config.d1_databases) && config.d1_databases.length > 0) {
    const db = config.d1_databases[0]
    if (db.database_name) {
      return db.database_name
    }
  }
  return null
}
function printHelp() {
  console.log(`
OpenAuth CLI

Usage:
  openauth migrate [database-name] [--local]    Apply database migrations
  openauth help                                 Show this help message

Options:
  --local    Apply to local D1 database (for development)

Examples:
  openauth migrate                    # Auto-detect from wrangler config, remote
  openauth migrate --local            # Auto-detect, local database
  openauth migrate my-auth-db         # Specify database name
  openauth migrate my-auth-db --local # Specify database, local

The migrate command executes OpenAuth SQL migrations against your D1 database.
`)
}
function migrate(args) {
  let dbName
  let isLocal = false
  for (const arg of args) {
    if (arg === "--local") {
      isLocal = true
    } else if (!arg.startsWith("-")) {
      dbName = arg
    }
  }
  if (!dbName) {
    const config = parseWranglerConfig()
    if (config) {
      dbName = config.databaseName
      console.log(`Found database in ${config.configFile}: ${dbName}`)
    } else {
      console.error(
        "Error: No database name provided and couldn't find wrangler config",
      )
      console.error("Supported: wrangler.toml, wrangler.json, wrangler.jsonc")
      console.error("Usage: openauth migrate <database-name>")
      process.exit(1)
    }
  }
  try {
    execSync("wrangler --version", { stdio: "ignore" })
  } catch {
    console.error("Error: wrangler CLI not found")
    console.error("Install it with: npm install -g wrangler")
    process.exit(1)
  }
  const sqlFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
  if (sqlFiles.length === 0) {
    console.error("Error: No SQL migration files found")
    process.exit(1)
  }
  console.log(
    `Applying ${sqlFiles.length} OpenAuth migrations to ${dbName}${isLocal ? " (local)" : ""}...`,
  )
  for (const file of sqlFiles) {
    const filePath = join(migrationsDir, file)
    console.log(`  Applying ${file}...`)
    const wranglerArgs = ["d1", "execute", dbName, "--file", filePath]
    if (isLocal) {
      wranglerArgs.push("--local")
    }
    const result = spawnSync("wrangler", wranglerArgs, {
      stdio: "inherit",
      shell: true,
    })
    if (result.status !== 0) {
      console.error(`Error applying ${file}`)
      process.exit(result.status || 1)
    }
  }
  console.log("Migrations applied successfully!")
}
var args = process.argv.slice(2)
var command = args[0]
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
