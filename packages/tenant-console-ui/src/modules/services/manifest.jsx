import Services from './views/Services'
import { icons } from '../../shell/lib/icons'

const VIEW_SERVICES = 'services-list'

export default {
  id: 'services', capability: 'services', label: 'Servicios',
  dashboardCards: [{
    id: 'services.summary', category: 'business', label: 'Catálogo de servicios',
    summary: async (api) => {
      const r = await api.get('/api/services/').catch(() => null)
      const list = r?.data ?? r ?? []
      const active = list.filter((s) => s.is_active).length
      return { metric: list.length === 0 ? 'Sin servicios' : `${active} activo${active === 1 ? '' : 's'} / ${list.length}`, status: list.length === 0 ? 'unconfigured' : 'active' }
    },
    primaryAction: { label: 'Editar', view: VIEW_SERVICES },
  }],
  sidebar: [{ category: 'business', view: VIEW_SERVICES, label: 'Servicios', icon: icons.tag }],
  routes:  { [VIEW_SERVICES]: () => <Services /> },
}
