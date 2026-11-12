import { PropsWithChildren } from "hono/jsx"
import css from "./ui.css" assert { type: "text" }
import { resolveTheme, resolveLocalizedString, type Theme } from "./theme.js"
import {
  DEFAULT_LOCALE,
  getDirection,
  getTranslations,
  normalizeLocale,
  type Locale,
} from "./i18n.js"

export interface LayoutProps {
  size?: "small"
  theme?: Theme
  /**
   * The locale for the UI. English when missing or unsupported.
   */
  locale?: Locale | string
  /**
   * The text direction. If not provided, derived from locale.
   */
  direction?: "ltr" | "rtl"
}

export function Layout(props: PropsWithChildren<LayoutProps>) {
  const theme = resolveTheme(props.theme)
  // The request decides these, never the theme: a theme can be shared by
  // requests in different languages.
  const locale = normalizeLocale(props.locale) ?? DEFAULT_LOCALE
  const direction = props.direction || getDirection(locale)
  function get(key: "primary" | "background" | "logo", mode: "light" | "dark") {
    if (!theme) return
    if (!theme[key]) return
    if (typeof theme[key] === "string") return theme[key]

    return theme[key][mode] as string | undefined
  }

  const radius = (() => {
    if (theme?.radius === "none") return "0"
    if (theme?.radius === "sm") return "1"
    if (theme?.radius === "md") return "1.25"
    if (theme?.radius === "lg") return "1.5"
    if (theme?.radius === "full") return "1000000000001"
    return "1"
  })()

  const hasLogo = get("logo", "light") && get("logo", "dark")
  const title = resolveLocalizedString(theme?.title, locale)
  // Every <img> needs a text alternative (WCAG 1.1.1, axe image-alt): the
  // site's name in the page's language, or "Logo" when the theme has none
  const logoAlt = title || getTranslations(locale).logo_alt || "Logo"

  return (
    <html
      lang={locale}
      dir={direction}
      style={{
        "--color-background-light": get("background", "light"),
        "--color-background-dark": get("background", "dark"),
        "--color-primary-light": get("primary", "light"),
        "--color-primary-dark": get("primary", "dark"),
        "--font-family": theme?.font?.family,
        "--font-scale": theme?.font?.scale,
        "--border-radius": radius,
      }}
    >
      <head>
        <title>{title || "OpenAuthJS"}</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {theme?.favicon ? (
          <link rel="icon" href={theme?.favicon} />
        ) : (
          <>
            <link
              rel="icon"
              href="https://openauth.js.org/favicon.ico"
              sizes="48x48"
            />
            <link
              rel="icon"
              href="https://openauth.js.org/favicon.svg"
              media="(prefers-color-scheme: light)"
            />
            <link
              rel="icon"
              href="https://openauth.js.org/favicon-dark.svg"
              media="(prefers-color-scheme: dark)"
            />
            <link
              rel="shortcut icon"
              href="https://openauth.js.org/favicon.svg"
              type="image/svg+xml"
            />
          </>
        )}
        <style dangerouslySetInnerHTML={{ __html: css }} />
        {theme?.css && (
          <style dangerouslySetInnerHTML={{ __html: theme.css }} />
        )}
      </head>
      <body>
        <div data-component="root">
          <div data-component="center" data-size={props.size}>
            <div data-component="branding">
              {hasLogo ? (
                <>
                  <img
                    data-component="logo"
                    src={get("logo", "light")}
                    alt={logoAlt}
                    data-mode="light"
                  />
                  <img
                    data-component="logo"
                    src={get("logo", "dark")}
                    alt={logoAlt}
                    data-mode="dark"
                  />
                </>
              ) : (
                ICON_OPENAUTH
              )}
              {title && <h1 data-component="site-title">{title}</h1>}
            </div>
            {props.children}
          </div>
        </div>
      </body>
    </html>
  )
}

const ICON_OPENAUTH = (
  <svg
    data-component="logo-default"
    width="51"
    height="51"
    viewBox="0 0 51 51"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M0 50.2303V0.12854H50.1017V50.2303H0ZM3.08002 11.8326H11.7041V3.20856H3.08002V11.8326ZM14.8526 11.8326H23.4766V3.20856H14.8526V11.8326ZM26.5566 11.8326H35.1807V3.20856H26.5566V11.8326ZM38.3292 11.8326H47.0217V3.20856H38.3292V11.8326ZM3.08002 23.6052H11.7041V14.9811H3.08002V23.6052ZM14.8526 23.6052H23.4766V14.9811H14.8526V23.6052ZM26.5566 23.6052H35.1807V14.9811H26.5566V23.6052ZM38.3292 23.6052H47.0217V14.9811H38.3292V23.6052ZM3.08002 35.3092H11.7041V26.6852H3.08002V35.3092ZM14.8526 35.3092H23.4766V26.6852H14.8526V35.3092ZM26.5566 35.3092H35.1807V26.6852H26.5566V35.3092ZM38.3292 35.3092H47.0217V26.6852H38.3292V35.3092ZM3.08002 47.1502H11.7041V38.3893H3.08002V47.1502ZM14.8526 47.1502H23.4766V38.3893H14.8526V47.1502ZM26.5566 47.1502H35.1807V38.3893H26.5566V47.1502ZM38.3292 47.1502H47.0217V38.3893H38.3292V47.1502Z"
      fill="currentColor"
    />
  </svg>
)
