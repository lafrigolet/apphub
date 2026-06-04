-- Cross-schema grants for the four new cross-cutting jobs whose business logic
-- was already shipped by earlier waves (auth, notifications, messaging,
-- telehealth) but whose scheduler runners land now:
--   * auth-token-purge            → DELETE expired tokens in platform_auth
--   * notification-send-log-purge → DELETE old rows in platform_notifications.send_log
--   * messaging-sla               → SELECT open threads in platform_messaging
--   * telehealth-expire-stale     → SELECT/UPDATE stale rooms in platform_telehealth
--
-- Intencionadamente SIN guard condicional (DO $$ … IF EXISTS): los cuatro
-- schemas existen en todos los entornos desde que sus módulos se desplegaron, y
-- un fallo ruidoso es preferible a un no-op silencioso. Lección de
-- 0005_grant_platform_chat, que quedó registrado como aplicado sin ejecutar los
-- GRANTs por estar envuelto en un guard. Si un schema faltara, esta migración
-- debe fallar para que se note, no esconder el problema.
--
-- Grants acotados a las tablas concretas que cada job toca (least privilege),
-- no ON ALL TABLES. ALTER DEFAULT PRIVILEGES no es necesario aquí porque no
-- dependemos de tablas futuras de esos schemas.

-- platform_auth — borrar tokens caducados de las tres tablas de tokens.
GRANT USAGE ON SCHEMA platform_auth TO svc_platform_scheduler;
GRANT SELECT, DELETE ON platform_auth.password_resets   TO svc_platform_scheduler;
GRANT SELECT, DELETE ON platform_auth.magic_links        TO svc_platform_scheduler;
GRANT SELECT, DELETE ON platform_auth.activation_tokens  TO svc_platform_scheduler;

-- platform_notifications — purgar el send_log por retención.
GRANT USAGE ON SCHEMA platform_notifications TO svc_platform_scheduler;
GRANT SELECT, DELETE ON platform_notifications.send_log TO svc_platform_scheduler;

-- platform_messaging — leer threads para detectar brechas de SLA del vendor
-- (no escribe: usa el patrón de ventana, no un centinela sla_breached_at).
GRANT USAGE ON SCHEMA platform_messaging TO svc_platform_scheduler;
GRANT SELECT ON platform_messaging.threads TO svc_platform_scheduler;

-- platform_telehealth — transicionar salas stale a 'expired'.
GRANT USAGE ON SCHEMA platform_telehealth TO svc_platform_scheduler;
GRANT SELECT, UPDATE ON platform_telehealth.rooms TO svc_platform_scheduler;
