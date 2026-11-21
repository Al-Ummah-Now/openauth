/**
 * Escape a string literal type's value for the generated MDX reference docs.
 *
 * `*` and `:` are backslash-escaped so MDX doesn't read them as emphasis or
 * directives. The backslash itself is escaped first: otherwise a value that
 * already ends in `\` would swallow the escape we add (`\*` -> `\\*`), and the
 * markup would come back.
 */
export function escapeLiteralValue(value: string): string {
  return value.replace(/([\\*:])/g, "\\$1")
}
