-- Storage integration: submissions reference uploaded signatures via the
-- platform_storage.objects table. signature_url stays for backwards-compat
-- with existing data; new submissions populate signature_object_id.

ALTER TABLE platform_intake_forms.submissions
  ADD COLUMN IF NOT EXISTS signature_object_id UUID;

CREATE INDEX IF NOT EXISTS idx_intake_submissions_signature_object
  ON platform_intake_forms.submissions (signature_object_id)
  WHERE signature_object_id IS NOT NULL;
