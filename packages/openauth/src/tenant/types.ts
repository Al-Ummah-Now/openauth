/**
 * Tenant Management Types
 *
 * Re-exports contracts from the shared contracts module and defines
 * internal types used by the tenant implementation.
 *
 * @packageDocumentation
 */

// Re-export all tenant-related types from contracts
export type {
  Theme,
  TenantBranding,
  EmailTemplateConfig,
  TenantSettings,
  TenantStatus,
  Tenant,
  TenantService,
  TenantResolver,
  TenantStorage,
  TenantContext,
} from "../contracts/types.js"

export { TenantError } from "../contracts/types.js"
export type { TenantErrorCode } from "../contracts/types.js"

// ============================================
// INTERNAL TYPES
// ============================================

/**
 * Parameters for creating a new tenant
 */
export interface CreateTenantParams {
  id: string
  name: string
  domain?: string
  branding?: import("../contracts/types.js").TenantBranding
  settings?: import("../contracts/types.js").TenantSettings
}

/**
 * Parameters for updating a tenant
 */
export interface UpdateTenantParams {
  name?: string
  domain?: string
  status?: import("../contracts/types.js").TenantStatus
  branding?: import("../contracts/types.js").TenantBranding
  settings?: import("../contracts/types.js").TenantSettings
}

/**
 * Parameters for listing tenants
 */
export interface ListTenantsParams {
  status?: import("../contracts/types.js").TenantStatus
  limit?: number
  offset?: number
}

/**
 * Domain lookup record stored in KV
 * Maps a domain to its tenant ID
 */
export interface DomainLookup {
  tenantId: string
}

/**
 * Tenant resolution strategies
 */
export type TenantResolutionStrategy =
  | "custom_domain" // auth.clientcorp.com
  | "subdomain" // clientcorp.auth.example.com
  | "path_prefix" // /tenants/tenant123/...
  | "header" // X-Tenant-ID header
  | "query" // ?tenant=tenant123

/**
 * Result of tenant resolution
 */
export interface TenantResolutionResult {
  tenantId: string
  strategy: TenantResolutionStrategy
}

/**
 * Configuration for tenant resolver
 */
export interface TenantResolverConfig {
  /** Base domain for subdomain extraction (e.g., "auth.example.com") */
  baseDomain?: string
  /** Path prefix for path-based resolution (e.g., "/tenants") */
  pathPrefix?: string
  /** Header name for header-based resolution */
  headerName?: string
  /** Query parameter name for query-based resolution */
  queryParam?: string
  /** List of known custom domains (if not using DB lookup) */
  customDomains?: Map<string, string>
}

/**
 * Default resolver configuration
 */
export const DEFAULT_RESOLVER_CONFIG: TenantResolverConfig = {
  pathPrefix: "/tenants",
  headerName: "X-Tenant-ID",
  queryParam: "tenant",
}

/**
 * Storage keys used by tenant service
 * Returns mutable string arrays for compatibility with StorageAdapter
 */
export const TENANT_STORAGE_KEYS = {
  /** Key pattern for tenant data: ["tenant", tenantId] */
  tenant: (tenantId: string): string[] => ["tenant", tenantId],
  /** Key pattern for domain lookup: ["tenant", "domain", domain] */
  domain: (domain: string): string[] => ["tenant", "domain", domain],
  /** Prefix for scanning all tenants */
  tenantPrefix: ["tenant"] as string[],
}

/**
 * Tenant prefix for storage isolation
 */
export const TENANT_STORAGE_PREFIX = "t" as const

/**
 * CSS custom property names for theme variables
 * Aligned with the standard OpenAuth Theme interface
 */
export const THEME_CSS_VARS = {
  primary: "--oa-primary",
  background: "--oa-background",
  fontFamily: "--oa-font-family",
} as const

/**
 * HTTP header names for theme data
 */
export const THEME_HEADERS = {
  themeVars: "X-Theme-Vars",
  customCss: "X-Custom-CSS",
  logoLight: "X-Logo-Light",
  logoDark: "X-Logo-Dark",
  favicon: "X-Favicon",
} as const
