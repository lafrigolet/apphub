-- Foundations for SMS notifications: store phone number, verification timestamp
-- (set after a successful OTP, see TODO future work) and consent timestamp
-- (set when the user opts in — required by GDPR for marketing, recommended
-- for transactional). All three are nullable.
ALTER TABLE platform_auth.users
  ADD COLUMN IF NOT EXISTS phone_number       TEXT,
  ADD COLUMN IF NOT EXISTS phone_verified_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone_consent_at   TIMESTAMPTZ;

-- Lookup users by phone within (app_id, tenant_id). Useful for inbound SMS
-- routing (Twilio webhooks deliver the e164 number, not a user id).
CREATE INDEX IF NOT EXISTS idx_platform_auth_users_phone
  ON platform_auth.users (app_id, tenant_id, phone_number)
  WHERE phone_number IS NOT NULL;
