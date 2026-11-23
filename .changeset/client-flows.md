---
"@openauthjs/openauth": patch
---

client: `clientCredentials`, `device.start` / `device.poll`, `revoke` and `userinfo`. Failures are returned as `AuthRequestError`, never thrown.
