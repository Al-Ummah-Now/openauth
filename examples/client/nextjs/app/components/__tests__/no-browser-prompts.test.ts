/**
 * Guard: the example UI must never use the browser's blocking prompts.
 *
 * Confirmations use the in-app <ConfirmDialog>; notices render inline.
 * `window.alert/confirm/prompt` and `beforeunload` handlers are not allowed.
 */

import { expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const APP_DIR = join(import.meta.dir, "..", "..")
const SOURCE = /\.(tsx?|jsx?)$/
const FORBIDDEN = [
  /(?<![\w.$])(?:window\.)?(?:alert|confirm|prompt)\s*\(/,
  /beforeunload/,
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return name === "__tests__" || name === "node_modules"
        ? []
        : sourceFiles(path)
    }
    return SOURCE.test(name) ? [path] : []
  })
}

test("no window.alert/confirm/prompt or beforeunload in the example app", () => {
  const offenders: string[] = []
  for (const file of sourceFiles(APP_DIR)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (FORBIDDEN.some((re) => re.test(line))) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`)
        }
      })
  }
  expect(offenders).toEqual([])
})

test("account switcher confirms sign-out with the in-app dialog", () => {
  const source = readFileSync(
    join(import.meta.dir, "..", "account-switcher.tsx"),
    "utf8",
  )
  expect(source).toContain("<ConfirmDialog")
  expect(source).toContain('setPendingSignOut({ kind: "all" })')
})
