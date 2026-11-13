/**
 * WebAuthn (passkey) helpers shared by the passkey provider and the apps that
 * register passkeys. Wraps `@simplewebauthn/server`, which only needs
 * WebCrypto, so it runs on Cloudflare Workers.
 *
 * Policy (AUTH-PASSKEYS): discoverable credentials (resident key required),
 * user verification required, no attestation, ES256 and RS256.
 *
 * @packageDocumentation
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server"
import { isoBase64URL } from "@simplewebauthn/server/helpers"

/** Ceremony timeout (ms). */
export const PASSKEY_TIMEOUT_MS = 5 * 60 * 1000

/** COSE algorithms: ES256, RS256. */
const ALGORITHMS = [-7, -257]

/** A stored passkey, as the provider needs it to verify a sign-in. */
export interface PasskeyCredential {
  /** Credential id, base64url. */
  id: string
  /** The account the passkey belongs to. */
  userID: string
  /** COSE public key, base64url. */
  publicKey: string
  /** Signature counter (0 for authenticators that do not count, e.g. synced passkeys). */
  counter: number
  transports?: string[]
}

/** What a successful registration gives the app to store. */
export interface RegisteredPasskey {
  id: string
  publicKey: string
  counter: number
  transports: string[]
  /** "singleDevice" (device-bound) or "multiDevice" (synced). */
  deviceType: "singleDevice" | "multiDevice"
  backedUp: boolean
  aaguid: string
}

/**
 * The RP id for an issuer host: the host without a leading `auth.`
 * (`auth.alummahnow.net` → `alummahnow.net`, `auth.qa.alummahnow.net` →
 * `qa.alummahnow.net`, `localhost` → `localhost`).
 */
export function rpIdForHost(host: string): string {
  const hostname = host.split(":")[0].toLowerCase()
  return hostname.startsWith("auth.") ? hostname.slice(5) : hostname
}

/** Options for a sign-in ceremony with discoverable credentials. */
export async function authenticationOptions(input: {
  rpID: string
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: input.rpID,
    allowCredentials: [],
    userVerification: "required",
    timeout: PASSKEY_TIMEOUT_MS,
  })
}

/**
 * Verifies a sign-in assertion. Returns the new counter, or throws when the
 * signature, challenge, origin, RP id, user verification or counter is wrong.
 */
export async function verifyAuthentication(input: {
  response: AuthenticationResponseJSON
  challenge: string
  rpID: string
  origins: string[]
  credential: PasskeyCredential
}): Promise<{ counter: number }> {
  const result = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: input.challenge,
    expectedOrigin: input.origins,
    expectedRPID: input.rpID,
    requireUserVerification: true,
    credential: {
      id: input.credential.id,
      publicKey: isoBase64URL.toBuffer(input.credential.publicKey),
      counter: input.credential.counter,
      transports: input.credential.transports as
        | AuthenticatorTransportFuture[]
        | undefined,
    },
  })
  if (!result.verified) throw new Error("passkey assertion not verified")
  return { counter: result.authenticationInfo.newCounter }
}

/** Options for adding a passkey to an account. */
export async function registrationOptions(input: {
  rpID: string
  rpName: string
  /** Stable account id (never the email): becomes the WebAuthn user handle. */
  userID: string
  /** Shown by the passkey manager, usually the email. */
  userName: string
  userDisplayName?: string
  /** The account's passkeys, so the same authenticator is not added twice. */
  exclude?: { id: string; transports?: string[] }[]
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpID: input.rpID,
    rpName: input.rpName,
    userID: new TextEncoder().encode(input.userID),
    userName: input.userName,
    userDisplayName: input.userDisplayName ?? input.userName,
    attestationType: "none",
    timeout: PASSKEY_TIMEOUT_MS,
    excludeCredentials: (input.exclude ?? []).map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
    supportedAlgorithmIDs: ALGORITHMS,
  })
}

/** Verifies a registration response; throws when it is not valid. */
export async function verifyRegistration(input: {
  response: RegistrationResponseJSON
  challenge: string
  rpID: string
  origins: string[]
}): Promise<RegisteredPasskey> {
  const result = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: input.challenge,
    expectedOrigin: input.origins,
    expectedRPID: input.rpID,
    requireUserVerification: true,
    supportedAlgorithmIDs: ALGORITHMS,
  })
  if (!result.verified || !result.registrationInfo)
    throw new Error("passkey registration not verified")
  const info = result.registrationInfo
  return {
    id: info.credential.id,
    publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
    counter: info.credential.counter,
    transports: (info.credential.transports ?? []) as string[],
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    aaguid: info.aaguid,
  }
}

/**
 * Browser side of both ceremonies, as an inline script (no external file, so
 * pages keep their CSP). Defines `window.oaPasskey`:
 *
 * - `supported()` → boolean
 * - `autofillSupported()` → Promise<boolean>
 * - `get(options, { conditional, signal })` → assertion JSON
 * - `create(options)` → registration JSON
 *
 * Options and results are the JSON shapes `@simplewebauthn/server` uses.
 */
export const passkeyClientScript = `(function(){
if (window.oaPasskey) return;
function b64urlToBuf(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u.buffer;}
function bufToB64url(buf){var u=new Uint8Array(buf),s='';for(var i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}
function supported(){return !!(window.PublicKeyCredential&&navigator.credentials&&navigator.credentials.get);}
function autofillSupported(){if(!supported()||!PublicKeyCredential.isConditionalMediationAvailable)return Promise.resolve(false);return PublicKeyCredential.isConditionalMediationAvailable().catch(function(){return false;});}
function descriptors(list){return (list||[]).map(function(c){return {type:'public-key',id:b64urlToBuf(c.id),transports:c.transports};});}
function get(o,opts){opts=opts||{};var pk={challenge:b64urlToBuf(o.challenge),timeout:o.timeout,rpId:o.rpId,userVerification:o.userVerification,allowCredentials:descriptors(o.allowCredentials)};
var req={publicKey:pk};if(opts.conditional)req.mediation='conditional';if(opts.signal)req.signal=opts.signal;
return navigator.credentials.get(req).then(function(c){var r=c.response;return {id:c.id,rawId:bufToB64url(c.rawId),type:c.type,clientExtensionResults:c.getClientExtensionResults?c.getClientExtensionResults():{},authenticatorAttachment:c.authenticatorAttachment||undefined,response:{clientDataJSON:bufToB64url(r.clientDataJSON),authenticatorData:bufToB64url(r.authenticatorData),signature:bufToB64url(r.signature),userHandle:r.userHandle?bufToB64url(r.userHandle):undefined}};});}
function create(o){var pk={challenge:b64urlToBuf(o.challenge),rp:o.rp,user:{id:b64urlToBuf(o.user.id),name:o.user.name,displayName:o.user.displayName},pubKeyCredParams:o.pubKeyCredParams,timeout:o.timeout,attestation:o.attestation,authenticatorSelection:o.authenticatorSelection,excludeCredentials:descriptors(o.excludeCredentials),extensions:o.extensions};
return navigator.credentials.create({publicKey:pk}).then(function(c){var r=c.response;return {id:c.id,rawId:bufToB64url(c.rawId),type:c.type,clientExtensionResults:c.getClientExtensionResults?c.getClientExtensionResults():{},authenticatorAttachment:c.authenticatorAttachment||undefined,response:{clientDataJSON:bufToB64url(r.clientDataJSON),attestationObject:bufToB64url(r.attestationObject),transports:r.getTransports?r.getTransports():[]}};});}
window.oaPasskey={supported:supported,autofillSupported:autofillSupported,get:get,create:create};
})();`
