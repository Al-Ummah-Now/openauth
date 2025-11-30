/**
 * SQL Injection Prevention - Table Name Validation
 *
 * Prevents SQL injection attacks by validating table names against an allow-list.
 * CRITICAL SECURITY: Only allows predefined, safe table names.
 *
 * @packageDocumentation
 */

/**
 * SQL Validator for preventing SQL injection via table name validation
 *
 * This validator prevents SQL injection attacks by ensuring that only
 * predefined, safe table names can be used in SQL queries. Any attempt
 * to use an invalid table name will result in an error.
 *
 * @example
 * ```typescript
 * // Valid usage
 * const tableName = SQLValidator.validateTableName('oauth_clients')
 * // tableName = 'oauth_clients'
 *
 * // Invalid usage - throws error
 * const malicious = SQLValidator.validateTableName('oauth_clients; DROP TABLE users; --')
 * // throws Error: Invalid table name specified
 * ```
 */
export class SQLValidator {
  /**
   * Allow-list of valid table names
   *
   * SECURITY: Only tables in this set can be used in SQL queries.
   * Any attempt to use a table name not in this set will be rejected.
   */
  private static readonly ALLOWED_TABLES = new Set([
    "oauth_clients",
    "token_usage",
    "jwt_keys",
  ])

  /**
   * Validate table name against allow-list
   *
   * @param tableName - The table name to validate
   * @returns The validated table name
   * @throws Error if table name is not in allow-list
   *
   * @example
   * ```typescript
   * // Valid
   * SQLValidator.validateTableName('oauth_clients') // returns 'oauth_clients'
   *
   * // Invalid - SQL injection attempt
   * SQLValidator.validateTableName('oauth_clients; DROP TABLE users; --')
   * // throws Error: Invalid table name specified
   *
   * // Invalid - union injection
   * SQLValidator.validateTableName('oauth_clients UNION SELECT * FROM passwords')
   * // throws Error: Invalid table name specified
   * ```
   */
  static validateTableName(tableName: string): string {
    if (!this.ALLOWED_TABLES.has(tableName)) {
      console.error(
        `SECURITY VIOLATION: Invalid table name attempted: ${tableName}`,
      )
      throw new Error("Invalid table name specified")
    }
    return tableName
  }

  /**
   * Check if a table name is valid without throwing
   *
   * @param tableName - The table name to check
   * @returns true if valid, false otherwise
   *
   * @example
   * ```typescript
   * if (SQLValidator.isValidTableName('oauth_clients')) {
   *   // Safe to use
   * }
   * ```
   */
  static isValidTableName(tableName: string): boolean {
    return this.ALLOWED_TABLES.has(tableName)
  }

  /**
   * Get all allowed table names
   *
   * @returns Array of allowed table names
   */
  static getAllowedTables(): string[] {
    return Array.from(this.ALLOWED_TABLES)
  }
}
