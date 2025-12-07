#!/usr/bin/env node

// bin/cli.ts
import { execSync, spawnSync } from "child_process";
import { readFileSync, readdirSync, existsSync } from "fs";
import { createHash } from "crypto";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
var __filename2 = fileURLToPath(import.meta.url);
var __dirname2 = dirname(__filename2);
var migrationsDir = join(__dirname2, "..", "src", "migrations");
var MIGRATIONS_TABLE = "_openauth_migrations";
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
function calculateChecksum(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}
function buildWranglerArgs(dbName, options) {
  const args = ["d1", "execute", dbName];
  if (options.isLocal)
    args.push("--local");
  if (options.isRemote)
    args.push("--remote");
  if (options.configFile)
    args.push("--config", options.configFile);
  return args;
}
function executeSqlCommand(dbName, sql, options) {
  const args = buildWranglerArgs(dbName, options);
  args.push("--command", sql);
  const result = spawnSync("wrangler", args, {
    encoding: "utf-8",
    shell: false,
    stdio: ["pipe", "pipe", "pipe"]
  });
  return {
    success: result.status === 0,
    output: result.stdout || result.stderr || ""
  };
}
function executeSqlFile(dbName, filePath, options) {
  const args = buildWranglerArgs(dbName, options);
  args.push("--file", filePath);
  const result = spawnSync("wrangler", args, {
    stdio: "inherit",
    shell: false
  });
  return { success: result.status === 0 };
}
function getAppliedMigrations(dbName, options) {
  const sql = `SELECT name FROM ${MIGRATIONS_TABLE}`;
  const result = executeSqlCommand(dbName, sql, options);
  if (!result.success) {
    return new Set;
  }
  const applied = new Set;
  try {
    const matches = result.output.match(/"name":\s*"([^"]+)"/g);
    if (matches) {
      for (const match of matches) {
        const name = match.match(/"name":\s*"([^"]+)"/)?.[1];
        if (name)
          applied.add(name);
      }
    }
  } catch {}
  return applied;
}
function recordMigration(dbName, migrationName, checksum, options) {
  const now = Date.now();
  const sql = `INSERT OR REPLACE INTO ${MIGRATIONS_TABLE} (name, applied_at, checksum) VALUES ('${migrationName}', ${now}, '${checksum}')`;
  const result = executeSqlCommand(dbName, sql, options);
  return result.success;
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
`);
}
function migrate(args) {
  let dbName;
  let isLocal = false;
  let isRemote = false;
  let markApplied = false;
  let configFile;
  for (let i = 0;i < args.length; i++) {
    const arg = args[i];
    if (arg === "--local") {
      isLocal = true;
    } else if (arg === "--remote") {
      isRemote = true;
    } else if (arg === "--mark-applied") {
      markApplied = true;
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
  const options = { isLocal, isRemote, configFile };
  const trackingMigration = sqlFiles.find((f) => f.startsWith("000_"));
  if (trackingMigration) {
    const trackingPath = join(migrationsDir, trackingMigration);
    console.log(`Ensuring migration tracking table exists...`);
    const trackingResult = executeSqlFile(dbName, trackingPath, options);
    if (!trackingResult.success) {
      console.error("Error: Failed to create migration tracking table");
      process.exit(1);
    }
  }
  const appliedMigrations = getAppliedMigrations(dbName, options);
  if (appliedMigrations.size > 0) {
    console.log(`Found ${appliedMigrations.size} previously applied migrations`);
  }
  const pendingMigrations = sqlFiles.filter((f) => !appliedMigrations.has(f) && !f.startsWith("000_"));
  if (markApplied) {
    console.log(`Marking ${pendingMigrations.length} migration(s) as applied (without executing)...`);
    for (const file of pendingMigrations) {
      const filePath = join(migrationsDir, file);
      const content = readFileSync(filePath, "utf-8");
      const checksum = calculateChecksum(content);
      const recorded = recordMigration(dbName, file, checksum, options);
      if (recorded) {
        console.log(`  Marked ${file} as applied`);
      } else {
        console.warn(`  Warning: Could not mark ${file} as applied`);
      }
    }
    console.log("Done! All migrations marked as applied.");
    return;
  }
  if (pendingMigrations.length === 0) {
    console.log("All migrations are already applied. Database is up to date.");
    return;
  }
  console.log(`Applying ${pendingMigrations.length} new migration(s) to ${dbName}${isLocal ? " (local)" : isRemote ? " (remote)" : ""}...`);
  let applied = 0;
  for (const file of pendingMigrations) {
    const filePath = join(migrationsDir, file);
    const content = readFileSync(filePath, "utf-8");
    const checksum = calculateChecksum(content);
    console.log(`  Applying ${file}...`);
    const result = executeSqlFile(dbName, filePath, options);
    if (!result.success) {
      console.error(`Error applying ${file}`);
      console.error(`${applied} migration(s) were applied before the error occurred.`);
      process.exit(1);
    }
    const recorded = recordMigration(dbName, file, checksum, options);
    if (!recorded) {
      console.warn(`  Warning: Could not record ${file} in tracking table`);
    }
    applied++;
  }
  console.log(`Successfully applied ${applied} migration(s)!`);
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
