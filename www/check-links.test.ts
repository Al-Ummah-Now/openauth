import { expect, test } from "bun:test"
import { decode, problems } from "./check-links"

test("a missing page, a missing heading and a link without the base are found", () => {
  const files = new Map([
    [
      "docs/a/index.html",
      `<h2 id="here">x</h2><a href="/openauth/docs/b/">ok</a> <a href="/openauth/docs/b/#there">ok</a> <a class="x" href="#here">ok</a> <a href="https://example.com/x">ok</a> <a href="/openauth/favicon.svg">ok</a>
      <a href="/docs/b/">no base</a> <a href="/openauth/docs/c/">no page</a> <a href="/openauth/docs/b/#nope">no heading</a> <a href="#nope">no heading</a>`,
    ],
    ["docs/b/index.html", `<h2 id="there">x</h2>`],
  ])
  const exists = (f: string) => files.has(f) || f === "favicon.svg"
  expect(problems(files, exists, "/openauth")).toEqual([
    "docs/a/index.html: /docs/b/ leaves out /openauth",
    "docs/a/index.html: /openauth/docs/c/ does not exist",
    "docs/a/index.html: /openauth/docs/b/#nope has no such heading",
    "docs/a/index.html: #nope has no such heading",
  ])
})

test("entities are decoded once", () => {
  expect(decode("&amp;quot;")).toBe("&quot;")
  expect(decode("&amp;#39;&#38;amp;")).toBe("&#39;&amp;")
  expect(decode("a&amp;b &quot;c&#x27;")).toBe("a&b \"c'")
})
