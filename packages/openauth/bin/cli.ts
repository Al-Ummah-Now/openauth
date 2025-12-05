#!/usr/bin/env node
/**
 * OpenAuth CLI
 *
 * Provides commands for managing OpenAuth in your project.
 *
 * Usage:
 *   npx openauth migrate [database-name]
 *
 * If database-name is not provided, reads from wrangler.toml
 */

import { execSync, spawnSync } from "child_process"
import { readFileSync, existsSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Migrations are in src/migrations relative to package root
const migrationsDir = join(__dirname, "..", "src", "migrations")

function parseWranglerToml(): { databaseName: string } | null {
  const wranglerPath = join(process.cwd(), "wrangler.toml")

  if (!existsSync(wranglerPath)) {
    return null
  }

  const content = readFileSync(wranglerPath, "utf-8")

  // Simple TOML parsing for d1_databases
  // Looking for: database_name = "xxx"
  const match = content.match(/database_name\s*=\s*"([^"]+)"/)
  if (match) {
    return { databaseName: match[1] }
  }

  return null
}

function printHelp() {
  console.log(`
OpenAuth CLI

Usage:
  openauth migrate [database-name]    Apply database migrations
  openauth help                       Show this help message

Examples:
  openauth migrate                    # Auto-detect from wrangler.toml
  openauth migrate my-auth-db         # Specify database name

The migrate command runs wrangler d1 migrations apply with the
OpenAuth SQL migrations bundled in this package.
`)
}

function migrate(dbName?: string) {
  // Try to get database name from wrangler.toml if not provided
  if (!dbName) {
    const config = parseWranglerToml()
    if (config) {
      dbName = config.databaseName
      console.log(`Found database in wrangler.toml: ${dbName}`)
    } else {
      console.error("Error: No database name provided and couldn't find wrangler.toml")
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

  console.log(`Applying OpenAuth migrations to ${dbName}...`)
  console.log(`Migrations directory: ${migrationsDir}`)

  // Run wrangler d1 migrations apply
  const result = spawnSync(
    "wrangler",
    ["d1", "migrations", "apply", dbName, "--migrations-dir", migrationsDir],
    { stdio: "inherit", shell: true }
  )

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }

  console.log("Migrations applied successfully!")
}

// Parse command line arguments
const args = process.argv.slice(2)
const command = args[0]

switch (command) {
  case "migrate":
    migrate(args[1])
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
