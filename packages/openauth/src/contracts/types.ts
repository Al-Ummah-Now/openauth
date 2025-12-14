/**
 * Shared contracts for enterprise SSO features.
 * All implementations MUST adhere to these interfaces.
 *
 * @packageDocumentation
 */

import type { StorageAdapter } from "../storage/storage.js"

// ============================================
// SESSION CONTRACTS
// ============================================

export interface BrowserSession {
  id: string
  tenant_id: string
  created_at: number
  last_activity: number
  user_agent: string
  ip_address: string
  version: number // Optimistic concurrency control
  active_user_id: string | null
  account_user_ids: string[] // Max 3 accounts
}

export interface AccountSession {
  id: string
  browser_session_id: string
  user_id: string
  is_active: boolean
  authenticated_at: number
  expires_at: number
  subject_type: string
  subject_properties: Record<string, unknown>
  refresh_token: string
  client_id: string
}

export interface SessionCookiePayload {
  sid: string // Browser session ID
  tid: string // Tenant ID
  v: number // Version (optimistic concurrency)
  iat: number // Issued at
}

export interface SessionConfig {
  maxAccountsPerSession: number
  sessionLifetimeSeconds: number
  slidingWindowSeconds: number
  cookieName: string
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  maxAccountsPerSession: 3,
  sessionLifetimeSeconds: 7 * 24 * 60 * 60, // 7 days
  slidingWindowSeconds: 24 * 60 * 60, // 1 day
  cookieName: "__session",
}

export interface SessionService {
  // Browser session operations
  createBrowserSession(params: {
    tenantId: string
    userAgent: string
    ipAddress: string
  }): Promise<BrowserSession>

  getBrowserSession(
    sessionId: string,
    tenantId: string,
  ): Promise<BrowserSession | null>

  updateBrowserSession(session: BrowserSession): Promise<void>

  // Account session operations
  addAccountToSession(params: {
    browserSessionId: string
    userId: string
    subjectType: string
    subjectProperties: Record<string, unknown>
    refreshToken: string
    clientId: string
    ttl: number
  }): Promise<AccountSession>

  getAccountSession(
    browserSessionId: string,
    userId: string,
  ): Promise<AccountSession | null>

  listAccounts(browserSessionId: string): Promise<AccountSession[]>

  switchActiveAccount(browserSessionId: string, userId: string): Promise<void>

  removeAccount(browserSessionId: string, userId: string): Promise<void>

  removeAllAccounts(browserSessionId: string): Promise<void>

  // Admin operations
  revokeUserSessions(tenantId: string, userId: string): Promise<number>

  revokeSpecificSession(sessionId: string, tenantId: string): Promise<boolean>
}

// ============================================
// TENANT CONTRACTS
// ============================================

export interface Theme {
  primary?: string
  secondary?: string
  background?: string
  text?: string
  logo?: string
  fontFamily?: string
}

export interface TenantBranding {
  theme?: Partial<Theme>
  logoLight?: string
  logoDark?: string
  favicon?: string
  customCss?: string
  emailTemplates?: EmailTemplateConfig
}

export interface EmailTemplateConfig {
  welcome?: string
  verification?: string
  passwordReset?: string
  magicLink?: string
}

export interface TenantSettings {
  maxAccountsPerSession?: number
  sessionLifetime?: number
  allowPublicRegistration?: boolean
  requireEmailVerification?: boolean
  allowedProviders?: string[]
  mfaRequired?: boolean
}

export type TenantStatus = "active" | "suspended" | "pending" | "deleted"

export interface Tenant {
  id: string
  domain?: string
  name: string
  status: TenantStatus
  branding: TenantBranding
  settings: TenantSettings
  created_at: number
  updated_at: number
}

export interface TenantService {
  createTenant(params: {
    id: string
    name: string
    domain?: string
    branding?: TenantBranding
    settings?: TenantSettings
  }): Promise<Tenant>

  getTenant(tenantId: string): Promise<Tenant | null>

  getTenantByDomain(domain: string): Promise<Tenant | null>

  updateTenant(tenantId: string, updates: Partial<Tenant>): Promise<Tenant>

  deleteTenant(tenantId: string): Promise<void>

  listTenants(params?: {
    status?: TenantStatus
    limit?: number
    offset?: number
  }): Promise<Tenant[]>
}

export interface TenantResolver {
  resolveTenant(req: Request): Promise<string | null>
}

export interface TenantStorage {
  readonly tenantId: string
  // Wraps StorageAdapter with tenant prefixing
  get(key: string[]): Promise<Record<string, any> | undefined>
  set(key: string[], value: any, ttl?: number): Promise<void>
  remove(key: string[]): Promise<void>
  scan(prefix: string[]): AsyncIterable<[string[], any]>
}

// ============================================
// RBAC CONTRACTS
// ============================================

