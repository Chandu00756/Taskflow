-- Migration: Add security features for password management and login tracking
-- Date: 2025-11-18
-- Description: Adds columns for temporary passwords, security questions, login tracking, and failed attempts

-- Add security columns to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS has_logged_in BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_login TIMESTAMP,
ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS security_questions TEXT;

-- Create index for faster queries on login tracking
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login);
CREATE INDEX IF NOT EXISTS idx_users_failed_attempts ON users(failed_login_attempts);

-- Set existing users to require security questions on next login
-- (security_questions will be NULL, triggering must_set_security_questions flag)
UPDATE users SET security_questions = NULL WHERE security_questions IS NULL OR security_questions = '';

-- Optional: Mark existing users as already logged in (so they skip OTP flow)
UPDATE users SET has_logged_in = true WHERE has_logged_in = false;

-- Verification queries (run after migration to check)
-- SELECT email, must_change_password, has_logged_in, security_questions IS NOT NULL as has_questions FROM users;
