-- Guard de doble inscripción del mismo cliente a la misma sesión.
--
-- Antes de esta migración, un cliente podía inscribirse N veces al mismo
-- evento (mismo session_id) porque `countBookingsForSession` sólo cuenta
-- el aforo total, no por cliente. Añadimos un índice único PARCIAL sobre
-- (app_id, tenant_id, session_id, client_user_id) restringido a las
-- inscripciones VIVAS — las terminales (cancelled/no_show/rescheduled) se
-- excluyen para que un cliente que canceló pueda volver a inscribirse.
--
-- Es un índice parcial (no constraint) porque las constraints UNIQUE de
-- Postgres no admiten predicado WHERE. session_id es NULL para las citas
-- individuales, así que el índice sólo afecta a inscripciones a sesiones.

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_bookings_session_client_active
  ON platform_bookings.bookings (app_id, tenant_id, session_id, client_user_id)
  WHERE session_id IS NOT NULL
    AND status NOT IN ('cancelled','no_show','rescheduled');
