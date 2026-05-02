import Disputes from './views/Disputes'
import { icons } from '../../shell/lib/icons'

const VIEW_DISPUTES = 'disputes-list'

export default {
  id: 'disputes', capability: 'disputes', label: 'Disputas',
  dashboardCards: [{
    id: 'disputes.open', category: 'commercial', label: 'Disputas abiertas',
    summary: async (api) => {
      const r = await api.get('/api/disputes/?status=open&limit=1').catch(() => null)
      const total = r?.total ?? (Array.isArray(r?.data) ? r.data.length : 0)
      return { metric: total > 0 ? `${total} abiertas` : 'Sin disputas', status: total > 0 ? 'unconfigured' : 'active' }
    },
    primaryAction: { label: 'Ver', view: VIEW_DISPUTES },
  }],
  sidebar: [{ category: 'commercial', view: VIEW_DISPUTES, label: 'Disputas', icon: icons.danger }],
  routes:  { [VIEW_DISPUTES]: () => <Disputes /> },
}
