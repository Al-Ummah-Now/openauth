import { expect, test, describe } from "bun:test"
import {
  calculateChecksum,
  stripJsonComments,
  extractDbNameFromJson,
  buildWranglerArgs,
  parseArgs,
  parseAppliedMigrationsOutput,
  buildRecordMigrationSql,
  buildVerifyMigrationSql,
  migrationRecordExistsInOutput,
} from "./cli-utils.js"

describe("calculateChecksum", () => {
  test("returns consistent hash for same content", () => {
    const content = "CREATE TABLE test (id TEXT);"
    const hash1 = calculateChecksum(content)
    const hash2 = calculateChecksum(content)
    expect(hash1).toBe(hash2)
  })

  test("returns different hash for different content", () => {
    const hash1 = calculateChecksum("content1")
    const hash2 = calculateChecksum("content2")
    expect(hash1).not.toBe(hash2)
  })

  test("returns 16 character hex string", () => {
    const hash = calculateChecksum("test content")
    expect(hash).toMatch(/^[a-f0-9]{16}$/)
  })

  test("handles empty string", () => {
    const hash = calculateChecksum("")
    expect(hash).toMatch(/^[a-f0-9]{16}$/)
  })

  test("handles unicode content", () => {
    const hash = calculateChecksum("unicode: \u00e9\u00e8\u00ea")
    expect(hash).toMatch(/^[a-f0-9]{16}$/)
  })
})

describe("stripJsonComments", () => {
  test("strips single-line comments", () => {
    const input = `{
      "key": "value" // this is a comment
    }`
    const result = stripJsonComments(input)
    expect(result).not.toContain("// this is a comment")
    expect(result).toContain('"key": "value"')
  })

  test("strips multi-line comments", () => {
    const input = `{
      /* this is
         a multi-line comment */
      "key": "value"
    }`
    const result = stripJsonComments(input)
    expect(result).not.toContain("/* this is")
    expect(result).not.toContain("a multi-line comment */")
    expect(result).toContain('"key": "value"')
  })

  test("handles content without comments", () => {
    const input = '{"key": "value"}'
    const result = stripJsonComments(input)
    expect(result).toBe(input)
  })

  test("handles empty string", () => {
    expect(stripJsonComments("")).toBe("")
  })

  test("preserves valid JSON structure", () => {
    const input = `{
      // comment
      "d1_databases": [
        /* block comment */
        { "database_name": "test-db" }
      ]
    }`
    const result = stripJsonComments(input)
    const parsed = JSON.parse(result)
    expect(parsed.d1_databases[0].database_name).toBe("test-db")
  })
})

describe("extractDbNameFromJson", () => {
  test("extracts database name from d1_databases array", () => {
    const config = {
      d1_databases: [{ database_name: "my-auth-db" }],
    }
    expect(extractDbNameFromJson(config)).toBe("my-auth-db")
  })

  test("returns first database when multiple exist", () => {
    const config = {
      d1_databases: [
        { database_name: "first-db" },
        { database_name: "second-db" },
      ],
    }
    expect(extractDbNameFromJson(config)).toBe("first-db")
  })

  test("returns null when d1_databases is missing", () => {
    expect(extractDbNameFromJson({})).toBeNull()
  })

  test("returns null when d1_databases is empty", () => {
    expect(extractDbNameFromJson({ d1_databases: [] })).toBeNull()
  })

  test("returns null when database_name is missing", () => {
    const config = {
      d1_databases: [{ binding: "DB" }],
    }
    expect(extractDbNameFromJson(config)).toBeNull()
  })

  test("returns null when d1_databases is not an array", () => {
    const config = {
      d1_databases: { database_name: "test" },
    }
    expect(extractDbNameFromJson(config)).toBeNull()
  })
})

