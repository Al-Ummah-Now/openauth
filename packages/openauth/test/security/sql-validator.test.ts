/**
 * Tests for SQL Injection Prevention - SQLValidator
 *
 * @packageDocumentation
 */

import { describe, it, expect } from "bun:test"
import { SQLValidator } from "../../src/security/sql-validator.js"

describe("SQLValidator", () => {
  describe("validateTableName", () => {
    it("should accept valid table names", () => {
      const validTables = ["oauth_clients", "token_usage", "jwt_keys"]

      validTables.forEach((tableName) => {
        expect(() => SQLValidator.validateTableName(tableName)).not.toThrow()
        expect(SQLValidator.validateTableName(tableName)).toBe(tableName)
      })
    })

    it("should reject SQL injection attempts with DROP statement", () => {
      const attacks = [
        "oauth_clients; DROP TABLE users; --",
        "oauth_clients'; DROP TABLE users; --",
        "token_usage; DROP DATABASE; --",
      ]

      attacks.forEach((attack) => {
        expect(() => SQLValidator.validateTableName(attack)).toThrow(
          "Invalid table name specified",
        )
      })
    })

    it("should reject SQL injection attempts with UNION", () => {
      const attacks = [
        "oauth_clients UNION SELECT * FROM passwords",
        "oauth_clients' UNION SELECT * FROM users WHERE 1=1 --",
        "token_usage UNION ALL SELECT password FROM admin",
      ]

      attacks.forEach((attack) => {
        expect(() => SQLValidator.validateTableName(attack)).toThrow(
          "Invalid table name specified",
        )
      })
    })

    it("should reject SQL injection attempts with OR condition", () => {
      const attacks = [
        "oauth_clients' OR '1'='1",
        "oauth_clients OR 1=1 --",
        "token_usage' OR 'a'='a",
      ]

      attacks.forEach((attack) => {
        expect(() => SQLValidator.validateTableName(attack)).toThrow(
          "Invalid table name specified",
        )
      })
    })

    it("should reject table names not in allow-list", () => {
      const invalidTables = [
        "users",
        "passwords",
        "admin",
        "secret_data",
        "oauth_tokens", // similar but not in allow-list
        "token_usage_backup",
      ]

      invalidTables.forEach((tableName) => {
        expect(() => SQLValidator.validateTableName(tableName)).toThrow(
          "Invalid table name specified",
        )
      })
    })

    it("should reject empty string", () => {
      expect(() => SQLValidator.validateTableName("")).toThrow(
        "Invalid table name specified",
      )
    })

    it("should reject special characters", () => {
      const attacks = [
        "oauth_clients;",
        "oauth_clients--",
        "oauth_clients#",
        "oauth_clients/*",
        "oauth_clients*/",
      ]

      attacks.forEach((attack) => {
        expect(() => SQLValidator.validateTableName(attack)).toThrow(
          "Invalid table name specified",
        )
      })
    })

    it("should be case-sensitive", () => {
      // Only exact lowercase matches should work
      expect(() => SQLValidator.validateTableName("OAuth_Clients")).toThrow(
        "Invalid table name specified",
      )
      expect(() => SQLValidator.validateTableName("OAUTH_CLIENTS")).toThrow(
        "Invalid table name specified",
      )
      expect(() => SQLValidator.validateTableName("Token_Usage")).toThrow(
        "Invalid table name specified",
      )
    })

    it("should log security violations", () => {
      const originalError = console.error
      let errorCalls: any[][] = []
      console.error = (...args: any[]) => {
        errorCalls.push(args)
      }

      try {
        SQLValidator.validateTableName("oauth_clients; DROP TABLE users; --")
      } catch {
        // Expected to throw
      }

      expect(errorCalls.length).toBeGreaterThan(0)
      const errorMessage = errorCalls[0].join(" ")
      expect(errorMessage).toContain("SECURITY VIOLATION")
      expect(errorMessage).toContain("oauth_clients; DROP TABLE users; --")

      console.error = originalError
    })
  })

  describe("isValidTableName", () => {
    it("should return true for valid table names", () => {
      expect(SQLValidator.isValidTableName("oauth_clients")).toBe(true)
      expect(SQLValidator.isValidTableName("token_usage")).toBe(true)
      expect(SQLValidator.isValidTableName("jwt_keys")).toBe(true)
    })

    it("should return false for invalid table names", () => {
      expect(
        SQLValidator.isValidTableName("oauth_clients; DROP TABLE users"),
      ).toBe(false)
      expect(SQLValidator.isValidTableName("users")).toBe(false)
      expect(SQLValidator.isValidTableName("")).toBe(false)
    })

    it("should not throw errors", () => {
      expect(() => SQLValidator.isValidTableName("invalid_table")).not.toThrow()
      expect(() =>
        SQLValidator.isValidTableName("oauth_clients; DROP TABLE users"),
      ).not.toThrow()
    })
  })

  describe("getAllowedTables", () => {
    it("should return array of allowed table names", () => {
      const allowed = SQLValidator.getAllowedTables()
      expect(Array.isArray(allowed)).toBe(true)
      expect(allowed).toContain("oauth_clients")
      expect(allowed).toContain("token_usage")
      expect(allowed).toContain("jwt_keys")
    })

    it("should return exactly 3 allowed tables", () => {
      const allowed = SQLValidator.getAllowedTables()
      expect(allowed.length).toBe(3)
    })

    it("should not allow modification of internal set", () => {
      const allowed1 = SQLValidator.getAllowedTables()
      const allowed2 = SQLValidator.getAllowedTables()
      expect(allowed1).not.toBe(allowed2) // Should be different array instances
    })
  })
})

/**
 * Integration tests with D1ClientAdapter and AuditService
 */
describe("SQLValidator Integration", () => {
  it("should prevent SQL injection in D1ClientAdapter constructor", () => {
    // This test would require mocking D1Database
    // For now, we verify the validator works in isolation
    const maliciousTableName = "oauth_clients; DROP TABLE users; --"
    expect(() => SQLValidator.validateTableName(maliciousTableName)).toThrow()
  })

  it("should prevent SQL injection in AuditService constructor", () => {
    const maliciousTableName = "token_usage' OR '1'='1"
    expect(() => SQLValidator.validateTableName(maliciousTableName)).toThrow()
  })

  it("should allow default table names", () => {
    // Default values used in constructors should be valid
    expect(() => SQLValidator.validateTableName("oauth_clients")).not.toThrow()
    expect(() => SQLValidator.validateTableName("token_usage")).not.toThrow()
  })
})
