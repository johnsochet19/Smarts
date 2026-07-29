-- 006_mfa.sql
-- Optional TOTP two-factor auth columns on users. Idempotent; the auth route
-- also adds these at boot.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret  VARCHAR(64);
