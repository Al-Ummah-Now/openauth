/**
 * D1 Error Handling Utilities
 *
 * Provides structured error types and retry logic for D1 operations.
 * Distinguishes between transient and permanent failures.
 *
 * @packageDocumentation
 */

/**
 * Base class for all D1-related errors
 */
export class D1Error extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly isTransient: boolean = false,
  ) {
    super(message)
    this.name = "D1Error"
  }
}

/**
 * Transient error that should be retried
 */
export class D1TransientError extends D1Error {
  constructor(
    message: string,
    operation: string,
    public readonly cause?: Error,
  ) {
    super(message, operation, true)
    this.name = "D1TransientError"
  }
}

/**
 * Permanent error that should not be retried
 */
export class D1PermanentError extends D1Error {
  constructor(
    message: string,
    operation: string,
    public readonly cause?: Error,
  ) {
    super(message, operation, false)
    this.name = "D1PermanentError"
  }
}

/**
 * Resource not found (not an error condition)
 */
export class D1NotFoundError extends D1Error {
  constructor(message: string, operation: string) {
    super(message, operation, false)
    this.name = "D1NotFoundError"
  }
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 2000,
  backoffMultiplier: 2,
}

/**
 * Classify D1 error based on error message and type
 */
export function classifyD1Error(error: unknown, operation: string): D1Error {
  if (error instanceof D1Error) {
    return error
  }

  const message = error instanceof Error ? error.message : String(error)
  const lowerMessage = message.toLowerCase()

  // Transient errors (network, timeout, temporary issues)
  if (
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("network") ||
    lowerMessage.includes("connection") ||
    lowerMessage.includes("econnrefused") ||
    lowerMessage.includes("enotfound") ||
    lowerMessage.includes("temporarily unavailable") ||
    lowerMessage.includes("service unavailable") ||
    lowerMessage.includes("too many requests")
  ) {
    return new D1TransientError(
      `Transient D1 error in ${operation}: ${message}`,
      operation,
      error instanceof Error ? error : undefined,
    )
  }

  // Not found errors
  if (
    lowerMessage.includes("not found") ||
    lowerMessage.includes("no such") ||
    lowerMessage.includes("does not exist")
  ) {
    return new D1NotFoundError(
      `Resource not found in ${operation}: ${message}`,
      operation,
    )
  }

  // Permanent errors (constraint violations, schema errors, etc.)
  if (
    lowerMessage.includes("constraint") ||
    lowerMessage.includes("unique") ||
    lowerMessage.includes("foreign key") ||
    lowerMessage.includes("schema") ||
    lowerMessage.includes("syntax error") ||
    lowerMessage.includes("invalid") ||
    lowerMessage.includes("duplicate")
  ) {
    return new D1PermanentError(
      `Permanent D1 error in ${operation}: ${message}`,
      operation,
      error instanceof Error ? error : undefined,
    )
  }

  // Default to transient for unknown errors (safer to retry)
  return new D1TransientError(
    `Unknown D1 error in ${operation}: ${message}`,
    operation,
    error instanceof Error ? error : undefined,
  )
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Check if an error is a domain/application error that should not be wrapped
 * Domain errors are intentionally thrown by application code, not D1 failures
 */
function isDomainError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  // These are application-level errors, not D1 errors
  const domainErrorNames = [
    "ClientNotFoundError",
    "ClientNameConflictError",
    "InvalidGrantTypeError",
    "InvalidScopeFormatError",
    "InvalidRedirectUriError",
    "ClientError",
    "ValidationError",
  ]

  return (
    domainErrorNames.includes(error.name) ||
    domainErrorNames.includes(error.constructor.name)
  )
}

/**
 * Execute D1 operation with retry logic
 *
 * Domain errors (ClientNotFoundError, etc.) are passed through without wrapping.
 * Only actual D1/database errors are classified and potentially retried.
 */
export async function withRetry<T>(
  operation: string,
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config }
  let lastError: D1Error | Error | undefined
  let delay = cfg.initialDelayMs

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      // Preserve domain errors - don't wrap them as D1 errors
      if (isDomainError(error)) {
        throw error
      }

      const d1Error = classifyD1Error(error, operation)
      lastError = d1Error

      // Don't retry permanent errors or not found errors
      if (!d1Error.isTransient) {
        throw d1Error
      }

      // Don't retry on last attempt
      if (attempt === cfg.maxAttempts) {
        console.error(
          `D1 operation "${operation}" failed after ${cfg.maxAttempts} attempts:`,
          d1Error,
        )
        throw d1Error
      }

      // Log retry attempt
      console.warn(
        `D1 operation "${operation}" failed (attempt ${attempt}/${cfg.maxAttempts}), retrying in ${delay}ms:`,
        d1Error.message,
      )

      // Wait before retrying
      await sleep(delay)

      // Exponential backoff with max delay cap
      delay = Math.min(delay * cfg.backoffMultiplier, cfg.maxDelayMs)
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError || new D1Error("Unknown error", operation)
}

/**
 * Wrap D1 database result check with proper error handling
 */
export function checkD1Result(
  result: { success: boolean; meta?: { changes?: number } },
  operation: string,
  expectChanges: boolean = false,
): void {
  if (!result.success) {
    throw new D1PermanentError(`D1 operation failed: ${operation}`, operation)
  }

  if (expectChanges && (!result.meta || result.meta.changes === 0)) {
    throw new D1NotFoundError(`No rows affected in ${operation}`, operation)
  }
}
