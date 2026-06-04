-- Grant the scheduler role access to platform_leads so the GDPR retention
-- job (lead-retention-purge) can delete closed leads past the window.
-- Intencionadamente SIN guard condicional: platform_leads existe en todos
-- los entornos desde que el módulo leads se desplegó, y un fallo ruidoso es
-- preferible a un no-op silencioso (lección de 0005_grant_platform_chat,
-- que quedó registrado como aplicado sin ejecutar los GRANTs).
GRANT USAGE ON SCHEMA platform_leads TO svc_platform_scheduler;
GRANT SELECT, DELETE ON ALL TABLES IN SCHEMA platform_leads TO svc_platform_scheduler;

-- Cubre tablas futuras del módulo leads (las crea el superuser vía
-- MIGRATION_DATABASE_URL, el mismo rol que ejecuta esta migración) — evita
-- una carrera de arranque entre platform-core (migraciones de leads) y
-- platform-scheduler (este grant).
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_leads
  GRANT SELECT, DELETE ON TABLES TO svc_platform_scheduler;
