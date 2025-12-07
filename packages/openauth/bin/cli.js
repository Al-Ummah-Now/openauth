#!/usr/bin/env node

// bin/cli.ts
import { execSync, spawnSync } from "child_process";
import { readFileSync, readdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
var __filename2 = fileURLToPath(import.meta.url);
var __dirname2 = dirname(__filename2);
var migrationsDir = join(__dirname2, "..", "src", "migrations");
function stripJsonComments(content) {
  content = content.replace(/\/\/.*$/gm, "");
  content = content.replace(/\/\*[\s\S]*?\*\//g, "");
  return content;
}
function parseConfigFile(configPath) {
  if (!existsSync(configPath)) {
    return null;
  }
  const content = readFileSync(configPath, "utf-8");
  if (configPath.endsWith(".toml")) {
    const match = content.match(/database_name\s*=\s*"([^"]+)"/);
    if (match) {
      return { databaseName: match[1], configFile: configPath };
    }
  } else if (configPath.endsWith(".jsonc")) {
    try {
      const stripped = stripJsonComments(content);
      const config = JSON.parse(stripped);
      const dbName = extractDbNameFromJson(config);
      if (dbName) {
        return { databaseName: dbName, configFile: configPath };
      }
    } catch {}
  } else if (configPath.endsWith(".json")) {
    try {
      const config = JSON.parse(content);
      const dbName = extractDbNameFromJson(config);
      if (dbName) {
        return { databaseName: dbName, configFile: configPath };
      }
    } catch {}
  }
  return null;
}
function parseWranglerConfig(customConfig) {
  if (customConfig) {
    return parseConfigFile(customConfig);
  }
  const cwd = process.cwd();
  const tomlResult = parseConfigFile(join(cwd, "wrangler.toml"));
  if (tomlResult)
    return tomlResult;
  const jsonResult = parseConfigFile(join(cwd, "wrangler.json"));
  if (jsonResult)
    return jsonResult;
  const jsoncResult = parseConfigFile(join(cwd, "wrangler.jsonc"));
  if (jsoncResult)
    return jsoncResult;
  return null;
}
function extractDbNameFromJson(config) {
  if (Array.isArray(config.d1_databases) && config.d1_databases.length > 0) {
    const db = config.d1_databases[0];
    if (db.database_name) {
      return db.database_name;
    }
  }
  return null;
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

Examples:
  openauth migrate                       # Auto-detect from wrangler config
  openauth migrate --local               # Local database
  openauth migrate --remote              # Remote database (production)
  openauth migrate my-auth-db --remote   # Specify database, remote
  openauth migrate -c wrangler.qa.json --remote

The migrate command executes OpenAuth SQL migrations against your D1 database.
`);
}
function migrate(args) {
  let dbName;
  let isLocal = false;
  let isRemote = false;
  let configFile;
  for (let i = 0;i < args.length; i++) {
    const arg = args[i];
    if (arg === "--local") {
      isLocal = true;
    } else if (arg === "--remote") {
      isRemote = true;
    } else if (arg === "--config" || arg === "-c") {
      configFile = args[++i];
      if (!configFile) {
        console.error("Error: --config requires a file path");
        process.exit(1);
      }
    } else if (!arg.startsWith("-")) {
      dbName = arg;
    }
  }
  if (isLocal && isRemote) {
    console.error("Error: Cannot specify both --local and --remote");
    process.exit(1);
  }
  if (!dbName) {
    const config = parseWranglerConfig(configFile);
    if (config) {
      dbName = config.databaseName;
      console.log(`Found database in ${config.configFile}: ${dbName}`);
    } else {
      if (configFile) {
        console.error(`Error: Could not read database from ${configFile}`);
      } else {
        console.error("Error: No database name provided and couldn't find wrangler config");
        console.error("Supported: wrangler.toml, wrangler.json, wrangler.jsonc");
      }
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
  const sqlFiles = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  if (sqlFiles.length === 0) {
    console.error("Error: No SQL migration files found");
    process.exit(1);
  }
  console.log(`Applying ${sqlFiles.length} OpenAuth migrations to ${dbName}${isLocal ? " (local)" : ""}...`);
  for (const file of sqlFiles) {
    const filePath = join(migrationsDir, file);
    console.log(`  Applying ${file}...`);
    const wranglerArgs = ["d1", "execute", dbName, "--file", filePath];
    if (isLocal) {
      wranglerArgs.push("--local");
    }
    if (isRemote) {
      wranglerArgs.push("--remote");
    }
    if (configFile) {
      wranglerArgs.push("--config", configFile);
    }
    const result = spawnSync("wrangler", wranglerArgs, {
      stdio: "inherit",
      shell: true
    });
    if (result.status !== 0) {
      console.error(`Error applying ${file}`);
      process.exit(result.status || 1);
    }
  }
  console.log("Migrations applied successfully!");
}
var args = process.argv.slice(2);
var command = args[0];
switch (command) {
  case "migrate":
    migrate(args.slice(1));
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
