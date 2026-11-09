/**
 * Hand a request from one Hono app to another without losing its per-request
 * values (theme, tenant context).
 *
 * `app.request(req)` builds a fresh context, so values set on the caller's
 * context would be lost. The caller's context is kept against this request
 * object only, never in a global, so concurrent requests can't see each other's.
 *
 * @internal
 * @packageDocumentation
 */

import type { Context, Hono } from "hono"

const forwardedFrom = new WeakMap<Request, Context>()

/** Run `req` through `app`, letting it inherit `c`'s per-request values. */
export function forwardRequest(app: Hono<any>, c: Context) {
  forwardedFrom.set(c.req.raw, c)
  return app.request(c.req.raw)
}

/** Copy these keys from the forwarding context, where this context lacks them. */
export function inheritForwarded(c: Context, keys: readonly string[]) {
  const from = forwardedFrom.get(c.req.raw)
  if (!from) return
  for (const key of keys) {
    const value = from.get(key)
    if (value !== undefined && c.get(key) === undefined) c.set(key, value)
  }
}
