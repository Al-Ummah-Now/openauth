/** @jsxImportSource hono/jsx */

/**
 * Device activation pages (RFC 8628 verification URI): enter the code shown on
 * the TV, confirm the sign-in, and the result. Localized (en/ar, RTL) like the
 * restart page: `?lang=` > Accept-Language > en.
 *
 * @packageDocumentation
 */

import { Layout } from "./base.js"
import { getTranslations } from "./i18n.js"
import type { Locale } from "./i18n.js"
import type { Theme } from "./theme.js"

export type DevicePageInput =
  | { page: "enter"; error?: "invalid" | "rate_limited"; userCode?: string }
  | {
      page: "confirm"
      userCode: string
      appName: string
      csrf: string
    }
  | { page: "done" | "denied" | "failed" }

function html(
  body: string,
  status: number,
  headers: Record<string, string> = {},
) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
      ...headers,
    },
  })
}

/** `ABCDEFGH` → `ABCD-EFGH` */
export function formatUserCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}

export function DevicePage(
  locale: Locale,
  input: DevicePageInput,
  opts: {
    theme?: Theme
    status?: number
    headers?: Record<string, string>
  } = {},
): Response {
  const t = getTranslations(locale)
  const lang = `?lang=${locale}`
  let content
  switch (input.page) {
    case "enter":
      content = (
        <form
          data-component="form"
          data-page="device-enter"
          method="get"
          action="/activate"
        >
          <h1 data-component="title">{t.device_title}</h1>
          <p data-component="description">{t.device_description}</p>
          {input.error && (
            <div data-component="form-alert" data-error={input.error}>
              <span data-slot="message">
                {input.error === "rate_limited"
                  ? t.device_rate_limited
                  : t.device_code_invalid}
              </span>
            </div>
          )}
          <input type="hidden" name="lang" value={locale} />
          <input
            data-component="input"
            autofocus
            type="text"
            name="user_code"
            required
            autocomplete="one-time-code"
            autocapitalize="characters"
            spellcheck={false}
            maxLength={12}
            dir="ltr"
            aria-label={t.device_code_label}
            placeholder="XXXX-XXXX"
            value={input.userCode ?? ""}
          />
          <button data-component="button">{t.button_continue}</button>
        </form>
      )
      break
    case "confirm":
      content = (
        <form
          data-component="form"
          data-page="device-confirm"
          method="post"
          action={`/activate${lang}`}
        >
          <h1 data-component="title">
            {t.device_confirm_title.replace("{app}", input.appName)}
          </h1>
          <p data-component="description">{t.device_confirm_description}</p>
          <p data-component="title" dir="ltr" data-slot="user-code">
            {formatUserCode(input.userCode)}
          </p>
          <p data-component="description">{t.device_confirm_warning}</p>
          <input type="hidden" name="user_code" value={input.userCode} />
          <input type="hidden" name="csrf" value={input.csrf} />
          <button data-component="button" name="action" value="approve">
            {t.device_approve}
          </button>
          <button
            data-component="button"
            data-color="ghost"
            name="action"
            value="deny"
          >
            {t.device_deny}
          </button>
        </form>
      )
      break
    default: {
      const title = {
        done: t.device_done_title,
        denied: t.device_denied_title,
        failed: t.device_failed_title,
      }[input.page]
      const description = {
        done: t.device_done_description,
        denied: t.device_denied_description,
        failed: t.device_failed_description,
      }[input.page]
      content = (
        <div data-component="form" data-page={`device-${input.page}`}>
          <h1 data-component="title">{title}</h1>
          <p data-component="description">{description}</p>
        </div>
      )
    }
  }
  const jsx = (
    <Layout theme={opts.theme} locale={locale}>
      {content}
    </Layout>
  )
  return html(jsx.toString(), opts.status ?? 200, opts.headers)
}