describe("buildWranglerArgs", () => {
  test("builds basic args with database name", () => {
    const args = buildWranglerArgs("mydb", {
      isLocal: false,
      isRemote: false,
      isPreview: false,
    })
    expect(args).toEqual(["d1", "execute", "mydb"])
  })

  test("adds --local flag", () => {
    const args = buildWranglerArgs("mydb", {
      isLocal: true,
      isRemote: false,
      isPreview: false,
    })
    expect(args).toEqual(["d1", "execute", "mydb", "--local"])
  })

  test("adds --remote flag", () => {
    const args = buildWranglerArgs("mydb", {
      isLocal: false,
      isRemote: true,
      isPreview: false,
    })
    expect(args).toEqual(["d1", "execute", "mydb", "--remote"])
  })

  test("adds --preview flag", () => {
    const args = buildWranglerArgs("mydb", {
      isLocal: false,
      isRemote: false,
      isPreview: true,
    })
    expect(args).toEqual(["d1", "execute", "mydb", "--preview"])
  })

  test("adds --config flag with path", () => {
    const args = buildWranglerArgs("mydb", {
      isLocal: false,
      isRemote: false,
      isPreview: false,
      configFile: "./wrangler.toml",
    })
    expect(args).toEqual([
      "d1",
      "execute",
      "mydb",
      "--config",
      "./wrangler.toml",
    ])
  })

  test("combines multiple flags", () => {
    const args = buildWranglerArgs("mydb", {
      isLocal: true,
      isRemote: false,
      isPreview: false,
      configFile: "./custom.toml",
    })
    expect(args).toEqual([
      "d1",
      "execute",
      "mydb",
      "--local",
      "--config",
      "./custom.toml",
    ])
  })

  test("combines preview with config", () => {
    const args = buildWranglerArgs("mydb", {
      isLocal: false,
      isRemote: false,
      isPreview: true,
      configFile: "./custom.toml",
    })
    expect(args).toEqual([
      "d1",
      "execute",
      "mydb",
      "--preview",
      "--config",
      "./custom.toml",
    ])
  })
})

describe("parseArgs", () => {
  test("parses database name positional argument", () => {
    const result = parseArgs(["mydb"])
    expect(result.dbName).toBe("mydb")
  })

  test("parses --local flag", () => {
    const result = parseArgs(["--local"])
    expect(result.isLocal).toBe(true)
    expect(result.isRemote).toBe(false)
  })

  test("parses --remote flag", () => {
    const result = parseArgs(["--remote"])
    expect(result.isRemote).toBe(true)
    expect(result.isLocal).toBe(false)
  })

  test("parses --preview flag", () => {
    const result = parseArgs(["--preview"])
    expect(result.isPreview).toBe(true)
    expect(result.isLocal).toBe(false)
    expect(result.isRemote).toBe(false)
  })

  test("parses --no-seed flag", () => {
    const result = parseArgs(["--no-seed"])
    expect(result.withSeed).toBe(false)
  })

  test("parses --seed flag", () => {
    const result = parseArgs(["--no-seed", "--seed"])
    expect(result.withSeed).toBe(true)
  })

  test("parses --force flag", () => {
    const result = parseArgs(["--force"])
    expect(result.force).toBe(true)
  })

  test("parses --config flag with value", () => {
    const result = parseArgs(["--config", "./wrangler.toml"])
    expect(result.configFile).toBe("./wrangler.toml")
  })

  test("parses -c shorthand for config", () => {
    const result = parseArgs(["-c", "./custom.toml"])
    expect(result.configFile).toBe("./custom.toml")
  })

  test("parses complex argument combination", () => {
    const result = parseArgs([
      "my-auth-db",
      "--remote",
      "--no-seed",
      "--config",
      "./prod.toml",
      "--force",
    ])
    expect(result.dbName).toBe("my-auth-db")
    expect(result.isRemote).toBe(true)
    expect(result.isLocal).toBe(false)
    expect(result.withSeed).toBe(false)
    expect(result.configFile).toBe("./prod.toml")
    expect(result.force).toBe(true)
  })

  test("returns defaults for empty args", () => {
    const result = parseArgs([])
    expect(result.dbName).toBeUndefined()
    expect(result.isLocal).toBe(false)
    expect(result.isRemote).toBe(false)
    expect(result.withSeed).toBe(true)
    expect(result.force).toBe(false)
    expect(result.configFile).toBeUndefined()
  })

  test("ignores unknown flags", () => {
    const result = parseArgs(["--unknown", "mydb"])
    expect(result.dbName).toBe("mydb")
  })
})

