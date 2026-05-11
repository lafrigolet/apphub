-- Bookings ligadas a una `service_session` (eventos / convocatorias
-- fijadas) llevan el `session_id` para:
--   1) Permitir listar inscritos por sesión (filtro WHERE session_id=…).
--   2) Sortear el overlap-guard por recurso, que rechazaría la segunda
--      inscripción de un evento con N asistentes (todos los asistentes
--      comparten "el mismo recurso" — la sala). El service layer cuenta
--      vs `service_sessions.capacity` y deja insertar sin guard de
--      recurso cuando session_id está presente.
--
-- Cross-schema sin FK SQL — la consistencia se mantiene a nivel servicio.
-- (platform_bookings y platform_services son schemas distintos, y la
-- regla de aislamiento prohíbe FK entre ellos.)

ALTER TABLE platform_bookings.bookings
  ADD COLUMN IF NOT EXISTS session_id UUID;

CREATE INDEX IF NOT EXISTS idx_platform_bookings_session
  ON platform_bookings.bookings (session_id)
  WHERE session_id IS NOT NULL;
