import { base64url } from "jose"

function generateVerifier(length: number): string {
  const buffer = new Uint8Array(length)
  crypto.getRandomValues(buffer)
  return base64url.encode(buffer)
}

async function generateChallenge(verifier: string, method: "S256" | "plain") {
  if (method === "plain") return verifier
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return base64url.encode(new Uint8Array(hash))
}

export async function generatePKCE(length: number = 64) {
  if (length < 43 || length > 128) {
    throw new Error(
      "Code verifier length must be between 43 and 128 characters",
    )
  }
  const verifier = generateVerifier(length)
  const challenge = await generateChallenge(verifier, "S256")
  return {
    verifier,
    challenge,
    method: "S256",
  }
}

/**
 * Constant-time string comparison (length is not secret here: both inputs
 * are base64url-encoded SHA-256 digests).
 */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const ab = encoder.encode(a)
  const bb = encoder.encode(b)
  let diff = ab.length ^ bb.length
  const len = Math.max(ab.length, bb.length)
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  }
  return diff === 0
}

/**
 * Validate a PKCE code_verifier against the stored code_challenge.
 *
 * SECURITY: only the `S256` method is accepted (the only method advertised in
 * discovery). `plain` and any other method are rejected. The comparison is
 * constant-time.
 */
export async function validatePKCE(
  verifier: string,
  challenge: string,
  method: string = "S256",
): Promise<boolean> {
  if (method !== "S256") return false
  if (typeof verifier !== "string" || typeof challenge !== "string")
    return false
  const generatedChallenge = await generateChallenge(verifier, "S256")
  return timingSafeEqual(generatedChallenge, challenge)
}
