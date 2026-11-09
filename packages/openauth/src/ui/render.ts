/**
 * What a page needs to know about the request it renders for.
 *
 * Passed to every render call. Nothing here may be stored outside the request:
 * a Worker isolate serves many requests at once, so a value kept in a global
 * can be overwritten by another request between an await and the render.
 *
 * @packageDocumentation
 */

import type { Context } from "hono"
import {
  getDirection,
  getLocaleFromRequest,
  type Direction,
  type Locale,
} from "./i18n.js"
import type { Theme } from "./theme.js"

export interface RenderOptions {
  /** The theme for this page. The built-in default when undefined. */
  theme?: Theme
  locale: Locale
  direction: Direction
}

/** The Hono context key holding this request's theme. */
export const RESOLVED_THEME_KEY = "resolvedTheme"

/** Render options from the request alone: `?lang=`, otherwise English. */
export function renderOptionsFromRequest(
  req: Request,
  theme?: Theme,
): RenderOptions {
  const locale = getLocaleFromRequest(req)
  return { theme, locale, direction: getDirection(locale) }
}

/** Render options for the request a Hono context belongs to. */
export function renderOptions(c: Context): RenderOptions {
  return renderOptionsFromRequest(c.req.raw, c.get(RESOLVED_THEME_KEY))
}
