/** @jsxImportSource hono/jsx */

/**
 * Shown when /authorize is called by an app that isn't registered for this
 * issuer: an unknown or disabled client_id, or a redirect_uri the client has
 * not registered. The user is never sent to that redirect_uri (it is not
 * trusted); the page explains in their language and shows the error code.
 *
 * @packageDocumentation
 */

import { Layout } from "./base.js"
import { getTranslations } from "./i18n.js"
import { restartLocale } from "./restart.js"
import type { Theme } from "./theme.js"

export type ClientErrorReason =
  | "unknown_client"
  | "client_disabled"
  | "client_not_allowed"
  | "redirect_uri_not_registered"

export interface ClientErrorPageInput {
  reason: ClientErrorReason
  /** Where the button goes (the main app). */
  homeUrl?: string
  theme?: Theme
}

export function ClientErrorPage(
  req: Request,
  input: ClientErrorPageInput,
): Response {
  const locale = restartLocale(req)
  const t = getTranslations(locale)
  const jsx = (
    <Layout theme={input.theme} locale={locale}>
      <div
        data-component="form"
        data-page="client-error"
        data-error={input.reason}
      >
        <h1 data-component="title">{t.client_error_title}</h1>
        <p data-component="description">{t.client_error_description}</p>
        <p data-component="description">
          <code>{input.reason}</code>
        </p>
        <a
          data-component="button"
          href={input.homeUrl || "/"}
          data-action="home"
        >
          {t.client_error_button}
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
