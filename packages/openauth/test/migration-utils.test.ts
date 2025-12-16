import { describe, expect, test } from "bun:test"
import {
  parseSchemaChanges,
  isAlreadyAppliedError,
  columnExistsQuery,
  tableExistsQuery,
  indexExistsQuery,
  calculateChecksum,
} from "../src/migrations/utils.js"

describe("parseSchemaChanges", () => {
  describe("ALTER TABLE ADD COLUMN", () => {
    test("detects simple ADD COLUMN", () => {
      const sql = "ALTER TABLE users ADD COLUMN email TEXT"
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual({
        type: "add_column",
        table: "users",
        column: "email",
      })
    })

    test("detects ADD COLUMN without COLUMN keyword", () => {
      const sql = "ALTER TABLE users ADD email TEXT"
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual({
        type: "add_column",
        table: "users",
        column: "email",
      })
    })

    test("detects multiple ADD COLUMN statements", () => {
      const sql = `
        ALTER TABLE users ADD COLUMN email TEXT;
        ALTER TABLE users ADD COLUMN name TEXT;
        ALTER TABLE posts ADD COLUMN title TEXT;
      `
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(3)
      expect(changes[0].column).toBe("email")
      expect(changes[1].column).toBe("name")
      expect(changes[2].table).toBe("posts")
    })

    test("handles case insensitivity", () => {
      const sql = "alter table USERS add column EMAIL text"
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(1)
      expect(changes[0].table).toBe("USERS")
      expect(changes[0].column).toBe("EMAIL")
    })

    test("handles extra whitespace", () => {
      const sql = "ALTER   TABLE   users   ADD   COLUMN   email   TEXT"
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(1)
      expect(changes[0].column).toBe("email")
    })
  })

  describe("ALTER TABLE DROP COLUMN", () => {
    test("detects DROP COLUMN", () => {
      const sql = "ALTER TABLE users DROP COLUMN legacy_field"
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual({
        type: "drop_column",
        table: "users",
        column: "legacy_field",
      })
    })

    test("detects DROP without COLUMN keyword", () => {
      const sql = "ALTER TABLE users DROP legacy_field"
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(1)
      expect(changes[0].type).toBe("drop_column")
    })
  })

  describe("CREATE TABLE", () => {
    test("detects CREATE TABLE without IF NOT EXISTS", () => {
      const sql = "CREATE TABLE users (id TEXT PRIMARY KEY)"
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual({
        type: "create_table",
        table: "users",
      })
    })

    test("ignores CREATE TABLE IF NOT EXISTS (already idempotent)", () => {
      const sql = "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY)"
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(0)
    })

    test("handles case insensitivity for IF NOT EXISTS", () => {
      const sql = "CREATE TABLE if not exists users (id TEXT)"
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(0)
    })
  })

  describe("DROP TABLE", () => {
    test("detects DROP TABLE without IF EXISTS", () => {
      const sql = "DROP TABLE legacy_users"
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual({
        type: "drop_table",
        table: "legacy_users",
      })
    })

    test("ignores DROP TABLE IF EXISTS (already idempotent)", () => {
      const sql = "DROP TABLE IF EXISTS legacy_users"
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(0)
    })
  })

  describe("CREATE INDEX", () => {
    test("detects CREATE INDEX without IF NOT EXISTS", () => {
      const sql = "CREATE INDEX idx_users_email ON users(email)"
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual({
        type: "create_index",
        table: "users",
        index: "idx_users_email",
      })
    })

    test("detects CREATE UNIQUE INDEX", () => {
      const sql = "CREATE UNIQUE INDEX idx_users_email ON users(email)"
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(1)
      expect(changes[0].type).toBe("create_index")
      expect(changes[0].index).toBe("idx_users_email")
    })

    test("ignores CREATE INDEX IF NOT EXISTS (already idempotent)", () => {
      const sql = "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)"
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(0)
    })

    test("ignores CREATE UNIQUE INDEX IF NOT EXISTS", () => {
      const sql =
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)"
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(0)
    })
  })

  describe("mixed migrations", () => {
    test("detects all change types in a complex migration", () => {
      const sql = `
        -- Create new table
        CREATE TABLE audit_log (id TEXT PRIMARY KEY);

        -- Add column to existing table
        ALTER TABLE users ADD COLUMN last_login INTEGER;

        -- Create index (idempotent - should be ignored)
        CREATE INDEX IF NOT EXISTS idx_audit ON audit_log(id);

        -- Create non-idempotent index
        CREATE INDEX idx_users_login ON users(last_login);

        -- Drop old table
        DROP TABLE IF EXISTS old_sessions;
        DROP TABLE legacy_data;
      `
      const changes = parseSchemaChanges(sql)

      expect(changes).toHaveLength(4)

      expect(changes.find((c) => c.type === "create_table")?.table).toBe(
        "audit_log",
      )
      expect(changes.find((c) => c.type === "add_column")?.column).toBe(
        "last_login",
      )
      expect(changes.find((c) => c.type === "create_index")?.index).toBe(
        "idx_users_login",
      )
      expect(changes.find((c) => c.type === "drop_table")?.table).toBe(
        "legacy_data",
      )
    })

    test("returns empty array for fully idempotent migration", () => {
      const sql = `
        CREATE TABLE IF NOT EXISTS users (id TEXT);
        CREATE INDEX IF NOT EXISTS idx_users ON users(id);
        DROP TABLE IF EXISTS temp;
      `
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(0)
    })

    test("returns empty array for data-only migration", () => {
      const sql = `
        INSERT INTO users (id, email) VALUES ('1', 'test@test.com');
        UPDATE users SET email = 'new@test.com' WHERE id = '1';
        DELETE FROM sessions WHERE expired = 1;
      `
      const changes = parseSchemaChanges(sql)
      expect(changes).toHaveLength(0)
    })
  })
})

