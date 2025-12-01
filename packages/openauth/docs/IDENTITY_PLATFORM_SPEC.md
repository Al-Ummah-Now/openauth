# AlUmmahNow Identity Platform - Feature Specification

## Overview

Enterprise SSO platform supporting multi-tenant white-label deployment and SaaS offering.

## Core Features

### 1. Client Registration & Validation

| Feature                       | Description                                            |
| ----------------------------- | ------------------------------------------------------ |
| Mandatory client registration | All OAuth clients must be registered before use        |
| Authorize endpoint validation | Validate client_id + redirect_uri before showing login |
| Token endpoint validation     | Validate all clients (public + confidential)           |
| Grant type enforcement        | Only allow registered grant types per client           |
| Redirect URI strict match     | Exact match only, no wildcards                         |

### 2. Single Sign-On (SSO)

| Feature                  | Description                                      |
| ------------------------ | ------------------------------------------------ |
| Silent authentication    | prompt=none - Check session without UI           |
| Shared session cookie    | Session valid across all apps in tenant          |
| Automatic token issuance | If session exists, issue tokens without login UI |
| Session check endpoint   | API to verify session status                     |
| Cross-app session sync   | Login in App A = logged in to App B              |

### 3. Multi-Account Sessions

| Feature                     | Description                                 |
| --------------------------- | ------------------------------------------- |
| Multiple logged-in accounts | Up to 3 accounts per browser                |
| Active account designation  | One account is "active" at a time           |
| Account switcher            | prompt=select_account shows picker          |
| Add account flow            | Login without signing out existing accounts |
| Per-account sign out        | Remove one account, keep others             |
| Sign out all                | Clear all accounts from browser             |

### 4. Session Management

| Feature                   | Description                                 |
| ------------------------- | ------------------------------------------- |
| 7-day session lifetime    | Sessions expire after 7 days of inactivity  |
| Sliding expiration        | Activity extends session                    |
| Session listing           | User can see all active sessions            |
| Remote session revocation | User can sign out other devices             |
| Admin force logout        | Admin can terminate any user's sessions     |
| Admin logout all          | Admin can terminate all sessions for a user |

### 5. Token Architecture

| Feature                  | Description                               |
| ------------------------ | ----------------------------------------- |
| Token per app            | Each app receives its own access token    |
| Audience claim           | Token specifies which app it's for        |
| Centralized refresh      | Refresh tokens managed by auth server     |
| Token introspection      | Apps can verify tokens with auth server   |
| Cross-app token exchange | Exchange token from App A for App B token |

### 6. Role-Based Access Control (RBAC)

| Feature                    | Description                                |
| -------------------------- | ------------------------------------------ |
| Centralized roles          | Global roles defined at platform level     |
| App-specific permissions   | Each app defines its own permissions       |
| Role-permission mapping    | Roles grant permissions across apps        |
| Permission in token        | Access token includes relevant permissions |
| Real-time permission check | Apps can query current permissions         |

### 7. Multi-Tenant / White-Label

| Feature                 | Description                              |
| ----------------------- | ---------------------------------------- |
| Tenant isolation        | Complete data separation between tenants |
| Custom domain           | Each tenant can use their own domain     |
| Custom branding         | Logo, colors, email templates per tenant |
| Tenant-specific clients | OAuth clients scoped to tenant           |
| Tenant-specific roles   | Role definitions per tenant              |
| Tenant admin            | Delegated admin per tenant               |

### 8. Admin Controls

| Feature            | Description                                       |
| ------------------ | ------------------------------------------------- |
| User management    | Create, update, suspend, delete users             |
| Session management | View and terminate user sessions                  |
| Client management  | Register, update, delete OAuth clients            |
| Role management    | Define and assign roles                           |
| Audit logs         | All actions logged with actor, timestamp, details |
| Security alerts    | Suspicious activity notifications                 |

---

## Interactions

### A. SSO Login Flow

```
User → App A (not logged in)
     → Auth Server /authorize?client_id=app-a&prompt=none
     → Auth Server checks session
     → [Session exists] → Redirect to App A with code
     → [No session] → Redirect with error=login_required
     → App A shows login button
     → User clicks login
     → Auth Server /authorize?client_id=app-a
     → User authenticates
     → Session created (7 days)
     → Redirect to App A with code
     → App A exchanges code for tokens
     → User logged in
```

### B. SSO Cross-App Flow

```
User logged into App A
     → Visits App B
     → App B redirects to Auth Server /authorize?client_id=app-b&prompt=none
     → Auth Server finds existing session
     → Issues new authorization code for App B
     → Redirect to App B
     → App B exchanges code for its own tokens
     → User logged into App B (no login UI shown)
```

### C. Add Account Flow

```
User logged in as Account 1
     → Clicks "Add account"
     → Auth Server /authorize?prompt=login&action=add_account
     → Login UI shown (existing session preserved)
     → User authenticates as Account 2
     → Account 2 added to browser session
     → Account 2 becomes active
     → Redirect back to app
     → Now 2 accounts in session
```

### D. Switch Account Flow

```
User has 2 accounts, Account 1 is active
     → Clicks account switcher
     → Auth Server /authorize?prompt=select_account
     → Account picker UI shown
     → User selects Account 2
     → Account 2 becomes active
     → New tokens issued for Account 2
     → Redirect back to app
```

### E. Sign Out One Account

