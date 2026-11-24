---
"@openauthjs/openauth": patch
---

`accessTokenClaims`: extra top-level claims for access tokens, computed at sign-in and at each refresh and stored nowhere; a standard claim can't be set and an error adds none. The enterprise issuer's `extraClaimsSupported` lists them in `claims_supported`.
