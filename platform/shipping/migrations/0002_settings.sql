-- Microservice-level settings for external shipping carriers (UPS, FedEx,
-- DHL, EasyPost). Per-tenant shipping config (zones, rates, default carrier
-- selection) lives in the existing zones/rates tables and stays out of scope.
CREATE TABLE IF NOT EXISTS platform_shipping.settings (
  key             TEXT PRIMARY KEY CHECK (key IN (
    'ups_enabled',
    'ups_environment',
    'ups_account_number',
    'ups_client_id',
    'ups_client_secret',
    'fedex_enabled',
    'fedex_environment',
    'fedex_account_number',
    'fedex_meter_number',
    'fedex_api_key',
    'fedex_secret_key',
    'dhl_enabled',
    'dhl_environment',
    'dhl_account_number',
    'dhl_api_key',
    'dhl_api_secret',
    'easypost_enabled',
    'easypost_environment',
    'easypost_api_key',
    'easypost_webhook_secret'
  )),
  encrypted_value BYTEA,
  plain_value     TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_shipping.settings
  TO svc_platform_shipping;
