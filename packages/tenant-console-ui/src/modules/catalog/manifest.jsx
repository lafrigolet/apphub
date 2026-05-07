import Catalog from './views/Catalog'
import { icons } from '../../shell/lib/icons'

const VIEW_CATALOG = 'catalog-items'

export default {
  id: 'catalog', capability: 'catalog', label: 'Catálogo',
  dashboardCards: [{
    id: 'catalog.summary', category: 'business', label: 'Catálogo',
    summary: async (api) => {
      const r = await api.get('/api/catalog/items?limit=1').catch(() => null)
      const total = r?.total ?? (Array.isArray(r?.data) ? r.data.length : 0)
      return { metric: total > 0 ? `${total} items` : 'Sin items', status: total > 0 ? 'active' : 'unconfigured' }
    },
    primaryAction: { label: 'Gestionar', view: VIEW_CATALOG },
  }],
  sidebar: [{ category: 'business', view: VIEW_CATALOG, label: 'Catálogo', icon: icons.apps }],
  routes:  { [VIEW_CATALOG]: () => <Catalog /> },
}
