-- Migración 0014 borró la fila sendgrid_api_key pero el CHECK constraint
-- config_key_check seguía enumerando ese key y NO incluía resend_api_key,
-- así que cualquier INSERT/UPSERT con key='resend_api_key' rebotaba con
-- "violates check constraint".
--
-- Solución: re-crear el constraint reemplazando sendgrid_api_key por
-- resend_api_key. Se eliminan también referencias futuras al proveedor
-- viejo de un único lugar.

ALTER TABLE platform_notifications.config
  DROP CONSTRAINT IF EXISTS config_key_check;

ALTER TABLE platform_notifications.config
  ADD CONSTRAINT config_key_check CHECK (
    key = ANY (ARRAY[
      'resend_api_key',
      'sender_email',
      'sender_name',
      'twilio_account_sid',
      'twilio_api_key_sid',
      'twilio_api_key_secret',
      'twilio_messaging_service_sid',
      'twilio_default_sender',
      'rate_limit_per_user_per_hour',
      'rate_limit_per_user_per_day',
      'digest_mode',
      'fcm_project_id',
      'fcm_service_account_json',
      'apns_team_id',
      'apns_key_id',
      'apns_bundle_id',
      'apns_p8_key',
      'apns_environment'
    ]::text[])
  );
