-- Microservice-level settings for external delivery-carrier integrations
-- (Uber Direct, Glovo Partners, Stuart). Per-tenant carrier accounts are out
-- of scope here; this table holds the platform-wide credentials, environment
-- toggles and feature flags that the service uses to talk to each provider's
-- API and validate inbound webhooks.
CREATE TABLE IF NOT EXISTS platform_delivery_dispatch.settings (
  key             TEXT PRIMARY KEY CHECK (key IN (
    'uber_enabled',
    'uber_environment',
    'uber_customer_id',
    'uber_client_id',
    'uber_client_secret',
    'uber_webhook_secret',
    'glovo_enabled',
    'glovo_environment',
    'glovo_api_key',
    'glovo_webhook_secret',
    'stuart_enabled',
    'stuart_environment',
    'stuart_client_id',
    'stuart_client_secret',
    'stuart_webhook_secret'
  )),
  encrypted_value BYTEA,
  plain_value     TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_delivery_dispatch.settings
  TO svc_platform_delivery_dispatch;
