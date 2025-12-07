-- Migration 005: User Management Tables
-- Run with: wrangler d1 execute openauth-db --file=./src/migrations/005_user_management.sql

PRAGMA foreign_keys = ON;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    metadata TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_login_at INTEGER,
    deleted_at INTEGER,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Unique email per tenant (only for non-deleted users)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email
    ON users(tenant_id, email) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_users_updated ON users(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- User identities table
CREATE TABLE IF NOT EXISTS user_identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    provider_data TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_identities_provider
    ON user_identities(tenant_id, provider, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_identities_user ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_identities_tenant_provider
    ON user_identities(tenant_id, provider);
