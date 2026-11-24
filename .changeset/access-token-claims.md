---
"@openauthjs/openauth": patch
---

`accessTokenClaims`: extra top-level claims for a person's access tokens, computed at sign-in and at each refresh and stored nowhere; machine tokens are unchanged; a standard claim can't be set and an error adds none. The enterprise issuer's `extraClaimsSupported` lists them in `claims_supported`.
