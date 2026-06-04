-- Priority use-cases (intake-forms.md "Recomendaciones de priorización"):
--   #1 at-rest encryption of `answers` (special-category health data, art. 9 GDPR)
--   #5 GDPR consent record + right-to-erasure (anonymisation keeping audit skeleton)
--
-- #2 (staff listing) and #4 (server-side required-field validation) need no schema
-- change; they are pure read/validation logic over existing columns.

-- ── #1 — Encryption at rest of submission answers ───────────────────────
-- The plaintext JSONB `answers` column stays for backwards-compat with rows
-- written before this migration. New writes encrypt to `answers_encrypted`
-- (BYTEA: iv||tag||ciphertext via @apphub/platform-sdk/crypto) and blank the
-- plaintext column to '{}'. `answers_encrypted IS NOT NULL` flags an encrypted row.
ALTER TABLE platform_intake_forms.submissions
  ADD COLUMN IF NOT EXISTS answers_encrypted BYTEA;

-- ── #5 — GDPR consent + erasure ─────────────────────────────────────────
-- Explicit consent captured before the client fills the form (art. 7 GDPR):
-- the legal text shown, its version, and the timestamp it was accepted.
ALTER TABLE platform_intake_forms.submissions
  ADD COLUMN IF NOT EXISTS consent_text       TEXT,
  ADD COLUMN IF NOT EXISTS consent_version    TEXT,
  ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS legal_basis        TEXT
    CHECK (legal_basis IS NULL OR legal_basis IN ('consent','contract','vital_interest','legal_obligation'));

-- Right to erasure: we anonymise (drop answers + signature) but keep the
-- submission skeleton for audit. `erased_at` flags an anonymised row.
ALTER TABLE platform_intake_forms.submissions
  ADD COLUMN IF NOT EXISTS erased_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS erased_by_user_id UUID;

CREATE INDEX IF NOT EXISTS idx_platform_intake_submissions_client
  ON platform_intake_forms.submissions (tenant_id, client_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_intake_submissions_template
  ON platform_intake_forms.submissions (tenant_id, template_id, created_at DESC);
