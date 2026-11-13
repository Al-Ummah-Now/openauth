/**
 * The `__session` SSO cookie is `Secure` on every host except a localhost issuer.
 *
 * WebKit drops `Secure` cookies set over http://localhost (Chromium keeps them), so
 * a local issuer that always marked the cookie `Secure` lost its SSO session in
 * WebKit and asked for the password on every silent /authorize.
 */
import { describe, expect, test } from "bun:test"
import { createCookieOptions, isLocalhostUrl } from "../src/session/cookie.js"
import {
  clearSessionCookieHeader,
  createSessionCookieHeader,
} from "../src/session/middleware.js"
import type { BrowserSession } from "../src/session/types.js"

const secret = new Uint8Array(32).fill(7)
const session = {
  id: "bs-1",
  tenant_id: "default",
  version: 1,
} as unknown as BrowserSession

describe("isLocalhostUrl", () => {
  test("local development hosts", () => {
    expect(isLocalhostUrl("http://localhost:3301/authorize")).toBe(true)
    expect(isLocalhostUrl("http://127.0.0.1:3301/")).toBe(true)
    expect(isLocalhostUrl("http://[::1]:3301/")).toBe(true)
    expect(isLocalhostUrl(new URL("https://localhost/"))).toBe(true)
  })

  test("every other host, http or https", () => {
    expect(isLocalhostUrl("https://auth.alummahnow.net/authorize")).toBe(false)
    expect(isLocalhostUrl("http://auth.example.com/")).toBe(false)
    expect(isLocalhostUrl("https://localhost.example.com/")).toBe(false)
    expect(isLocalhostUrl("http://10.0.0.5/")).toBe(false)
    expect(isLocalhostUrl("not a url")).toBe(false)
  })
})

describe("session cookie Secure attribute", () => {
  test("Secure by default (production unchanged)", async () => {
    expect(createCookieOptions().secure).toBe(true)
    const header = await createSessionCookieHeader(session, secret, "__session")
    expect(header).toContain("; Secure")
    expect(clearSessionCookieHeader("__session")).toContain("; Secure")
  })

  test("not Secure when the caller says the issuer is on localhost", async () => {
    expect(createCookieOptions(undefined, false).secure).toBe(false)
    const header = await createSessionCookieHeader(
      session,
      secret,
      "__session",
      undefined,
      false,
    )
    expect(header).not.toContain("Secure")
    expect(header).toContain("HttpOnly")
    expect(header).toContain("SameSite=Lax")
    const cleared = clearSessionCookieHeader("__session", undefined, false)
    expect(cleared).not.toContain("Secure")
    expect(cleared).toContain("Max-Age=0")
  })
})
