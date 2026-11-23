/**
 * The authorization server metadata (RFC 8414) both discovery documents share:
 * `/.well-known/oauth-authorization-server` and, in the enterprise issuer,
 * `/.well-known/openid-configuration`.
 *
 * Standard OAuth libraries configure themselves from these documents, so they
 * list only what this issuer serves: every endpoint here has a route, and every
 * grant, response type and method here works. `test/discovery.test.ts` requests
 * each advertised endpoint.
 */
import {
  DEVICE_CODE_GRANT,
  deviceDiscovery,
  type DeviceFlowOptions,
} from "./device.js"

export interface DiscoveryFeatures {
  /** Registered clients (`clientDb`): client secrets, introspection, revocation. */
  clients: boolean
  /** The device authorization grant, when enabled. */
  device?: DeviceFlowOptions
  /** Developer documentation, when there is any. */
  documentation?: string
}

export function authorizationServerMetadata(
  iss: string,
  features: DiscoveryFeatures,
) {
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/authorize`,
    token_endpoint: `${iss}/token`,
    userinfo_endpoint: `${iss}/userinfo`,
    jwks_uri: `${iss}/.well-known/jwks.json`,
    response_types_supported: ["code", "token"],
    response_modes_supported: ["query", "fragment"],
    grant_types_supported: [
      "authorization_code",
      "refresh_token",
      // response_type=token
      "implicit",
      "client_credentials",
      ...(features.device ? [DEVICE_CODE_GRANT] : []),
    ],
    token_endpoint_auth_methods_supported: features.clients
      ? ["client_secret_basic", "client_secret_post", "none"]
      : ["client_secret_post", "none"],
    code_challenge_methods_supported: ["S256"],
    ...(features.clients
      ? {
          introspection_endpoint: `${iss}/token/introspect`,
          introspection_endpoint_auth_methods_supported: [
            "client_secret_basic",
            "client_secret_post",
          ],
          revocation_endpoint: `${iss}/token/revoke`,
        }
      : {}),
    ...(features.device ? deviceDiscovery(iss, features.device) : {}),
    ...(features.documentation
      ? { service_documentation: features.documentation }
      : {}),
  }
}
