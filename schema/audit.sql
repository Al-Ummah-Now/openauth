-- Audit Logging Schema
-- This schema is for Cloudflare D1 database

-- Main table for token usage audit logs
CREATE TABLE IF NOT EXISTS token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id TEXT NOT NULL,               -- Token identifier (refresh token ID or access token JTI)
  subject TEXT NOT NULL,                 -- Subject identifier (e.g., "user:abc123")
  event_type TEXT NOT NULL,              -- Event type: generated, refreshed, revoked, reused
  client_id TEXT,                        -- OAuth client identifier
  ip_address TEXT,                       -- IP address of the request (optional)
  user_agent TEXT,                       -- User agent string (optional)
  timestamp INTEGER NOT NULL,            -- Unix timestamp in milliseconds
  metadata TEXT                          -- JSON object for additional event data
);

-- Index for fast token_id lookups (track token family)
CREATE INDEX IF NOT EXISTS idx_token_id ON token_usage(token_id);

-- Index for fast subject lookups (user activity)
CREATE INDEX IF NOT EXISTS idx_subject ON token_usage(subject);

-- Index for fast event_type filtering (security monitoring)
CREATE INDEX IF NOT EXISTS idx_event_type ON token_usage(event_type);

-- Index for time-based queries (retention, analytics)
CREATE INDEX IF NOT EXISTS idx_timestamp ON token_usage(timestamp);

-- Composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_subject_timestamp ON token_usage(subject, timestamp);

-- Index for client-specific analytics
CREATE INDEX IF NOT EXISTS idx_client_id ON token_usage(client_id);
