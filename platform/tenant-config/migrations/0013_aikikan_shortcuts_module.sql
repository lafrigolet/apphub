-- Inyecta el módulo `aikikan-shortcuts` en el shell embebido del
-- tenant-console-ui para aikikan. Este módulo no aporta views — solo
-- emite dos entradas en la sidebar del shell:
--   - "Usuarios" → /consola/usuarios (UsersAdmin nativo de aikikan-portal)
--   - "Agenda"   → /#eventos          (sección agenda de la landing)
--
-- El Sidebar.jsx renderiza estas entradas como <a href> (no <button>),
-- de modo que la navegación la maneja react-router del SPA host.
--
-- Idempotente — usa array unnest + DISTINCT.

UPDATE platform_tenants.apps
SET enabled_modules = (
  SELECT array_agg(DISTINCT m) FROM unnest(
    enabled_modules || ARRAY['aikikan-shortcuts']::TEXT[]
  ) AS m
)
WHERE app_id = 'aikikan';
