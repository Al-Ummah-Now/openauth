-- Migration 001: Base OAuth Clients Table
-- Creates the oauth_clients table for storing OAuth 2.0 client credentials
-- This is the foundation table that other migrations will extend
--
-- Run with: wrangler d1 execute openauth-db --file=./src/migrations/001_oauth_clients.sql

-- Enable foreign keys (D1/SQLite specific)
PRAGMA foreign_keys = ON;

-- OAuth Clients table
-- Stores OAuth 2.0 client registrations for both confidential and public clients
CREATE TABLE IF NOT EXISTS oauth_clients (
    -- Primary identifier for the OAuth client
    client_id TEXT PRIMARY KEY,

    -- Hash of the client secret for confidential clients
    -- NULL for public clients (SPAs, mobile apps) that cannot securely store secrets
    client_secret_hash TEXT,

    -- Human-readable name for the client application
    client_name TEXT NOT NULL,

    -- JSON array of allowed redirect URIs
    -- Example: ["https://app.example.com/callback", "http://localhost:3000/callback"]
    redirect_uris TEXT,

    -- JSON array of allowed OAuth grant types
    -- Example: ["authorization_code", "refresh_token", "client_credentials"]
    grant_types TEXT,

    -- JSON array of allowed OAuth scopes
    -- Example: ["openid", "profile", "email"]
    scopes TEXT,

    -- Timestamps as Unix epoch milliseconds
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Index for client lookup by name (admin UI searches)
CREATE INDEX IF NOT EXISTS idx_oauth_clients_name ON oauth_clients(client_name);

-- Index for listing clients sorted by creation time
CREATE INDEX IF NOT EXISTS idx_oauth_clients_created ON oauth_clients(created_at);
