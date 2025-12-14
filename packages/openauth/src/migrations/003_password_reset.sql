-- ============================================
-- PASSWORD RESET REQUIRED FIELD
-- ============================================
-- Adds support for admin-triggered forced password reset.
-- When password_reset_required is 1, the user must change their
-- password on next login before they can receive tokens.

-- Add password_reset_required column to users table
ALTER TABLE users ADD COLUMN password_reset_required INTEGER DEFAULT 0;

-- Index for efficiently querying users who need password reset
CREATE INDEX IF NOT EXISTS idx_users_password_reset 
    ON users(tenant_id, password_reset_required) 
    WHERE password_reset_required = 1;
