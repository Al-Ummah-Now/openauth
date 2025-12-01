/**
 * Cookie encryption and decryption utilities for session management.
 *
 * Uses JWE (JSON Web Encryption) via the jose library for secure
 * cookie payload encryption.
 *
 * @packageDocumentation
 */

import { CompactEncrypt, compactDecrypt } from "jose"
import type { SessionCookiePayload } from "../contracts/types.js"
import type { SessionCookieOptions, CreateCookieParams } from "./types.js"
import { DEFAULT_SESSION_CONFIG } from "../contracts/types.js"

/**
 * JWE algorithm for key encryption (A256GCM with direct key agreement)
 */
const JWE_ALG = "dir"

/**
 * JWE encryption algorithm
 */
const JWE_ENC = "A256GCM"

/**
 * Encrypt a session cookie payload using JWE.
 *
 * @param payload - The session cookie payload to encrypt
 * @param secret - 256-bit secret key as Uint8Array
 * @returns Encrypted JWE token string
 *
 * @example
 * ```typescript
 * const secret = new Uint8Array(32) // 256-bit key
 * crypto.getRandomValues(secret)
 *
 * const payload: SessionCookiePayload = {
 *   sid: "session-id",
 *   tid: "tenant-id",
 *   v: 1,
 *   iat: Date.now()
 * }
 *
 * const encrypted = await encryptSessionCookie(payload, secret)
 * ```
 */
export async function encryptSessionCookie(
  payload: SessionCookiePayload,
  secret: Uint8Array,
): Promise<string> {
  if (secret.length !== 32) {
    throw new Error("Secret must be exactly 32 bytes (256 bits)")
  }

  const encoder = new TextEncoder()
  const payloadBytes = encoder.encode(JSON.stringify(payload))

  const jwe = await new CompactEncrypt(payloadBytes)
    .setProtectedHeader({ alg: JWE_ALG, enc: JWE_ENC })
    .encrypt(secret)

  return jwe
}

/**
 * Decrypt a session cookie payload from JWE.
 *
 * @param cookie - The encrypted JWE token string
 * @param secret - 256-bit secret key as Uint8Array
 * @returns Decrypted session cookie payload, or null if decryption fails
 *
 * @example
 * ```typescript
 * const secret = new Uint8Array(32) // Same key used for encryption
 * const payload = await decryptSessionCookie(cookieValue, secret)
 * if (payload) {
 *   console.log("Session ID:", payload.sid)
 * }
 * ```
 */
export async function decryptSessionCookie(
  cookie: string,
  secret: Uint8Array,
): Promise<SessionCookiePayload | null> {
  if (!cookie || secret.length !== 32) {
    return null
  }

  try {
    const { plaintext } = await compactDecrypt(cookie, secret)
    const decoder = new TextDecoder()
    const payload = JSON.parse(
      decoder.decode(plaintext),
    ) as SessionCookiePayload

    // Validate payload structure
    if (
      typeof payload.sid !== "string" ||
      typeof payload.tid !== "string" ||
      typeof payload.v !== "number" ||
      typeof payload.iat !== "number"
    ) {
      return null
    }

    return payload
  } catch {
    // Handle any decryption or parsing errors gracefully
    return null
  }
}

/**
 * Create cookie options for session management.
 *
 * @param domain - Optional domain for the cookie
 * @returns Cookie options object
 *
 * @example
 * ```typescript
 * const options = createCookieOptions("example.com")
 * // { httpOnly: true, secure: true, sameSite: "lax", maxAge: 604800, path: "/", domain: "example.com" }
 * ```
 */
export function createCookieOptions(domain?: string): SessionCookieOptions {
  const options: SessionCookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: DEFAULT_SESSION_CONFIG.sessionLifetimeSeconds, // 7 days in seconds
    path: "/",
  }

  if (domain) {
    options.domain = domain
  }

  return options
}

/**
 * Create a session cookie payload from parameters.
 *
 * @param params - Cookie creation parameters
 * @returns Session cookie payload
 */
export function createCookiePayload(
  params: CreateCookieParams,
): SessionCookiePayload {
  return {
    sid: params.sessionId,
    tid: params.tenantId,
    v: params.version,
    iat: Date.now(),
  }
}

/**
 * Parse a cookie string and extract a specific cookie value.
 *
 * @param cookieHeader - The Cookie header string
 * @param name - The cookie name to extract
 * @returns The cookie value or undefined if not found
 */
export function parseCookie(
  cookieHeader: string | null | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined
  }

  const cookies = cookieHeader.split(";")
  for (const cookie of cookies) {
    const [cookieName, ...cookieValueParts] = cookie.trim().split("=")
    if (cookieName === name) {
      // Join back in case value contained '='
      return cookieValueParts.join("=")
    }
  }

  return undefined
}

/**
 * Generate a secure random secret key for cookie encryption.
 *
 * @returns 256-bit random secret as Uint8Array
 */
export function generateCookieSecret(): Uint8Array {
  const secret = new Uint8Array(32)
  crypto.getRandomValues(secret)
  return secret
}

/**
 * Convert a hex string to Uint8Array for use as cookie secret.
 *
 * @param hex - Hex string (64 characters for 32 bytes)
 * @returns Uint8Array secret
 * @throws Error if hex string is invalid
 */
export function hexToSecret(hex: string): Uint8Array {
  if (hex.length !== 64) {
    throw new Error("Hex string must be exactly 64 characters (32 bytes)")
  }

  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }

  return bytes
}

/**
 * Convert a base64 string to Uint8Array for use as cookie secret.
 *
 * @param base64 - Base64 encoded string
 * @returns Uint8Array secret
 * @throws Error if resulting array is not 32 bytes
 */
export function base64ToSecret(base64: string): Uint8Array {
  // Handle both standard base64 and base64url
  const normalized = base64.replace(/-/g, "+").replace(/_/g, "/")
  const binaryString = atob(normalized)
  const bytes = new Uint8Array(binaryString.length)

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  if (bytes.length !== 32) {
    throw new Error("Base64 string must decode to exactly 32 bytes")
  }

  return bytes
}

/**
 * Convert a Uint8Array secret to hex string.
 *
 * @param secret - The secret as Uint8Array
 * @returns Hex string representation
 */
export function secretToHex(secret: Uint8Array): string {
  return Array.from(secret)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
