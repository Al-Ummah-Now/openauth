import { expect, test } from "bun:test"
import rehypeBase, { withBase } from "./rehype-base"

test("root-relative addresses get the base once, others are left alone", () => {
  expect(withBase("/docs/client", "/openauth")).toBe("/openauth/docs/client")
  expect(withBase("/", "/openauth")).toBe("/openauth/")
  expect(withBase("/openauth/docs/", "/openauth")).toBe("/openauth/docs/")
  expect(withBase("/openauthjs", "/openauth")).toBe("/openauth/openauthjs")
  for (const url of [
    "#a",
    "docs/x",
    "//cdn.example.com/x",
    "https://example.com/docs",
    undefined,
  ])
    expect(withBase(url, "/openauth")).toBe(url as never)
  expect(withBase("/docs/client", "")).toBe("/docs/client")
})

test("links and images of the tree, in markdown and in JSX", () => {
  const tree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "a",
        properties: { href: "/docs/a" },
        children: [
          { type: "element", tagName: "img", properties: { src: "/b.png" } },
        ],
      },
      {
        type: "mdxJsxFlowElement",
        name: "a",
        attributes: [
          { type: "mdxJsxAttribute", name: "href", value: "/docs/c" },
        ],
      },
    ],
  }
  rehypeBase({ base: "/openauth/" })(tree)
  expect(JSON.stringify(tree).match(/\/openauth\/[\w./]+/g)).toEqual([
    "/openauth/docs/a",
    "/openauth/b.png",
    "/openauth/docs/c",
  ])
})
