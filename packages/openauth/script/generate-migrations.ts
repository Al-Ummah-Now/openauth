/**
 * Generate migrations/index.ts from SQL files
 *
 * Run with: bun run script/generate-migrations.ts
 *
 * This reads all .sql files from src/migrations/ and generates
 * a TypeScript file with the SQL embedded as strings.
 */

import { readFileSync, writeFileSync, readdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const migrationsDir = join(__dirname, "..", "src", "migrations")
const outputFile = join(migrationsDir, "generated.ts")

// Get all SQL files sorted by name
const sqlFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()

console.log(`Found ${sqlFiles.length} SQL files`)

// Build the generated file
let output = `/**
 * AUTO-GENERATED - DO NOT EDIT
 *
 * Generated from SQL files by: bun run script/generate-migrations.ts
 * Source files: src/migrations/*.sql
 */

import type { D1Database } from "../session/d1-adapter.js"

// Migration state cache (per-isolate)
let migrationState: "pending" | "running" | "complete" = "pending"
let migrationPromise: Promise<void> | null = null

export interface Migration {
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
`

for (const file of sqlFiles) {
  const name = file.replace(".sql", "")
  const sql = readFileSync(join(migrationsDir, file), "utf-8")

  // Escape backticks and ${} in the SQL
  const escapedSql = sql.replace(/`/g, "\\`").replace(/\$\{/g, "\\${")

  output += `  {
    name: "${name}",
    sql: \`${escapedSql}\`,
  },
`
}

output += `]

// Add migration tracking table
const TRACKING_SQL = \`
CREATE TABLE IF NOT EXISTS _openauth_migrations (
  name TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
\`

/**
 * Run all migrations that haven't been applied yet.
 */
export async function ensureMigrations(
  db: D1Database,
  options: { verbose?: boolean; force?: boolean } = {},
): Promise<{ applied: string[]; skipped: string[] }> {
  const { verbose = false, force = false } = options
  const log = verbose ? console.log : () => {}
  const result = { applied: [] as string[], skipped: [] as string[] }

  // Ensure tracking table exists
  try {
    await db.exec(TRACKING_SQL)
  } catch {}

  for (const migration of MIGRATIONS) {
    // Check if already applied
    if (!force) {
      try {
        const check = await db
          .prepare("SELECT 1 FROM _openauth_migrations WHERE name = ?")
          .bind(migration.name)
          .first()
        if (check) {
          result.skipped.push(migration.name)
          continue
        }
      } catch {}
    }

    log(\`[migrations] Applying \${migration.name}...\`)

    try {
      await db.exec(migration.sql)
      await db
        .prepare("INSERT OR REPLACE INTO _openauth_migrations (name, applied_at) VALUES (?, ?)")
        .bind(migration.name, Date.now())
        .run()
      result.applied.push(migration.name)
      log(\`[migrations] Applied \${migration.name}\`)
    } catch (error) {
      log(\`[migrations] Warning: \${error}\`)
    }
  }

  return result
}

/**
 * Run migrations once per worker isolate.
 */
export async function ensureMigrationsOnce(db: D1Database): Promise<void> {
  if (migrationState === "complete") return

  if (migrationState === "running" && migrationPromise) {
    await migrationPromise
    return
  }

  migrationState = "running"
  migrationPromise = ensureMigrations(db)
    .then(() => { migrationState = "complete" })
    .catch((e) => { migrationState = "pending"; throw e })

  await migrationPromise
}

export function resetMigrationState(): void {
  migrationState = "pending"
  migrationPromise = null
}

export async function getAppliedMigrations(db: D1Database): Promise<string[]> {
  try {
    const { results } = await db
      .prepare("SELECT name FROM _openauth_migrations ORDER BY applied_at")
      .all<{ name: string }>()
    return (results || []).map((r) => r.name)
  } catch {
    return []
  }
}
`

writeFileSync(outputFile, output)
console.log(`Generated ${outputFile}`)
