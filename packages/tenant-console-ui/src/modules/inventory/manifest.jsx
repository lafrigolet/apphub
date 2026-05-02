import Inventory from './views/Inventory'
import { icons } from '../../shell/lib/icons'

const VIEW_INV = 'inventory-list'

export default {
  id: 'inventory', capability: 'inventory', label: 'Inventario',
  dashboardCards: [{
    id: 'inventory.summary', category: 'operations', label: 'Inventario',
    summary: async (api) => {
      const r = await api.get('/api/inventory/?limit=1').catch(() => null)
      const total = r?.total ?? (Array.isArray(r?.data) ? r.data.length : 0)
      return { metric: total > 0 ? `${total} SKUs` : 'Sin SKUs', status: 'active' }
    },
    primaryAction: { label: 'Gestionar', view: VIEW_INV },
  }],
  sidebar: [{ category: 'operations', view: VIEW_INV, label: 'Inventario', icon: icons.archive }],
  routes:  { [VIEW_INV]: () => <Inventory /> },
}
