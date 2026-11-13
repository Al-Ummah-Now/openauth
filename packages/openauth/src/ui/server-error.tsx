/** @jsxImportSource hono/jsx */

/**
 * Shown to a browser when the issuer fails on its side (an unexpected error:
 * storage, a dependency, a bug). It never shows the technical error: it says
 * so in the user's language, offers "Try again" (the same URL), and shows the
 * reference the host reported the error under, so support can find it.
 *
 * @packageDocumentation
 */

import { Layout } from "./base.js"
import { getTranslations } from "./i18n.js"
import { restartLocale } from "./restart.js"
import type { Theme } from "./theme.js"

export interface ServerErrorPageInput {
  /** The reference the error was reported under (e.g. ERR-ABCD-1234). */
  reference?: string
  /** Where "Try again" goes; defaults to the failed request's URL. */
  retryUrl?: string
  /** Locale hint (the flow's); `?lang=` wins. */
  locale?: string
  theme?: Theme
}

/** True for a browser page load (HTML wanted), false for API and fetch callers. */
export function wantsHtml(req: Request): boolean {
  const accept = req.headers.get("accept") ?? ""
  return accept.includes("text/html")
}

export function ServerErrorPage(
  req: Request,
  input: ServerErrorPageInput,
): Response {
  const locale = restartLocale(req, input.locale)
  const t = getTranslations(locale)
  const retry = input.retryUrl || req.url
  const jsx = (
    <Layout theme={input.theme} locale={locale}>
      <div data-component="form" data-page="server-error">
        <h1 data-component="title">{t.server_error_title}</h1>
        <p data-component="description">{t.server_error_description}</p>
        {input.reference ? (
          <p data-component="description" data-reference={input.reference}>
            {t.server_error_reference} <code>{input.reference}</code>
          </p>
        ) : null}
        <a data-component="button" href={retry} data-action="retry">
          {t.server_error_button}
        </a>
      </div>
    </Layout>
  )
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  }
  if (input.reference) headers["X-Error-Ref"] = input.reference
  return new Response(jsx.toString(), { status: 500, headers })
}
