import Promos from './views/Promos'
import { icons } from '../../shell/lib/icons'

const VIEW_PROMOS = 'basket-promos'

export default {
  id: 'basket', capability: 'basket', label: 'Carrito · promos',
  dashboardCards: [{
    id: 'basket.promos', category: 'commercial', label: 'Códigos de promoción',
    summary: async (api) => {
      const r = await api.get('/api/basket/promos').catch(() => null)
      const list = r?.data ?? r ?? []
      return { metric: list.length === 0 ? 'Sin códigos' : `${list.length} activo${list.length === 1 ? '' : 's'}`, status: list.length === 0 ? 'unconfigured' : 'active' }
    },
    primaryAction: { label: 'Gestionar', view: VIEW_PROMOS },
  }],
  sidebar: [{ category: 'commercial', view: VIEW_PROMOS, label: 'Promociones', icon: icons.tag }],
  routes:  { [VIEW_PROMOS]: () => <Promos /> },
}