describe("isAlreadyAppliedError", () => {
  test("detects duplicate column name error", () => {
    expect(isAlreadyAppliedError("duplicate column name: email")).toBe(true)
    expect(
      isAlreadyAppliedError("SQLITE_ERROR: duplicate column name: foo"),
    ).toBe(true)
  })

  test("detects column already exists error", () => {
    expect(isAlreadyAppliedError("column email already exists")).toBe(true)
  })

  test("detects table already exists error", () => {
    expect(isAlreadyAppliedError("table users already exists")).toBe(true)
    expect(
      isAlreadyAppliedError("SQLITE_ERROR: table users already exists"),
    ).toBe(true)
  })

  test("detects index already exists error", () => {
    expect(isAlreadyAppliedError("index idx_users_email already exists")).toBe(
      true,
    )
  })

  test("returns false for other errors", () => {
    expect(isAlreadyAppliedError("syntax error")).toBe(false)
    expect(isAlreadyAppliedError("no such table: users")).toBe(false)
    expect(isAlreadyAppliedError("constraint failed")).toBe(false)
    expect(isAlreadyAppliedError("foreign key mismatch")).toBe(false)
  })

  test("handles case insensitivity", () => {
    expect(isAlreadyAppliedError("DUPLICATE COLUMN NAME: EMAIL")).toBe(true)
    expect(isAlreadyAppliedError("Table Users Already Exists")).toBe(true)
  })
})

describe("SQL query generators", () => {
  describe("columnExistsQuery", () => {
    test("generates correct pragma query", () => {
      const query = columnExistsQuery("users", "email")
      expect(query).toBe(
        "SELECT name FROM pragma_table_info('users') WHERE name = 'email'",
      )
    })

    test("handles different table and column names", () => {
      const query = columnExistsQuery("rbac_roles", "tenant_id")
      expect(query).toContain("pragma_table_info('rbac_roles')")
      expect(query).toContain("name = 'tenant_id'")
    })

    test("rejects invalid table names", () => {
      expect(() => columnExistsQuery("users; DROP TABLE", "email")).toThrow(
        "Invalid table name",
      )
      expect(() => columnExistsQuery("users'--", "email")).toThrow(
        "Invalid table name",
      )
    })

    test("rejects invalid column names", () => {
      expect(() => columnExistsQuery("users", "email; --")).toThrow(
        "Invalid column name",
      )
      expect(() => columnExistsQuery("users", "col'")).toThrow(
        "Invalid column name",
      )
    })
  })

  describe("tableExistsQuery", () => {
    test("generates correct sqlite_master query", () => {
      const query = tableExistsQuery("users")
      expect(query).toBe(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
      )
    })

    test("rejects invalid table names", () => {
      expect(() => tableExistsQuery("users; DROP TABLE x")).toThrow(
        "Invalid table name",
      )
      expect(() => tableExistsQuery("users'--")).toThrow("Invalid table name")
    })
  })

  describe("indexExistsQuery", () => {
    test("generates correct sqlite_master query for index", () => {
      const query = indexExistsQuery("idx_users_email")
      expect(query).toBe(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_users_email'",
      )
    })

    test("rejects invalid index names", () => {
      expect(() => indexExistsQuery("idx; DROP INDEX")).toThrow(
        "Invalid index name",
      )
      expect(() => indexExistsQuery("idx'--")).toThrow("Invalid index name")
    })
  })
})

describe("calculateChecksum", () => {
  test("returns consistent hash for same content", () => {
    const content = "ALTER TABLE users ADD COLUMN email TEXT"
    const hash1 = calculateChecksum(content)
    const hash2 = calculateChecksum(content)
    expect(hash1).toBe(hash2)
  })

  test("returns different hash for different content", () => {
    const hash1 = calculateChecksum("ALTER TABLE users ADD COLUMN email TEXT")
    const hash2 = calculateChecksum("ALTER TABLE users ADD COLUMN name TEXT")
    expect(hash1).not.toBe(hash2)
  })

  test("returns 16 character hex string", () => {
    const hash = calculateChecksum("test content")
    expect(hash).toHaveLength(16)
    expect(hash).toMatch(/^[a-f0-9]{16}$/)
  })

  test("is sensitive to whitespace", () => {
    const hash1 = calculateChecksum("SELECT 1")
    const hash2 = calculateChecksum("SELECT  1")
    expect(hash1).not.toBe(hash2)
  })
})
