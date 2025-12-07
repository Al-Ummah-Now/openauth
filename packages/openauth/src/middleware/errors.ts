/**
 * Middleware Errors
 */

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 401,
  ) {
    super(message)
    this.name = "AuthError"
  }
}

export class MissingTokenError extends AuthError {
  constructor() {
    super("missing_token", "Authorization header is required", 401)
  }
}

export class InvalidTokenError extends AuthError {
  constructor(reason?: string) {
    super(
      "invalid_token",
      reason ? `Invalid token: ${reason}` : "Invalid or expired token",
      401,
    )
  }
}

export class InsufficientScopeError extends AuthError {
  constructor(required: string[], granted: string[]) {
    super(
      "insufficient_scope",
      `Required scope(s): ${required.join(", ")}. Granted: ${granted.join(", ") || "none"}`,
      403,
    )
  }
}

export class TenantMismatchError extends AuthError {
  constructor() {
    super("tenant_mismatch", "Access denied: tenant mismatch", 403)
  }
}

export class RateLimitExceededError extends AuthError {
  constructor(retryAfter: number) {
    super(
      "rate_limit_exceeded",
      `Rate limit exceeded. Retry after ${retryAfter} seconds`,
      429,
    )
  }
}