export interface Role {
  id: string
  name: string
  tenant_id: string
  description?: string
  is_system_role: boolean
  created_at: number
  updated_at: number
}

export interface Permission {
  id: string
  name: string
  client_id: string
  description?: string
  resource: string
  action: string
  created_at: number
}

export interface RolePermission {
  role_id: string
  permission_id: string
  granted_at: number
  granted_by: string
}

export interface UserRole {
  user_id: string
  role_id: string
  tenant_id: string
  assigned_at: number
  expires_at?: number
  assigned_by: string
}

export interface RBACClaims {
  roles: string[]
  permissions: string[]
}

export interface RBACConfig {
  maxPermissionsInToken: number
  permissionCacheTTL: number
}

export const DEFAULT_RBAC_CONFIG: RBACConfig = {
  maxPermissionsInToken: 50,
  permissionCacheTTL: 60, // seconds
}

export interface RBACService {
  // Permission checking
  checkPermission(params: {
    userId: string
    clientId: string
    tenantId: string
    permission: string
  }): Promise<boolean>

  checkPermissions(params: {
    userId: string
    clientId: string
    tenantId: string
    permissions: string[]
  }): Promise<Record<string, boolean>>

  getUserPermissions(params: {
    userId: string
    clientId: string
    tenantId: string
  }): Promise<string[]>

  getUserRoles(userId: string, tenantId: string): Promise<Role[]>

  // Token enrichment
  enrichTokenClaims(params: {
    userId: string
    clientId: string
    tenantId: string
  }): Promise<RBACClaims>

  // Admin operations
  createRole(params: {
    name: string
    tenantId: string
    description?: string
    isSystemRole?: boolean
  }): Promise<Role>

  createPermission(params: {
    name: string
    clientId: string
    resource: string
    action: string
    description?: string
  }): Promise<Permission>

  assignRoleToUser(params: {
    userId: string
    roleId: string
    tenantId: string
    assignedBy: string
    expiresAt?: number
  }): Promise<UserRole>

  removeRoleFromUser(params: {
    userId: string
    roleId: string
    tenantId: string
  }): Promise<void>

  assignPermissionToRole(params: {
    roleId: string
    permissionId: string
    grantedBy: string
  }): Promise<RolePermission>

  removePermissionFromRole(params: {
    roleId: string
    permissionId: string
  }): Promise<void>

  // Listing operations
  listRoles(tenantId: string): Promise<Role[]>
  listPermissions(clientId: string): Promise<Permission[]>
  listRolePermissions(roleId: string): Promise<Permission[]>
  listUserRoles(userId: string, tenantId: string): Promise<UserRole[]>

  // Get operations
  getRole(roleId: string, tenantId: string): Promise<Role | null>
  getPermission(permissionId: string): Promise<Permission | null>

  // Update operations
  updateRole(params: {
    roleId: string
    tenantId: string
    name?: string
    description?: string
  }): Promise<Role>

  // Delete operations
  deleteRole(roleId: string, tenantId: string): Promise<void>
  deletePermission(permissionId: string): Promise<void>
}

// ============================================
// CONTEXT TYPES
// ============================================

export interface TenantContext {
  tenant: Tenant
  tenantStorage: TenantStorage
}

export interface SessionContext {
  browserSession: BrowserSession | null
  activeAccount: AccountSession | null
}

export interface RequestContext extends TenantContext, SessionContext {
  req: Request
}

// ============================================
// OIDC PROMPT PARAMETER
// ============================================

export type PromptType = "none" | "login" | "consent" | "select_account"

export interface AuthorizationRequest {
  client_id: string
  redirect_uri: string
  response_type: string
  scope?: string
  state?: string
  nonce?: string
  prompt?: PromptType
  login_hint?: string
  account_hint?: string
  max_age?: number
  acr_values?: string
}

// ============================================
// ERROR TYPES
// ============================================

export class SessionError extends Error {
  constructor(
    public code: SessionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "SessionError"
  }
}

export type SessionErrorCode =
  | "max_accounts_exceeded"
  | "session_not_found"
  | "account_not_found"
  | "session_expired"
  | "version_conflict"
  | "invalid_cookie"

export class TenantError extends Error {
  constructor(
    public code: TenantErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "TenantError"
  }
}

export type TenantErrorCode =
  | "tenant_not_found"
  | "tenant_suspended"
  | "tenant_deleted"
  | "domain_already_exists"
  | "invalid_tenant_id"

export class RBACError extends Error {
  constructor(
    public code: RBACErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "RBACError"
  }
}

export type RBACErrorCode =
  | "role_not_found"
  | "permission_not_found"
  | "app_not_found"
  | "role_already_assigned"
  | "permission_denied"
  | "invalid_input"
  | "cannot_delete_system_role"
  | "cannot_modify_system_role"
  | "privilege_escalation_denied"
  | "self_assignment_denied"
