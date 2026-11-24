import { expect, test } from "bun:test"
import rehypeSoftBreaks, { pieces } from "./rehype-soft-breaks"

test("long tokens break after _ and before /, short ones never", () => {
  expect(pieces("privilege_escalation_denied")).toEqual([
    "privilege_",
    "escalation_",
    "denied",
  ])
  expect(pieces("/users/:id/roles")).toEqual(["/users", "/:id", "/roles"])
  for (const short of ["start", "code", "a_b", "/roles/:id", "authorize"])
    expect(pieces(short)).toEqual([short])
})

test("only in table cells, and the text is unchanged", () => {
  const text = (value: string) => ({ type: "text", value })
  const cell = {
    type: "element",
    tagName: "td",
    children: [
      {
        type: "element",
        tagName: "code",
        children: [text("privilege_escalation_denied")],
      },
      text(" is refused on POST /users/:id/roles"),
    ],
  }
  const outside = {
    type: "element",
    tagName: "p",
    children: [text("privilege_escalation_denied")],
  }
  const tree = {
    type: "root",
    children: [
      outside,
      { type: "element", tagName: "table", children: [cell] },
    ],
  }
  rehypeSoftBreaks()(tree)
  const flat = (n: any): string =>
    n.type === "text"
      ? n.value
      : n.tagName === "wbr"
        ? "|"
        : (n.children ?? []).map(flat).join("")
  expect(flat(outside)).toBe("privilege_escalation_denied")
  expect(flat(cell)).toBe(
    "privilege_|escalation_|denied is refused on POST /users|/:id|/roles",
  )
})
