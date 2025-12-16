/**
 * Migration utilities for schema change detection and validation
 * @packageDocumentation
 */

/**
 * Schema change types that can be detected and checked
 */
export interface SchemaChange {
  type:
    | "add_column"
    | "create_table"
    | "create_index"
    | "drop_table"
    | "drop_column"
  table: string
  column?: string
  index?: string
}

/**
 * Parse SQL to detect schema changes
 * Only detects non-idempotent statements (those without IF [NOT] EXISTS)
 */
export function parseSchemaChanges(sql: string): SchemaChange[] {
  const changes: SchemaChange[] = []

  // ALTER TABLE ... ADD COLUMN
  const addColumnRegex = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+(?:COLUMN\s+)?(\w+)/gi
  let match
  while ((match = addColumnRegex.exec(sql)) !== null) {
    changes.push({ type: "add_column", table: match[1], column: match[2] })
  }

  // ALTER TABLE ... DROP COLUMN
  const dropColumnRegex = /ALTER\s+TABLE\s+(\w+)\s+DROP\s+(?:COLUMN\s+)?(\w+)/gi
  while ((match = dropColumnRegex.exec(sql)) !== null) {
    changes.push({ type: "drop_column", table: match[1], column: match[2] })
  }

  // CREATE TABLE (without IF NOT EXISTS - those are always safe)
  const createTableRegex = /CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\s+)(\w+)/gi
  while ((match = createTableRegex.exec(sql)) !== null) {
    changes.push({ type: "create_table", table: match[1] })
  }

  // DROP TABLE (without IF EXISTS)
  const dropTableRegex = /DROP\s+TABLE\s+(?!IF\s+EXISTS\s+)(\w+)/gi
  while ((match = dropTableRegex.exec(sql)) !== null) {
    changes.push({ type: "drop_table", table: match[1] })
  }

  // CREATE INDEX (without IF NOT EXISTS)
  const createIndexRegex =
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS\s+)(\w+)\s+ON\s+(\w+)/gi
  while ((match = createIndexRegex.exec(sql)) !== null) {
    changes.push({ type: "create_index", table: match[2], index: match[1] })
  }

  return changes
}

/**
 * Check if an error indicates the migration was already applied
 */
export function isAlreadyAppliedError(error: string): boolean {
  const alreadyAppliedPatterns = [
    /duplicate column name/i,
    /column .* already exists/i,
    /table .* already exists/i,
    /index .* already exists/i,
    /SQLITE_ERROR.*already exists/i,
  ]
  return alreadyAppliedPatterns.some((pattern) => pattern.test(error))
}

/**
 * Generate SQL to check if a column exists
 */
export function columnExistsQuery(table: string, column: string): string {
  return `SELECT name FROM pragma_table_info('${table}') WHERE name = '${column}'`
}

/**
 * Generate SQL to check if a table exists
 */
export function tableExistsQuery(table: string): string {
  return `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`
}

/**
 * Generate SQL to check if an index exists
 */
export function indexExistsQuery(index: string): string {
  return `SELECT name FROM sqlite_master WHERE type='index' AND name='${index}'`
}

/**
 * Calculate SHA-256 checksum (first 16 chars)
 */
export function calculateChecksum(content: string): string {
  // Note: In Node/Bun, use crypto.createHash
  // This is a simplified version for testing
  const { createHash } = require("crypto")
  return createHash("sha256").update(content).digest("hex").substring(0, 16)
}