```
User has 3 accounts logged in
     → Opens account menu
     → Clicks "Sign out" on Account 2
     → DELETE /session/accounts/user_456
     → Account 2 removed from browser session
     → If Account 2 was active, Account 1 becomes active
     → 2 accounts remain
```

### F. Admin Force Logout

```
Admin views user in dashboard
     → Sees user has 5 active sessions
     → Clicks "Terminate all sessions"
     → POST /admin/users/{userId}/sessions/revoke-all
     → All sessions for user invalidated
     → All refresh tokens revoked
     → User must re-authenticate on all devices
     → Audit event logged
```

### G. Token Per App with Permissions

```
User with role "editor" logs into App A
     → App A requests scope: "read write"
     → Token issued:
       {
         sub: "user_123",
         aud: "app-a",
         roles: ["editor"],
         permissions: ["articles:read", "articles:write"]
       }

Same user logs into App B (admin dashboard)
     → App B requests scope: "admin"
     → Token issued:
       {
         sub: "user_123",
         aud: "app-b",
         roles: ["editor"],
         permissions: ["dashboard:view"]  // editor has limited admin access
       }
```

### H. Multi-Tenant White-Label

```
Tenant: "client-corp"
     → Domain: auth.clientcorp.com
     → Branding: Client Corp logo, blue theme
     → Users: Only Client Corp employees
     → Apps: client-corp-app-1, client-corp-app-2
     → Roles: client-corp-admin, client-corp-user

Tenant: "alummahnow" (default)
     → Domain: auth.alummahnow.net
     → Branding: AlUmmahNow logo, green theme
     → Users: AlUmmahNow users
     → Apps: profile-app, admin-dashboard, news-app
     → Roles: admin, user, moderator
```

---

## OpenID Connect Parameters Required

| Parameter    | Values                               | Purpose                             |
| ------------ | ------------------------------------ | ----------------------------------- |
| prompt       | none, login, consent, select_account | Control auth UI behavior            |
| login_hint   | email                                | Pre-fill login form                 |
| account_hint | user_id                              | Select specific logged-in account   |
| max_age      | seconds                              | Force re-auth if session older than |
| acr_values   | mfa                                  | Require specific auth level         |

---

## Session Cookie Requirements

| Attribute | Value              | Reason                           |
| --------- | ------------------ | -------------------------------- |
| Name      | `__session`        | Standard                         |
| Domain    | `.{tenant-domain}` | Shared across subdomains         |
| Secure    | true               | HTTPS only                       |
| HttpOnly  | true               | No JS access                     |
| SameSite  | Lax                | CSRF protection + redirects work |
| Max-Age   | 604800             | 7 days                           |

---

## API Endpoints Required

### Session APIs

```
GET    /session/accounts           - List logged-in accounts
POST   /session/switch             - Switch active account
DELETE /session/accounts/:userId   - Sign out one account
DELETE /session/all                - Sign out all accounts
GET    /session/check              - Silent session check
```

### Admin APIs

```
GET    /admin/users/:userId/sessions              - List user's sessions
DELETE /admin/users/:userId/sessions/:sessionId   - Terminate specific session
DELETE /admin/users/:userId/sessions              - Terminate all user sessions
POST   /admin/users/:userId/force-logout          - Force logout everywhere
```

### Tenant APIs (for SaaS)

```
POST   /tenants              - Create tenant
GET    /tenants/:tenantId    - Get tenant config
PUT    /tenants/:tenantId    - Update tenant (branding, domain)
DELETE /tenants/:tenantId    - Delete tenant
```

---

## Data Model Requirements

### Browser Session

```
ID, created_at, last_activity, user_agent, ip_address, tenant_id
```

### Account Session

```
ID, browser_session_id, user_id, is_active, authenticated_at, expires_at
```

### App Token

```
ID, account_session_id, client_id, scope, issued_at, expires_at
```

### Tenant

```
ID, domain, name, branding (JSON), settings (JSON), created_at
```

---

## Constraints

| Constraint               | Value  |
| ------------------------ | ------ |
| Max accounts per browser | 3      |
| Session lifetime         | 7 days |
| Access token lifetime    | 1 hour |
| Refresh token lifetime   | 7 days |
| Max sessions per user    | 10     |

---

## What OpenAuth Needs to Support

- [ ] Client validation at /authorize - Currently missing
- [ ] `prompt` parameter handling - none, login, select_account
- [ ] Multi-account session storage - Browser session → multiple user sessions
- [ ] Account switcher UI - Built-in or customizable
- [ ] Session management APIs - List, switch, remove accounts
- [ ] Token audience enforcement - Different token per client
- [ ] Tenant context - All operations scoped to tenant
- [ ] Admin session control - Force logout capabilities

---

## Implementation Phases

### Phase 1: Core Infrastructure

1. Session Service with multi-account support
2. Tenant-aware storage layer
3. Tenant management service

### Phase 2: SSO Features

1. `prompt` parameter handling
2. Silent authentication (prompt=none)
3. Session check endpoint
4. Account switcher UI

### Phase 3: RBAC System

1. Role/Permission storage schema
2. Token enrichment with permissions
3. Permission check API
4. Admin role management APIs

### Phase 4: Multi-Tenant White-Label

1. Tenant resolution (domain/subdomain/header)
2. Tenant-scoped storage
3. Custom branding/theming
4. Delegated tenant admin

### Phase 5: Admin Controls

1. User management APIs
2. Session management dashboard
3. Audit logging
4. Security alerts
