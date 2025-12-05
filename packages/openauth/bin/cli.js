#!/usr/bin/env node

// bin/cli.ts
import { execSync, spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
var __filename2 = fileURLToPath(import.meta.url);
var __dirname2 = dirname(__filename2);
var migrationsDir = join(__dirname2, "..", "src", "migrations");
function parseWranglerToml() {
  const wranglerPath = join(process.cwd(), "wrangler.toml");
  if (!existsSync(wranglerPath)) {
    return null;
  }
  const content = readFileSync(wranglerPath, "utf-8");
  const match = content.match(/database_name\s*=\s*"([^"]+)"/);
  if (match) {
    return { databaseName: match[1] };
  }
  return null;
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
`);
}
function migrate(dbName) {
  if (!dbName) {
    const config = parseWranglerToml();
    if (config) {
      dbName = config.databaseName;
      console.log(`Found database in wrangler.toml: ${dbName}`);
    } else {
      console.error("Error: No database name provided and couldn't find wrangler.toml");
      console.error("Usage: openauth migrate <database-name>");
      process.exit(1);
    }
  }
  try {
    execSync("wrangler --version", { stdio: "ignore" });
  } catch {
    console.error("Error: wrangler CLI not found");
    console.error("Install it with: npm install -g wrangler");
    process.exit(1);
  }
  console.log(`Applying OpenAuth migrations to ${dbName}...`);
  console.log(`Migrations directory: ${migrationsDir}`);
  const result = spawnSync("wrangler", ["d1", "migrations", "apply", dbName, "--migrations-dir", migrationsDir], { stdio: "inherit", shell: true });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
  console.log("Migrations applied successfully!");
}
var args = process.argv.slice(2);
var command = args[0];
switch (command) {
  case "migrate":
    migrate(args[1]);
    break;
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  default:
    if (command) {
      console.error(`Unknown command: ${command}`);
    }
    printHelp();
    process.exit(command ? 1 : 0);
}
