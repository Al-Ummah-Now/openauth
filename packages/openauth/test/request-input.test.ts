import { describe, expect, test } from "bun:test"
import { object, string } from "valibot"
import { issuer } from "../src/issuer.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { PasswordProvider } from "../src/provider/password.js"
import { PasswordUI } from "../src/ui/password.js"
import {
  TOKEN_LIMITS,
  TOKEN_LOOKUP_LIMITS,
  validFormFields,
  validScopeString,
} from "../src/request-input.js"

const root = "https://auth.example.com"
const subjects = createSubjects({ user: object({ email: string() }) })

function auth(allow: boolean, allowChangeRedirect?: (uri: string) => boolean) {
  return issuer({
    issuer: root,
    storage: MemoryStorage(),
    subjects,
    allow: async () => allow,
    providers: {
      password: PasswordProvider({
        ...PasswordUI({ sendCode: async () => {} }),
        allowChangeRedirect,
        change: async (_req, state) =>
          Response.json({ redirect: state.redirect }),
      }),
    },
    success: async (ctx, value) => ctx.subject("user", { email: value.email }),
  })
}

describe("issuer input boundaries", () => {
  test("a rejected authorization URI does not receive a redirect", async () => {
    const callback = "https://app.example.com/callback"
    const params = new URLSearchParams({
      redirect_uri: callback,
      client_id: "client",
      response_type: "code",
    })
    const result = await auth(false).request(`${root}/authorize?${params}`)
    expect(result.status).toBe(400)
    expect(result.headers.get("location")).toBeNull()
  })

  test("only configured providers can be selected", async () => {
    const params = new URLSearchParams({
      redirect_uri: "https://app.example.com/callback",
      client_id: "client",
      response_type: "code",
      provider: "unregistered",
    })
    const result = await auth(true).request(`${root}/authorize?${params}`)
    const destination = new URL(result.headers.get("location")!)
    expect(destination.origin).toBe("https://app.example.com")
    expect(destination.searchParams.get("error")).toBe("invalid_request")
  })

  test("password changes keep local and explicitly approved return targets", async () => {
    const exact = "https://app.example.com/finish"
    const requestFor = (target: string) =>
      `${root}/password/change?${new URLSearchParams({ redirect_uri: target })}`
    const restricted = await auth(true).request(requestFor(exact))
    expect(await restricted.json()).toEqual({
      redirect: `${root}/password/authorize`,
    })
    const configured = await auth(true, (uri) => uri === exact).request(
      requestFor(exact),
    )
    expect(await configured.json()).toEqual({ redirect: exact })
    const local = await auth(true).request(requestFor("/login?lang=ar"))
    expect(await local.json()).toEqual({ redirect: "/login?lang=ar" })
  })

  test("token form fields and scope strings are checked before use", () => {
    const form = new FormData()
    form.set("refresh_token", "user:code")
    expect(validFormFields(form, TOKEN_LIMITS)).toBe(true)
    form.append("refresh_token", "extra")
    expect(validFormFields(form, TOKEN_LIMITS)).toBe(false)
    form.set("refresh_token", "user::code")
    expect(validFormFields(form, TOKEN_LIMITS)).toBe(false)
    form.set("token", "user:code")
    expect(validFormFields(form, TOKEN_LOOKUP_LIMITS)).toBe(true)
    form.append("token", "another")
    expect(validFormFields(form, TOKEN_LOOKUP_LIMITS)).toBe(false)
    expect(validScopeString("read:public write:private")).toBe(true)
    expect(validScopeString("read:public\nwrite:private")).toBe(false)
  })
})
