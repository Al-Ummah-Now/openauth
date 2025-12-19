-- ============================================================================
-- SEED DATA: Default clients, users, roles, and permissions
-- ============================================================================
-- This seed file creates a baseline configuration for the OpenAuth system.
-- Run after 001_schema.sql to populate default data.
-- ============================================================================

-- ============================================================================
-- SECTION 1: DEFAULT OAUTH CLIENTS
-- ============================================================================

-- Admin Dashboard Client (confidential)
INSERT OR IGNORE INTO oauth_clients (
    id, tenant_id, name, client_secret_hash, grant_types, scopes,
    redirect_uris, metadata, enabled, created_at, updated_at
) VALUES (
    'client_admin_dashboard',
    'default',
    'Admin Dashboard',
    '', -- Secret should be set via API after creation
    '["authorization_code", "refresh_token"]',
    '["openid", "profile", "email", "admin:read", "admin:write"]',
    '["http://localhost:3000/callback", "https://admin.example.com/callback"]',
    '{"description": "Administrative dashboard application", "type": "confidential"}',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- API Service Client (M2M)
INSERT OR IGNORE INTO oauth_clients (
    id, tenant_id, name, client_secret_hash, grant_types, scopes,
    redirect_uris, metadata, enabled, created_at, updated_at
) VALUES (
    'client_api_service',
    'default',
    'API Service',
    '', -- Secret should be set via API after creation
    '["client_credentials"]',
    '["api:read", "api:write", "users:read"]',
    '[]',
    '{"description": "Backend API service for M2M communication", "type": "confidential"}',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Mobile App Client (public)
INSERT OR IGNORE INTO oauth_clients (
    id, tenant_id, name, client_secret_hash, grant_types, scopes,
    redirect_uris, metadata, enabled, created_at, updated_at
) VALUES (
    'client_mobile_app',
    'default',
    'Mobile Application',
    '', -- Public client, no secret required
    '["authorization_code", "refresh_token"]',
    '["openid", "profile", "email", "offline_access"]',
    '["com.example.app://callback", "https://app.example.com/callback"]',
    '{"description": "Mobile application client", "type": "public"}',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Web Application Client (confidential)
INSERT OR IGNORE INTO oauth_clients (
    id, tenant_id, name, client_secret_hash, grant_types, scopes,
    redirect_uris, metadata, enabled, created_at, updated_at
) VALUES (
    'client_web_app',
    'default',
    'Web Application',
    '', -- Secret should be set via API after creation
    '["authorization_code", "refresh_token"]',
    '["openid", "profile", "email"]',
    '["http://localhost:3000/auth/callback", "https://www.example.com/auth/callback"]',
    '{"description": "Main web application", "type": "confidential"}',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- ============================================================================
-- SECTION 2: RBAC PERMISSIONS
-- ============================================================================
-- Permissions are now scoped directly to OAuth clients

-- Admin Dashboard Permissions (full admin access)
INSERT OR IGNORE INTO rbac_permissions (id, name, client_id, description, resource, action, created_at)
VALUES
    ('perm_admin_platform', 'platform:admin', 'client_admin_dashboard', 'Full platform administration', 'platform', 'admin', strftime('%s', 'now') * 1000),
    ('perm_admin_settings_read', 'settings:read', 'client_admin_dashboard', 'View platform settings', 'settings', 'read', strftime('%s', 'now') * 1000),
    ('perm_admin_settings_write', 'settings:write', 'client_admin_dashboard', 'Modify platform settings', 'settings', 'write', strftime('%s', 'now') * 1000),
    ('perm_admin_audit_read', 'audit:read', 'client_admin_dashboard', 'View audit logs', 'audit', 'read', strftime('%s', 'now') * 1000),
    ('perm_admin_users_read', 'users:read', 'client_admin_dashboard', 'View user profiles', 'users', 'read', strftime('%s', 'now') * 1000),
    ('perm_admin_users_write', 'users:write', 'client_admin_dashboard', 'Create and update users', 'users', 'write', strftime('%s', 'now') * 1000),
    ('perm_admin_users_delete', 'users:delete', 'client_admin_dashboard', 'Delete users', 'users', 'delete', strftime('%s', 'now') * 1000),
    ('perm_admin_roles_assign', 'roles:assign', 'client_admin_dashboard', 'Assign roles to users', 'roles', 'assign', strftime('%s', 'now') * 1000),
    ('perm_admin_roles_revoke', 'roles:revoke', 'client_admin_dashboard', 'Revoke roles from users', 'roles', 'revoke', strftime('%s', 'now') * 1000),
    ('perm_admin_clients_read', 'clients:read', 'client_admin_dashboard', 'View OAuth clients', 'clients', 'read', strftime('%s', 'now') * 1000),
    ('perm_admin_clients_write', 'clients:write', 'client_admin_dashboard', 'Create and update OAuth clients', 'clients', 'write', strftime('%s', 'now') * 1000),
    ('perm_admin_clients_delete', 'clients:delete', 'client_admin_dashboard', 'Delete OAuth clients', 'clients', 'delete', strftime('%s', 'now') * 1000),
    ('perm_admin_secrets_rotate', 'secrets:rotate', 'client_admin_dashboard', 'Rotate client secrets', 'secrets', 'rotate', strftime('%s', 'now') * 1000);

-- API Service Permissions (M2M backend access)
INSERT OR IGNORE INTO rbac_permissions (id, name, client_id, description, resource, action, created_at)
VALUES
    ('perm_api_read', 'api:read', 'client_api_service', 'Read API resources', 'api', 'read', strftime('%s', 'now') * 1000),
    ('perm_api_write', 'api:write', 'client_api_service', 'Write API resources', 'api', 'write', strftime('%s', 'now') * 1000),
    ('perm_api_users_read', 'users:read', 'client_api_service', 'View user profiles', 'users', 'read', strftime('%s', 'now') * 1000);

-- Web App Permissions (standard user access)
INSERT OR IGNORE INTO rbac_permissions (id, name, client_id, description, resource, action, created_at)
VALUES
    ('perm_web_profile_read', 'profile:read', 'client_web_app', 'Read own profile', 'profile', 'read', strftime('%s', 'now') * 1000),
    ('perm_web_profile_write', 'profile:write', 'client_web_app', 'Update own profile', 'profile', 'write', strftime('%s', 'now') * 1000);

-- Mobile App Permissions (standard user access)
INSERT OR IGNORE INTO rbac_permissions (id, name, client_id, description, resource, action, created_at)
VALUES
    ('perm_mobile_profile_read', 'profile:read', 'client_mobile_app', 'Read own profile', 'profile', 'read', strftime('%s', 'now') * 1000),
    ('perm_mobile_profile_write', 'profile:write', 'client_mobile_app', 'Update own profile', 'profile', 'write', strftime('%s', 'now') * 1000);

-- ============================================================================
-- SECTION 3: RBAC ROLES
-- ============================================================================

-- Super Admin Role (all permissions)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_super_admin',
    'Super Admin',
    'default',
    'Full system access with all permissions',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Admin Role (manage users and clients)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_admin',
    'Admin',
    'default',
    'Administrative access for user and client management',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- User Manager Role (manage users only)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_user_manager',
    'User Manager',
    'default',
    'Manage user accounts and roles',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Client Manager Role (manage OAuth clients)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_client_manager',
    'Client Manager',
    'default',
    'Manage OAuth clients and their configurations',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Auditor Role (read-only access to logs)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_auditor',
    'Auditor',
    'default',
    'Read-only access to audit logs and system information',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- API User Role (basic API access)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_api_user',
    'API User',
    'default',
    'Basic API read/write access',
    0,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Member Role (default user role)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_member',
    'Member',
    'default',
    'Standard member with basic access',
    0,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Viewer Role (read-only)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_viewer',
    'Viewer',
    'default',
    'Read-only access to resources',
    0,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- ============================================================================
-- SECTION 4: ROLE-PERMISSION MAPPINGS
-- ============================================================================

-- Super Admin: All permissions for admin dashboard client
INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
SELECT 'role_super_admin', id, strftime('%s', 'now') * 1000, 'system'
FROM rbac_permissions WHERE client_id = 'client_admin_dashboard';

-- Admin: User and client management (admin dashboard permissions)
INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
VALUES
    ('role_admin', 'perm_admin_users_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_admin_users_write', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_admin_users_delete', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_admin_roles_assign', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_admin_roles_revoke', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_admin_clients_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_admin_clients_write', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_admin_clients_delete', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_admin_secrets_rotate', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_admin_settings_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_admin_audit_read', strftime('%s', 'now') * 1000, 'system');

-- User Manager: User management only
INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
VALUES
    ('role_user_manager', 'perm_admin_users_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_user_manager', 'perm_admin_users_write', strftime('%s', 'now') * 1000, 'system'),
    ('role_user_manager', 'perm_admin_users_delete', strftime('%s', 'now') * 1000, 'system'),
    ('role_user_manager', 'perm_admin_roles_assign', strftime('%s', 'now') * 1000, 'system'),
    ('role_user_manager', 'perm_admin_roles_revoke', strftime('%s', 'now') * 1000, 'system');

-- Client Manager: Client management only
INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
VALUES
    ('role_client_manager', 'perm_admin_clients_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_client_manager', 'perm_admin_clients_write', strftime('%s', 'now') * 1000, 'system'),
    ('role_client_manager', 'perm_admin_clients_delete', strftime('%s', 'now') * 1000, 'system'),
    ('role_client_manager', 'perm_admin_secrets_rotate', strftime('%s', 'now') * 1000, 'system');

-- Auditor: Read-only audit access
INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
VALUES
    ('role_auditor', 'perm_admin_audit_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_auditor', 'perm_admin_settings_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_auditor', 'perm_admin_users_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_auditor', 'perm_admin_clients_read', strftime('%s', 'now') * 1000, 'system');

-- API User: Basic API access (for API service client)
INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
VALUES
    ('role_api_user', 'perm_api_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_api_user', 'perm_api_write', strftime('%s', 'now') * 1000, 'system');

-- Member: Basic profile access (for web/mobile apps)
INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
VALUES
    ('role_member', 'perm_web_profile_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_member', 'perm_web_profile_write', strftime('%s', 'now') * 1000, 'system'),
    ('role_member', 'perm_mobile_profile_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_member', 'perm_mobile_profile_write', strftime('%s', 'now') * 1000, 'system');

-- Viewer: Read-only profile access
INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
VALUES
    ('role_viewer', 'perm_web_profile_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_viewer', 'perm_mobile_profile_read', strftime('%s', 'now') * 1000, 'system');

-- ============================================================================
-- SECTION 5: DEFAULT USERS (for development/testing)
-- ============================================================================
-- Note: In production, users should be created through the authentication flow.
-- These are placeholder entries for development environments.

-- System user (for automated operations)
INSERT OR IGNORE INTO users (
    id, tenant_id, email, name, metadata, status, created_at, updated_at
) VALUES (
    'user_system',
    'default',
    'system@openauth.local',
    'System',
    '{"type": "system", "description": "Automated system operations"}',
    'active',
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Assign super admin role to system user
INSERT OR IGNORE INTO rbac_user_roles (user_id, role_id, tenant_id, assigned_at, assigned_by)
VALUES (
    'user_system',
    'role_super_admin',
    'default',
    strftime('%s', 'now') * 1000,
    'system'
);

-- ============================================================================
-- VERIFICATION QUERIES (for testing - comment out in production)
-- ============================================================================
-- SELECT 'Clients:' AS entity, COUNT(*) AS count FROM oauth_clients
-- UNION ALL SELECT 'Permissions:', COUNT(*) FROM rbac_permissions
-- UNION ALL SELECT 'Roles:', COUNT(*) FROM rbac_roles
-- UNION ALL SELECT 'Role-Permissions:', COUNT(*) FROM rbac_role_permissions;
