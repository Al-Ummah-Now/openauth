/**
 * Circuit Breaker Pattern for D1 Operations
 *
 * Protects against cascading failures by monitoring error rates and
 * temporarily blocking requests when the service is degraded.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit is open, requests fail fast without hitting D1
 * - HALF_OPEN: Testing if service has recovered
 *
 * @packageDocumentation
 */

export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export interface CircuitBreakerConfig {
  /** Failure threshold percentage (0-100) before opening circuit */
  failureThreshold: number
  /** Minimum requests before circuit can open */
  minimumRequests: number
  /** Time window for calculating failure rate (ms) */
  windowSize: number
  /** Cooldown period before attempting recovery (ms) */
  cooldownPeriod: number
  /** Number of successful requests to close circuit from half-open */
  successThreshold: number
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 50, // 50% failure rate
  minimumRequests: 5, // Need at least 5 requests
  windowSize: 60000, // 1 minute window
  cooldownPeriod: 30000, // 30 second cooldown
  successThreshold: 3, // 3 successful requests to close
}

interface RequestRecord {
  timestamp: number
  success: boolean
}

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly state: CircuitState,
  ) {
    super(message)
    this.name = "CircuitBreakerError"
  }
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED
  private records: RequestRecord[] = []
  private openedAt: number = 0
  private consecutiveSuccesses: number = 0
  private config: CircuitBreakerConfig

  constructor(
    private name: string,
    config?: Partial<CircuitBreakerConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check circuit state
    if (this.state === CircuitState.OPEN) {
      const now = Date.now()
      const elapsed = now - this.openedAt

      // Check if cooldown period has passed
      if (elapsed < this.config.cooldownPeriod) {
        throw new CircuitBreakerError(
          `Circuit breaker "${this.name}" is OPEN (${Math.ceil((this.config.cooldownPeriod - elapsed) / 1000)}s until retry)`,
          CircuitState.OPEN,
        )
      }

      // Try half-open state
      this.state = CircuitState.HALF_OPEN
      this.consecutiveSuccesses = 0
      console.log(
        `Circuit breaker "${this.name}" entering HALF_OPEN state (testing recovery)`,
      )
    }

    const startTime = Date.now()

    try {
      const result = await operation()
      this.recordSuccess(startTime)
      return result
    } catch (error) {
      this.recordFailure(startTime)
      throw error
    }
  }

  /**
   * Record successful request
   */
  private recordSuccess(timestamp: number): void {
    this.records.push({ timestamp, success: true })
    this.cleanOldRecords()

    if (this.state === CircuitState.HALF_OPEN) {
      this.consecutiveSuccesses++

      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED
        this.consecutiveSuccesses = 0
        console.log(`Circuit breaker "${this.name}" CLOSED (service recovered)`)
      }
    }
  }

  /**
   * Record failed request
   */
  private recordFailure(timestamp: number): void {
    this.records.push({ timestamp, success: false })
    this.cleanOldRecords()

    if (this.state === CircuitState.HALF_OPEN) {
      // Failed during half-open, reopen circuit
      this.openCircuit()
      return
    }

    // Check if we should open the circuit
    const recentRequests = this.getRecentRequests()
    if (recentRequests.length >= this.config.minimumRequests) {
      const failures = recentRequests.filter((r) => !r.success).length
      const failureRate = (failures / recentRequests.length) * 100

      if (failureRate >= this.config.failureThreshold) {
        this.openCircuit()
      }
    }
  }

  /**
   * Open the circuit
   */
  private openCircuit(): void {
    this.state = CircuitState.OPEN
    this.openedAt = Date.now()
    this.consecutiveSuccesses = 0

    const recentRequests = this.getRecentRequests()
    const failures = recentRequests.filter((r) => !r.success).length
    const failureRate = (failures / recentRequests.length) * 100

    console.error(
      `Circuit breaker "${this.name}" OPEN (failure rate: ${failureRate.toFixed(1)}%, cooldown: ${this.config.cooldownPeriod / 1000}s)`,
    )
  }

  /**
   * Get requests within the time window
   */
  private getRecentRequests(): RequestRecord[] {
    const cutoff = Date.now() - this.config.windowSize
    return this.records.filter((r) => r.timestamp >= cutoff)
  }

  /**
   * Clean up old records outside the window
   */
  private cleanOldRecords(): void {
    const cutoff = Date.now() - this.config.windowSize
    this.records = this.records.filter((r) => r.timestamp >= cutoff)

    // Keep max 1000 records to prevent memory issues
    if (this.records.length > 1000) {
      this.records = this.records.slice(-1000)
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state
  }

  /**
   * Get statistics
   */
  getStats(): {
    state: CircuitState
    totalRequests: number
    failedRequests: number
    failureRate: number
    cooldownRemaining: number
  } {
    const recent = this.getRecentRequests()
    const failed = recent.filter((r) => !r.success).length
    const failureRate = recent.length > 0 ? (failed / recent.length) * 100 : 0

    let cooldownRemaining = 0
    if (this.state === CircuitState.OPEN) {
      const elapsed = Date.now() - this.openedAt
      cooldownRemaining = Math.max(0, this.config.cooldownPeriod - elapsed)
    }

    return {
      state: this.state,
      totalRequests: recent.length,
      failedRequests: failed,
      failureRate,
      cooldownRemaining,
    }
  }

  /**
   * Manually reset circuit to closed state
   */
  reset(): void {
    this.state = CircuitState.CLOSED
    this.records = []
    this.openedAt = 0
    this.consecutiveSuccesses = 0
    console.log(`Circuit breaker "${this.name}" manually reset to CLOSED`)
  }
}
