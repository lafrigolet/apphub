-- Email template for basket.abandoned. Producer is platform-scheduler's
-- basket-abandoned job (cron 0 * * * *) — its payload doesn't carry the
-- buyer's email; the notifications consumer hydrates it from
-- platform_auth.users.
INSERT INTO platform_notifications.templates (key, channel, locale, subject, body_text, variables) VALUES
  ('basket.abandoned', 'email', 'es',
   'Tu carrito te espera ({{itemCount}} {{itemNoun}})',
   'Hola,' || E'\n\n' || 'Dejaste {{itemCount}} {{itemNoun}} en tu carrito. Cuando quieras, retoma la compra.',
   ARRAY['itemCount', 'itemNoun']),
  ('basket.abandoned', 'email', 'en',
   'Your basket is waiting ({{itemCount}} {{itemNoun}})',
   'Hi,' || E'\n\n' || 'You left {{itemCount}} {{itemNoun}} in your basket. Pick up where you left off whenever you want.',
   ARRAY['itemCount', 'itemNoun'])
ON CONFLICT (key, channel, locale) DO NOTHING;
