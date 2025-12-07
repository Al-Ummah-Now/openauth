import type { ScopeValidationResult } from "./types.js"

/**
 * Validate requested scopes against allowed scopes
 */
export function validateScopes(
  requestedScopes: string[],
  allowedScopes: string[]
): ScopeValidationResult {
  // Empty requested = grant all allowed
  if (requestedScopes.length === 0) {
    return {
      valid: true,
      granted: allowedScopes,
      denied: [],
    }
  }

  const granted: string[] = []
  const denied: string[] = []

  for (const scope of requestedScopes) {
    if (allowedScopes.includes(scope)) {
      granted.push(scope)
    } else {
      denied.push(scope)
    }
  }

  return {
    valid: denied.length === 0,
    granted,
    denied,
  }
}

/**
 * Parse space-separated scope string into array
 */
export function parseScopes(scopeString?: string): string[] {
  if (!scopeString) return []
  return scopeString.split(" ").filter(Boolean)
}
