/** @jsxImportSource hono/jsx */

/**
 * Friendly page shown when a sign-in flow can't be resumed (no flow id and no
 * authorization cookie, an expired flow, a flow from another browser). It never
 * shows the technical error: it explains in the user's language and offers a
 * button back to the app that started the sign-in.
 *
 * @packageDocumentation
 */

import { Layout } from "./base.js"
import {
  DEFAULT_LOCALE,
  getLocaleFromUrl,
  getTranslations,
  normalizeLocale,
} from "./i18n.js"
import type { Locale } from "./i18n.js"
import type { Theme } from "./theme.js"

export interface RestartPageInput {
  /** Where the "Start sign-in again" button goes. */
  restartUrl?: string
  /** Locale hint (e.g. from the flow's redirect_uri). `?lang=` wins. */
  locale?: string
  theme?: Theme
}

/**
 * Pick the page locale: `?lang=` > the flow's own `?lang=` (hint) > English.
 * The browser's Accept-Language is not consulted: like every other sign-in
 * page, it is English unless the link asks for another language.
 */
export function restartLocale(req: Request, hint?: string): Locale {
  const fromUrl = getLocaleFromUrl(new URL(req.url))
  if (fromUrl) return fromUrl
  return normalizeLocale(hint) ?? DEFAULT_LOCALE
}

export function RestartPage(req: Request, input: RestartPageInput): Response {
  const locale = restartLocale(req, input.locale)
  const t = getTranslations(locale)
  const href = input.restartUrl || "/"
  const jsx = (
    <Layout theme={input.theme} locale={locale}>
      <div data-component="form" data-page="restart">
        <h1 data-component="title">{t.restart_title}</h1>
        <p data-component="description">{t.restart_description}</p>
        <a data-component="button" href={href} data-action="restart">
          {t.restart_button}
        </a>
      </div>
    </Layout>
  )
  return new Response(jsx.toString(), {
    status: 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}
