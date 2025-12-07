/**
 * Secure client secret generation and hashing
 */

const SECRET_BYTE_LENGTH = 32 // 256 bits
const PBKDF2_ITERATIONS = 100_000
const SALT_BYTE_LENGTH = 16

/**
 * Generate a cryptographically secure client secret
 */
export function generateClientSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SECRET_BYTE_LENGTH))
  return bytesToBase64Url(bytes)
}

/**
 * Generate a client ID with prefix
 */
export function generateClientId(prefix = "client"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return `${prefix}_${bytesToBase64Url(bytes)}`
}

/**
 * Hash a client secret using PBKDF2-SHA256
 */
export async function hashClientSecret(secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH))
  const encoder = new TextEncoder()
  const secretBytes = encoder.encode(secret)

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    "PBKDF2",
    false,
    ["deriveBits"],
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  )

  const hash = new Uint8Array(derivedBits)

  // Format: $pbkdf2-sha256$iterations$salt$hash
  return `$pbkdf2-sha256$${PBKDF2_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`
}

/**
 * Verify a client secret against a hash
 */
export async function verifyClientSecret(
  secret: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split("$")
  if (parts.length !== 5 || parts[1] !== "pbkdf2-sha256") {
    return false
  }

  const iterations = parseInt(parts[2], 10)
  const salt = base64UrlToBytes(parts[3])
  const expectedHash = base64UrlToBytes(parts[4])

  const encoder = new TextEncoder()
  const secretBytes = encoder.encode(secret)

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    "PBKDF2",
    false,
    ["deriveBits"],
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  )

  const actualHash = new Uint8Array(derivedBits)

  // Constant-time comparison
  return timingSafeEqual(actualHash, expectedHash)
}

/**
 * Convert bytes to URL-safe base64
 */
function bytesToBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

/**
 * Convert URL-safe base64 to bytes
 */
function base64UrlToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)))
}

/**
 * Constant-time comparison to prevent timing attacks
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i]
  }
  return result === 0
}