describe("parseAppliedMigrationsOutput", () => {
  test("parses single migration from output", () => {
    const output = `{"name": "001_schema.sql", "applied_at": 1700000000000, "checksum": "abc123"}`
    const result = parseAppliedMigrationsOutput(output)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      name: "001_schema.sql",
      applied_at: 1700000000000,
      checksum: "abc123",
    })
  })

  test("parses multiple migrations from output", () => {
    const output = `
      {"name": "001_schema.sql", "applied_at": 1700000000000, "checksum": "abc123"}
      {"name": "002_seed.sql", "applied_at": 1700000001000, "checksum": "def456"}
    `
    const result = parseAppliedMigrationsOutput(output)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe("001_schema.sql")
    expect(result[1].name).toBe("002_seed.sql")
  })

  test("handles null checksum", () => {
    const output = `{"name": "001_schema.sql", "applied_at": 1700000000000, "checksum": null}`
    const result = parseAppliedMigrationsOutput(output)
    expect(result).toHaveLength(1)
    expect(result[0].checksum).toBeNull()
  })

  test("returns empty array for invalid output", () => {
    expect(parseAppliedMigrationsOutput("invalid")).toEqual([])
  })

  test("returns empty array for empty string", () => {
    expect(parseAppliedMigrationsOutput("")).toEqual([])
  })

  test("handles wrangler JSON wrapper", () => {
    const output = `[{"results": [{"name": "001_schema.sql", "applied_at": 1700000000000, "checksum": "abc"}]}]`
    const result = parseAppliedMigrationsOutput(output)
    expect(result).toHaveLength(1)
  })
})

describe("buildRecordMigrationSql", () => {
  test("builds INSERT statement with all fields", () => {
    const sql = buildRecordMigrationSql("002_seed.sql", "abc123", 1700000000000)
    expect(sql).toBe(
      "INSERT INTO _openauth_migrations (name, applied_at, checksum) VALUES ('002_seed.sql', 1700000000000, 'abc123')",
    )
  })

  test("uses current timestamp if not provided", () => {
    const before = Date.now()
    const sql = buildRecordMigrationSql("001_schema.sql", "xyz789")
    const after = Date.now()

    const match = sql.match(/VALUES \('001_schema\.sql', (\d+), 'xyz789'\)/)
    expect(match).not.toBeNull()
    const timestamp = parseInt(match![1])
    expect(timestamp).toBeGreaterThanOrEqual(before)
    expect(timestamp).toBeLessThanOrEqual(after)
  })
})

describe("buildVerifyMigrationSql", () => {
  test("builds SELECT statement for migration name", () => {
    const sql = buildVerifyMigrationSql("002_seed.sql")
    expect(sql).toBe(
      "SELECT name FROM _openauth_migrations WHERE name = '002_seed.sql'",
    )
  })
})

describe("migrationRecordExistsInOutput", () => {
  test("returns true when migration name is in output", () => {
    const output = `{"results": [{"name": "002_seed.sql"}]}`
    expect(migrationRecordExistsInOutput(output, "002_seed.sql")).toBe(true)
  })

  test("returns false when migration name is not in output", () => {
    const output = `{"results": []}`
    expect(migrationRecordExistsInOutput(output, "002_seed.sql")).toBe(false)
  })

  test("returns false for empty output", () => {
    expect(migrationRecordExistsInOutput("", "002_seed.sql")).toBe(false)
  })

  test("handles partial name matches correctly", () => {
    const output = `{"name": "002_seed.sql"}`
    expect(migrationRecordExistsInOutput(output, "002_seed")).toBe(true)
    expect(migrationRecordExistsInOutput(output, "003_other.sql")).toBe(false)
  })
})
