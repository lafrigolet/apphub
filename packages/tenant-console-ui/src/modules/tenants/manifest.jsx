// Identity-of-the-tenant module: Overview / Settings / Danger zone.
// Replicates the three voragine-console tenant views without modifying
// console-portal (Fase 2). View keys are namespaced `tenants-*` so
// they don't collide with future modules.
import Overview from './views/Overview'
import Settings from './views/Settings'
import Danger   from './views/Danger'
import { icons } from '../../shell/lib/icons'

const VIEW_OVERVIEW = 'tenants-overview'
const VIEW_SETTINGS = 'tenants-settings'
const VIEW_DANGER   = 'tenants-danger'

export default {
  id:         'tenants',
  capability: 'tenants',
  label:      'Tenant',

  dashboardCards: [
    {
      id:       'tenants.overview',
      category: 'home',
      label:    'Resumen del tenant',
      summary:  async (api) => {
        const me = await api.get('/api/auth/me').catch(() => null)
        const tenantId = me?.tenantId ?? me?.tenant_id
        if (!tenantId) return { metric: 'Sin tenant' }
        const t = await api.get(`/api/tenants/tenants/${encodeURIComponent(tenantId)}`).catch(() => null)
        return {
          metric: t?.display_name ?? t?.tenant_id ?? 'Tenant',
          status: t?.status === 'active' ? 'active' : 'unconfigured',
        }
      },
      primaryAction: { label: 'Abrir', view: VIEW_OVERVIEW },
    },
    {
      id:       'tenants.settings',
      category: 'configuration',
      label:    'Identidad',
      primaryAction: { label: 'Editar', view: VIEW_SETTINGS },
    },
  ],

  sidebar: [
    { category: 'configuration', view: VIEW_SETTINGS, label: 'Identidad',      icon: icons.tenants },
    { category: 'configuration', view: VIEW_DANGER,   label: 'Zona peligrosa', icon: icons.danger  },
  ],

  routes: {
    [VIEW_OVERVIEW]: () => <Overview />,
    [VIEW_SETTINGS]: () => <Settings />,
    [VIEW_DANGER]:   () => <Danger />,
  },
}
