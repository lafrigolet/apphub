-- Migración del proveedor ESP: SendGrid → Resend.
--
-- El módulo email.service.js ahora usa la SDK de Resend. La fila
-- sendgrid_api_key en platform_notifications.config quedó huérfana: su
-- ciphertext contiene una API key de SendGrid, inútil para Resend.
--
-- Esta migración:
-- 1. Borra la fila sendgrid_api_key (si existe).
-- 2. Migra cualquier email-domain creado con SendGrid al nuevo provider
--    'resend'. En prod no hay filas (0 tenants han usado el feature),
--    pero la sentencia es idempotente y barata.
--
-- Después de aplicar, el operador debe pegar una API key de Resend en
-- Hulkstein Console > Configuración > Notifications.

DELETE FROM platform_notifications.config
 WHERE key = 'sendgrid_api_key';

UPDATE platform_notifications.tenant_email_domains
   SET provider = 'resend'
 WHERE provider = 'sendgrid';
