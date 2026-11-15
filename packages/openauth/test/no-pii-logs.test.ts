/**
 * Sign-in never writes the email, cookies or session ids to the console
 * (AlUmmahNowAuth#313): a password sign-in attempt, right or wrong, logs nothing
 * that holds the address, and the enterprise /authorize has no debug dump.
 */
import { expect, test, describe, afterEach, spyOn } from "bun:test"
import { readFileSync } from "node:fs"
import { object, string } from "valibot"
import { issuer } from "../src/issuer.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { PasswordProvider } from "../src/provider/password.js"
import { PasswordUI } from "../src/ui/password.js"

const subjects = createSubjects({ user: object({ email: string() }) })
const EMAIL = "private.person@example.com"

function createAuth() {
  return issuer({
    storage: MemoryStorage(),
    subjects,
    allow: async () => true,
    providers: {
      password: PasswordProvider(PasswordUI({ sendCode: async () => {} })),
    },
    success: async (ctx, value) => ctx.subject("user", { email: value.email }),
  })
}

const spies: Array<ReturnType<typeof spyOn>> = []
function captureConsole(): string[] {
  const lines: string[] = []
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    spies.push(
      spyOn(console, m).mockImplementation((...args: unknown[]) => {
        lines.push(
          args
            .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
            .join(" "),
        )
      }),
    )
  }
  return lines
}
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore()
})

describe("no personal data in sign-in logs (#313)", () => {
  test("a password sign-in attempt logs nothing holding the email", async () => {
    const auth = createAuth()
    const lines = captureConsole()
    const authorize = await auth.request(
      `https://auth.example.com/authorize?client_id=c&response_type=code&provider=password&redirect_uri=${encodeURIComponent("https://app.example.com/cb")}`,
    )
    const cookie = authorize.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ")
    await auth.request("https://auth.example.com/password/authorize", {
      method: "POST",
      headers: { cookie },
      body: new URLSearchParams({ email: EMAIL, password: "wrong-password" }),
    })
    expect(lines.join("\n")).not.toContain("private.person")
  })

  test("the enterprise issuer has no /authorize debug dump of cookies or session ids", () => {
    const src = readFileSync(
      new URL("../src/enterprise/issuer.ts", import.meta.url),
      "utf8",
    )
    expect(src).not.toContain('req.header("Cookie")?.substring')
    expect(src).not.toContain("[authorize] OIDC params")
  })
})
