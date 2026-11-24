/**
 * Fails the build when a page links to a page, file or heading of this site that
 * does not exist, or leaves out the base path. Runs on dist/ after `astro build`.
 */
import fs from "fs"
import path from "path"

const DIST = path.join(import.meta.dir, "dist")
const BASE = (process.env.BASE_PATH || "").replace(/\/+$/, "")

export function problems(
  files: Map<string, string>,
  exists: (file: string) => boolean,
  base: string,
): string[] {
  const ids = (html: string) =>
    new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => decode(m[1]!)))
  const out: string[] = []
  for (const [page, html] of files) {
    for (const [, raw] of html.matchAll(/<a\s[^>]*?href="([^"]*)"/g)) {
      const href = decode(raw!)
      if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href) || href === "") continue
      const [target = "", hash] = href.split("#")
      let file = page
      if (target) {
        if (!target.startsWith("/")) continue
        if (base && target !== base && !target.startsWith(`${base}/`)) {
          out.push(`${page}: ${href} leaves out ${base}`)
          continue
        }
        const rest = decodeURIComponent(target.slice(base.length)).replace(
          /^\/+/,
          "",
        )
        file = /\.[a-z0-9]+$/i.test(rest)
          ? rest
          : path.posix.join(rest, "index.html")
        if (!exists(file)) {
          out.push(`${page}: ${href} does not exist`)
          continue
        }
      }
      const target_ = files.get(file)
      if (hash && target_ && !ids(target_).has(decodeURIComponent(hash)))
        out.push(`${page}: ${href} has no such heading`)
    }
  }
  return [...new Set(out)]
}

const decode = (s: string) =>
  s
    .replace(/&#38;|&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')

if (import.meta.main) {
  const files = new Map<string, string>()
  for (const f of fs.readdirSync(DIST, { recursive: true }) as string[])
    if (f.endsWith(".html"))
      files.set(
        f.split(path.sep).join("/"),
        fs.readFileSync(path.join(DIST, f), "utf8"),
      )
  const found = problems(files, (f) => fs.existsSync(path.join(DIST, f)), BASE)
  for (const p of found) console.error(p)
  if (found.length) process.exit(1)
  console.log(`links: ${files.size} pages, none broken`)
}
