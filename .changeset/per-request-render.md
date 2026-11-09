---
"@openauthjs/openauth": patch
---

Pages render with their own request's theme and language instead of a global, so concurrent requests (and several issuers or tenants in one isolate) no longer see each other's branding.
