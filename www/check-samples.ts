/**
 * Type-checks the TypeScript samples of the "In this fork" pages against the
 * library's own source, so a renamed option or method fails CI. Needs the
 * repository's dependencies (`bun install`).
 */
import fs from "fs"
import path from "path"
import ts from "typescript"

const ROOT = path.join(import.meta.dir, "..")
const PAGES = path.join(import.meta.dir, "src/content/docs/docs/fork")
const SRC = path.join(ROOT, "packages/openauth/src")

/** What the samples leave out: the reader's own database, helpers and values. */
const READER = `
declare const env: { AUTH_DB: any }
declare const db: any
declare const storage: import("@al-ummah-now/openauth/storage/storage").StorageAdapter
declare const tokens: { access: string; refresh: string }
declare const user: { id: string; email: string }
declare const response: any
declare const challenge: string
declare function show(code: string, uri: string): void
declare function save(tokens: { access: string; refresh: string }): void
declare function isDue(key: { id: string; created: number }): boolean
declare const process: { env: Record<string, string | undefined> }
`

/**
 * A sample that lists only the options it is about ends them with "// ...". The
 * required rest is typed, so the options it does list are still checked.
 */
function rest(code: string): string {
  const fields = ["providers", "subjects", "success"].filter(
    (f) => !new RegExp(`^  ${f}:`, "m").test(code),
  )
  return `...({} as { ${fields.map((f) => `${f}: any`).join("; ")} }),`
}

export function samples(page: string): string[] {
  return [...page.matchAll(/^```ts[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1]!)
}

export function check(dir: string, names: string[]): string[] {
  const options: ts.CompilerOptions = {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: "hono/jsx",
    lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: [],
    paths: {
      "@al-ummah-now/openauth": [path.join(SRC, "index.ts")],
      "@al-ummah-now/openauth/*": [path.join(SRC, "*")],
    },
  }
  const reader = path.join(dir, "reader.d.ts")
  fs.writeFileSync(reader, READER)
  const program = ts.createProgram([reader, ...names], options)
  return names.flatMap((name) =>
    ts
      .getPreEmitDiagnostics(program, program.getSourceFile(name))
      .filter((d) => d.file?.fileName === name)
      .map(
        (d) =>
          `${path.relative(dir, name)}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`,
      ),
  )
}

export function write(dir: string, page: string, text: string): string[] {
  return samples(text).map((code, i) => {
    const file = path.join(dir, `${page}-${i + 1}.ts`)
    fs.writeFileSync(
      file,
      `${code.replace(/^\s*\/\/ \.\.\.$/gm, rest(code))}\nexport {}\n`,
    )
    return file
  })
}

if (import.meta.main) {
  const dir = fs.mkdtempSync(path.join(ROOT, "packages/openauth/.samples-"))
  try {
    const files = fs
      .readdirSync(PAGES)
      .flatMap((f) =>
        write(
          dir,
          path.parse(f).name,
          fs.readFileSync(path.join(PAGES, f), "utf8"),
        ),
      )
    const found = check(dir, files)
    for (const f of found) console.error(f)
    if (found.length || !files.length) process.exitCode = 1
    else console.log(`samples: ${files.length} type-check`)
  } finally {
    fs.rmSync(dir, { recursive: true })
  }
}
