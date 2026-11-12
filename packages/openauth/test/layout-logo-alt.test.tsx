/**
 * The theme's logo images have a text alternative in the page's language
 * (WCAG 1.1.1, axe image-alt; AlUmmahNow#1042).
 */
import { describe, expect, test } from "bun:test"
import { Layout } from "../src/ui/base.js"
import type { Theme } from "../src/ui/theme.js"

const logo = {
  light: "https://x.test/light.svg",
  dark: "https://x.test/dark.svg",
}

function render(theme: Theme, locale: string) {
  return String(
    <Layout theme={theme} locale={locale}>
      <p>body</p>
    </Layout>,
  )
}

function alts(html: string) {
  return [...html.matchAll(/<img data-component="logo"[^>]*>/g)].map(
    (m) => m[0].match(/alt="([^"]*)"/)?.[1],
  )
}

describe("logo alt text", () => {
  test("is the site title in the page's language", () => {
    const theme: Theme = {
      logo,
      title: { en: "Al Ummah Now", ar: "الأمة الآن" },
    }
    expect(alts(render(theme, "en"))).toEqual(["Al Ummah Now", "Al Ummah Now"])
    expect(alts(render(theme, "ar"))).toEqual(["الأمة الآن", "الأمة الآن"])
  })

  test("falls back to a localized 'Logo' when the theme has no title", () => {
    expect(alts(render({ logo }, "en"))).toEqual(["Logo", "Logo"])
    expect(alts(render({ logo }, "ar"))).toEqual(["الشعار", "الشعار"])
  })
})
