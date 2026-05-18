import { icons } from '../../shell/lib/icons'

// Aikikan-specific shortcuts injected into the embedded shell's sidebar.
// No view components — son links a rutas del SPA host (aikikan-portal),
// que renderiza sus propias vistas nativas. El shell detecta entradas
// con `href` y emite <a> en lugar de <button> (ver Sidebar.jsx).
//
// Activación: añadir 'aikikan-shortcuts' al campo
// platform_tenants.apps.enabled_modules para app_id='aikikan'.
export default {
  id:    'aikikan-shortcuts',
  label: 'Aikikan shortcuts',

  sidebar: [
    {
      category: 'operations',
      href:     '/consola/usuarios',
      label:    'Usuarios',
      icon:     icons.admins,
    },
    {
      category: 'business',
      href:     '/consola/billing',
      label:    'Billing',
      icon:     icons.tag,
    },
  ],

  routes: {},
}
