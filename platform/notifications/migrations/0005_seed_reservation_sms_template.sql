-- Seed the SMS variant of reservation.reminder.due so reservations have the
-- same dual-channel coverage that booking.reminder.due got in migration 0004.
-- Body kept short and plain (no HTML, fits in a single 160-char SMS).
INSERT INTO platform_notifications.templates (key, channel, subject, body_text, variables) VALUES
  ('reservation.reminder.due', 'sms',
   NULL,
   'Recordatorio: tu reserva es {{lead}} ({{when}}) para {{partySize}} personas. Si no puedes asistir, cancela con antelación.',
   ARRAY['lead', 'when', 'partySize']
  )
ON CONFLICT (key, channel) DO NOTHING;
