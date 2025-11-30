-- OAuth Client Credentials Schema
-- This schema is for Cloudflare D1 database

-- Main table for OAuth client credentials
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret_hash TEXT NOT NULL,      -- PBKDF2 hash: salt:hash
  client_name TEXT NOT NULL,
  redirect_uris TEXT,                    -- JSON array of allowed redirect URIs
  grant_types TEXT,                      -- JSON array of allowed grant types
  scopes TEXT,                           -- JSON array of allowed scopes
  created_at INTEGER NOT NULL,           -- Unix timestamp in milliseconds
  updated_at INTEGER                     -- Unix timestamp in milliseconds
);

-- Index for faster client name lookups
CREATE INDEX IF NOT EXISTS idx_client_name ON oauth_clients(client_name);

-- Index for created_at for sorting/filtering
CREATE INDEX IF NOT EXISTS idx_created_at ON oauth_clients(created_at);
