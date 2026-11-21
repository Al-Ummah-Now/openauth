import { describe, expect, test } from "bun:test"
import { escapeLiteralValue } from "./mdx-escape"

describe("escapeLiteralValue", () => {
  test("escapes MDX emphasis and directive characters", () => {
    expect(escapeLiteralValue("a*b:c")).toBe("a\\*b\\:c")
  })

  test("escapes backslashes so an existing one can't cancel an added escape", () => {
    expect(escapeLiteralValue("\\*")).toBe("\\\\\\*")
    expect(escapeLiteralValue("C:\\path\\")).toBe("C\\:\\\\path\\\\")
  })

  test("leaves plain values alone", () => {
    expect(escapeLiteralValue("arm64")).toBe("arm64")
  })
})
