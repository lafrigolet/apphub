-- Medio de pago de la subscripción tenant↔plataforma. El cobro real lo ejecuta
-- Stripe Checkout (mode=subscription) vía platform/splitpay; este campo registra
-- el método elegido por el tenant para mostrarlo en su backoffice. 'card' es el
-- único soportado por el flujo de Checkout actual.
ALTER TABLE platform_tenants.tenants
  ADD COLUMN IF NOT EXISTS subscription_payment_method TEXT;

ALTER TABLE platform_tenants.tenants DROP CONSTRAINT IF EXISTS tenants_subscription_payment_method_check;
ALTER TABLE platform_tenants.tenants
  ADD CONSTRAINT tenants_subscription_payment_method_check
  CHECK (subscription_payment_method IS NULL OR subscription_payment_method IN ('card', 'sepa', 'transfer', 'cash'));
