-- Storage module S3 settings: endpoint, region, bucket, access/secret key,
-- public endpoint (for browser presigned PUTs), force_path_style. Encrypted
-- columns hold the credentials; non-secret values live in plain_value. The
-- service merges this table with env vars at boot, preferring the DB.
CREATE TABLE IF NOT EXISTS platform_storage.settings (
  key             TEXT PRIMARY KEY CHECK (key IN ('s3_endpoint', 's3_public_endpoint', 's3_region', 's3_bucket', 's3_access_key', 's3_secret_key', 's3_force_path_style')),
  encrypted_value BYTEA,
  plain_value     TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform_storage.settings TO svc_platform_storage;
