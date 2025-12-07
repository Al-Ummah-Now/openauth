/**
 * Scope Requirement Middleware
 */

import { createMiddleware } from "hono/factory"
import { InsufficientScopeError } from "./errors.js"

/**
 * Check if granted scopes include required scope
 * Supports wildcard matching (e.g., "users:*" matches "users:read")
 */
export function hasScope(granted: string[], required: string): boolean {
  if (granted.includes(required)) {
    return true
  }

  // Check for wildcard scopes
  const [resource] = required.split(":")
  if (granted.includes(`${resource}:*`)) {
    return true
  }

  // Check for admin scope (grants all)
  if (granted.includes("admin:*") || granted.includes("*")) {
    return true
  }

  return false
}

/**
 * Check if granted scopes include all required scopes
 */
export function hasAllScopes(granted: string[], required: string[]): boolean {
  return required.every((scope) => hasScope(granted, scope))
}

/**
 * Check if granted scopes include any of the required scopes
 */
export function hasAnyScope(granted: string[], required: string[]): boolean {
  return required.some((scope) => hasScope(granted, scope))
}

/**
 * Middleware that requires specific scope(s)
 */
export function requireScope(...requiredScopes: string[]) {
  return createMiddleware(async (c, next) => {
    const scopes = c.get("scopes") || []

    if (!hasAllScopes(scopes, requiredScopes)) {
      throw new InsufficientScopeError(requiredScopes, scopes)
    }

    await next()
  })
}

/**
 * Middleware that requires any of the specified scopes
 */
export function requireAnyScope(...requiredScopes: string[]) {
  return createMiddleware(async (c, next) => {
    const scopes = c.get("scopes") || []

    if (!hasAnyScope(scopes, requiredScopes)) {
      throw new InsufficientScopeError(requiredScopes, scopes)
    }

    await next()
  })
}

/**
 * Middleware that conditionally requires scope based on request
 */
export function requireScopeIf(
  condition: (c: any) => boolean,
  ...requiredScopes: string[]
) {
  return createMiddleware(async (c, next) => {
    if (condition(c)) {
      const scopes = c.get("scopes") || []
      if (!hasAllScopes(scopes, requiredScopes)) {
        throw new InsufficientScopeError(requiredScopes, scopes)
      }
    }

    await next()
  })
}
