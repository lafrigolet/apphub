// Audit log of this tenant. Read-only — owner/admin see actions performed
// by anyone scoped to their tenant.
import Audit from './views/Audit'
import { icons } from '../../shell/lib/icons'

const VIEW_AUDIT = 'audit-log'

export default {
  id:         'audit',
  capability: 'audit',
  label:      'Audit log',

  dashboardCards: [
    {
      id:       'audit.log',
      category: 'configuration',
      label:    'Audit log',
      summary:  async (api) => {
        try {
          const r = await api.get('/api/audit/?limit=1')
          const total = r?.total ?? r?.count ?? (Array.isArray(r?.data) ? r.data.length : 0)
          return { metric: total > 0 ? `${total} entradas` : 'Sin entradas', status: 'active' }
        } catch (_e) {
          return { metric: 'Disponible', status: 'active' }
        }
      },
      primaryAction: { label: 'Ver historial', view: VIEW_AUDIT },
    },
  ],

  sidebar: [
    { category: 'configuration', view: VIEW_AUDIT, label: 'Audit log', icon: icons.audit },
  ],

  routes: {
    [VIEW_AUDIT]: () => <Audit />,
  },
}
