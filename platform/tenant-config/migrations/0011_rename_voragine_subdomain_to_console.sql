-- Rebrand: voragine-console → console (subdomain only).
--
-- Updates the existing 'platform' app row so its public subdomain is
-- `console` instead of `voragine-console`. The app_id stays as
-- 'voragine-console' on purpose — it's the JWT claim baked into every
-- staff token and changing it would invalidate live sessions and force
-- staff to log in again.
--
-- Effect: nginx-config.service.js renders the staff console at
-- console.hulkstein.com (production) and console.hulkstein.local (dev).
-- The legacy server_name `voragine-console.*` is still in the seed
-- block (infra/nginx/seed/console.conf) as a transition alias.
--
-- After applying this migration in an existing environment, force a
-- re-render of the Redis-cached nginx blocks:
--   docker compose exec redis redis-cli DEL nginx:configs
--   docker compose restart platform-core nginx

UPDATE platform_tenants.apps
   SET subdomain = 'console'
 WHERE app_id   = 'voragine-console'
   AND subdomain = 'voragine-console';
