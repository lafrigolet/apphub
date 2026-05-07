import Orders from './views/Orders'
import { icons } from '../../shell/lib/icons'

const VIEW_ORDERS = 'orders-list'

export default {
  id: 'orders', capability: 'orders', label: 'Pedidos',
  dashboardCards: [{
    id: 'orders.active', category: 'business', label: 'Pedidos',
    summary: async (api) => {
      const r = await api.get('/api/orders/?status=pending&limit=1').catch(() => null)
      const total = r?.total ?? (Array.isArray(r?.data) ? r.data.length : 0)
      return { metric: total > 0 ? `${total} pendientes` : 'Sin pedidos', status: total > 0 ? 'unconfigured' : 'active' }
    },
    primaryAction: { label: 'Ver listado', view: VIEW_ORDERS },
  }],
  sidebar: [{ category: 'business', view: VIEW_ORDERS, label: 'Pedidos', icon: icons.tag }],
  routes:  { [VIEW_ORDERS]: () => <Orders /> },
}
