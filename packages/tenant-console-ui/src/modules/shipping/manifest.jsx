import Returns from './views/Returns'
import { icons } from '../../shell/lib/icons'

const VIEW_RET = 'shipping-returns'

export default {
  id: 'shipping', capability: 'shipping', label: 'Envíos',
  dashboardCards: [{
    id: 'shipping.returns', category: 'operations', label: 'Devoluciones',
    summary: async (api) => {
      const r = await api.get('/api/shipping/returns?status=requested&limit=1').catch(() => null)
      const total = r?.total ?? (Array.isArray(r?.data) ? r.data.length : 0)
      return { metric: total > 0 ? `${total} pendientes` : 'Sin pendientes', status: total > 0 ? 'unconfigured' : 'active' }
    },
    primaryAction: { label: 'Gestionar', view: VIEW_RET },
  }],
  sidebar: [{ category: 'operations', view: VIEW_RET, label: 'Envíos', icon: icons.archive }],
  routes:  { [VIEW_RET]: () => <Returns /> },
}
