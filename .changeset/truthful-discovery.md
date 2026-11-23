---
"@openauthjs/openauth": patch
---

Discovery documents list only what the issuer serves (no `registration_endpoint`, `id_token` or `prompt=consent`; introspection and revocation when clients are registered; `service_documentation` from the new `documentation` option). `/userinfo` answers an invalid token with 401 and `WWW-Authenticate` instead of 200 or an HTML 400, and 500 when the server can't read its own keys.
