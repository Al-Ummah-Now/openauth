import { expect, test, describe, mock, spyOn, beforeEach } from "bun:test"
import {
  calculateChecksum,
  parseArgs,
  buildWranglerArgs,
  parseAppliedMigrationsOutput,
  buildRecordMigrationSql,
  buildVerifyMigrationSql,
  migrationRecordExistsInOutput,
  type WranglerOptions,
} from "./cli-utils.js"

/**
 * CLI Integration Tests
 *
 * These tests verify the interaction between CLI utility functions
 * and the higher-level logic. For functions that call spawnSync,
 * we test the logic around them rather than the subprocess calls themselves.
 */

describe("CLI Integration", () => {
  describe("recordMigration verification logic", () => {
    // This tests the logic that would be used in recordMigration
    // to verify a migration was actually recorded

    test("should detect successful insert from verification query output", () => {
      const migrationName = "002_seed.sql"
      const verifyOutput = `{"results": [{"name": "${migrationName}"}]}`

      // Simulates the verification check in recordMigration
      const recordExists = migrationRecordExistsInOutput(
        verifyOutput,
        migrationName,
      )
      expect(recordExists).toBe(true)
    })

    test("should detect missing record from empty verification output", () => {
      const migrationName = "002_seed.sql"
      const verifyOutput = `{"results": []}`

      const recordExists = migrationRecordExistsInOutput(
        verifyOutput,
        migrationName,
      )
      expect(recordExists).toBe(false)
    })

    test("should build correct INSERT SQL for recording migration", () => {
      const sql = buildRecordMigrationSql(
        "002_seed.sql",
        "abc123def456",
        1700000000000,
      )
      expect(sql).toContain("INSERT INTO _openauth_migrations")
      expect(sql).toContain("002_seed.sql")
      expect(sql).toContain("abc123def456")
      expect(sql).toContain("1700000000000")
    })

    test("should build correct SELECT SQL for verification", () => {
      const sql = buildVerifyMigrationSql("002_seed.sql")
      expect(sql).toContain("SELECT name FROM _openauth_migrations")
      expect(sql).toContain("002_seed.sql")
    })
  })

  describe("migration tracking workflow", () => {
    test("parseAppliedMigrationsOutput parses wrangler output correctly", () => {
      // Simulates typical wrangler d1 execute output
      const wranglerOutput = `
[
  {
    "results": [
      {"name": "001_schema.sql", "applied_at": 1700000000000, "checksum": "abc123"},
      {"name": "002_seed.sql", "applied_at": 1700000001000, "checksum": "def456"}
    ]
  }
]`
      const migrations = parseAppliedMigrationsOutput(wranglerOutput)
      expect(migrations).toHaveLength(2)
      expect(migrations[0].name).toBe("001_schema.sql")
      expect(migrations[1].name).toBe("002_seed.sql")
    })

    test("parseAppliedMigrationsOutput handles empty results", () => {
      const wranglerOutput = `[{"results": []}]`
      const migrations = parseAppliedMigrationsOutput(wranglerOutput)
      expect(migrations).toHaveLength(0)
    })
  })

  describe("wrangler command building", () => {
    test("builds args for local database", () => {
      const args = buildWranglerArgs("test-db", {
        isLocal: true,
        isRemote: false,
      })
      expect(args).toContain("d1")
      expect(args).toContain("execute")
      expect(args).toContain("test-db")
      expect(args).toContain("--local")
      expect(args).not.toContain("--remote")
    })

    test("builds args for remote database", () => {
      const args = buildWranglerArgs("test-db", {
        isLocal: false,
        isRemote: true,
      })
      expect(args).toContain("--remote")
      expect(args).not.toContain("--local")
    })

    test("includes config file when specified", () => {
      const args = buildWranglerArgs("test-db", {
        isLocal: true,
        isRemote: false,
        configFile: "/path/to/wrangler.toml",
      })
      expect(args).toContain("--config")
      expect(args).toContain("/path/to/wrangler.toml")
    })
  })

  describe("argument parsing edge cases", () => {
    test("handles database name with dashes", () => {
      const parsed = parseArgs(["my-auth-database-v2", "--remote"])
      expect(parsed.dbName).toBe("my-auth-database-v2")
      expect(parsed.isRemote).toBe(true)
    })

    test("handles database name at different positions", () => {
      const parsed1 = parseArgs(["--local", "mydb", "--force"])
      expect(parsed1.dbName).toBe("mydb")

      const parsed2 = parseArgs(["mydb"])
      expect(parsed2.dbName).toBe("mydb")

      const parsed3 = parseArgs(["--remote", "--config", "file.toml", "mydb"])
      expect(parsed3.dbName).toBe("mydb")
    })

    test("last positional arg wins for database name", () => {
      // This might be unexpected behavior - testing current behavior
      const parsed = parseArgs(["db1", "db2"])
      expect(parsed.dbName).toBe("db2")
    })

    test("handles --seed overriding --no-seed", () => {
      const parsed = parseArgs(["--no-seed", "--seed"])
      expect(parsed.withSeed).toBe(true)
    })

    test("handles --no-seed after --seed", () => {
      const parsed = parseArgs(["--seed", "--no-seed"])
      expect(parsed.withSeed).toBe(false)
    })
  })

  describe("checksum consistency", () => {
    test("same SQL content produces same checksum", () => {
      const sql = `CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL
      );`
      const checksum1 = calculateChecksum(sql)
      const checksum2 = calculateChecksum(sql)
      expect(checksum1).toBe(checksum2)
    })

    test("different SQL produces different checksum", () => {
      const sql1 = "CREATE TABLE users (id TEXT);"
      const sql2 = "CREATE TABLE users (id TEXT, name TEXT);"
      expect(calculateChecksum(sql1)).not.toBe(calculateChecksum(sql2))
    })

    test("whitespace differences produce different checksums", () => {
      // This is expected behavior - checksums are content-sensitive
      const sql1 = "CREATE TABLE users (id TEXT);"
      const sql2 = "CREATE TABLE users ( id TEXT );"
      expect(calculateChecksum(sql1)).not.toBe(calculateChecksum(sql2))
    })
  })
})

describe("CLI parseArgs behavior documentation", () => {
  // These tests document the current behavior for edge cases
  // that might need to be handled differently in the future

  test("documents: unknown flags are ignored", () => {
    const parsed = parseArgs(["--unknown-flag", "mydb"])
    expect(parsed.dbName).toBe("mydb")
    // Unknown flags don't cause errors - they're just ignored
  })

  test("documents: --config without value leaves configFile undefined", () => {
    const parsed = parseArgs(["--config"])
    expect(parsed.configFile).toBeUndefined()
    // Note: The CLI wrapper (parseArgsWithValidation) handles this error case
  })

  test("documents: -c shorthand works", () => {
    const parsed = parseArgs(["-c", "./custom.toml"])
    expect(parsed.configFile).toBe("./custom.toml")
  })
})
