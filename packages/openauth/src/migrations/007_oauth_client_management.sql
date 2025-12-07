-- Migration 007: OAuth Client Management Extensions
-- Adds columns for secret rotation, metadata, and enabled status
-- Required for Phase 5: OAuth Client Management API
--
-- Run with: wrangler d1 execute openauth-db --file=./src/migrations/007_oauth_client_management.sql

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- ============================================
-- OAUTH CLIENTS TABLE EXTENSIONS
-- ============================================

-- Add 'name' column as alias for client_name (for consistency)
-- SQLite doesn't support renaming columns in older versions,
-- so we add 'name' as a separate column that mirrors client_name
ALTER TABLE oauth_clients ADD COLUMN name TEXT;

-- Add 'enabled' column to allow disabling clients
-- Default to 1 (enabled) for backward compatibility
ALTER TABLE oauth_clients ADD COLUMN enabled INTEGER DEFAULT 1;

-- Add 'metadata' column for storing arbitrary client metadata
-- Stored as JSON text
ALTER TABLE oauth_clients ADD COLUMN metadata TEXT DEFAULT '{}';

-- Add 'rotated_at' column to track when secret was last rotated
-- NULL if never rotated
ALTER TABLE oauth_clients ADD COLUMN rotated_at INTEGER;

-- Add 'previous_secret_hash' column for grace period support
-- Stores the hash of the previous secret during rotation grace period
ALTER TABLE oauth_clients ADD COLUMN previous_secret_hash TEXT;

-- Add 'previous_secret_expires_at' column
-- Unix timestamp in milliseconds when previous secret expires
-- After this time, only the current secret is valid
ALTER TABLE oauth_clients ADD COLUMN previous_secret_expires_at INTEGER;

-- ============================================
-- DATA MIGRATION
-- ============================================

-- Copy client_name to name for existing rows
UPDATE oauth_clients SET name = client_name WHERE name IS NULL;

-- ============================================
-- INDEXES
-- ============================================

-- Index for filtering by enabled status
CREATE INDEX IF NOT EXISTS idx_oauth_clients_enabled ON oauth_clients(enabled);

-- Composite index for tenant + name lookups (uniqueness check)
CREATE INDEX IF NOT EXISTS idx_oauth_clients_tenant_name ON oauth_clients(tenant_id, name);
