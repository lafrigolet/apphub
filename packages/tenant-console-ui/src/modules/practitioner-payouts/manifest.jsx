import Payouts from './views/Payouts'
import { icons } from '../../shell/lib/icons'

const VIEW_PAYOUTS = 'payouts-list'

export default {
  id: 'practitioner-payouts', capability: 'practitioner-payouts', label: 'Practitioner payouts',
  dashboardCards: [{
    id: 'practitioner-payouts.summary', category: 'commercial', label: 'Pagos a practitioners',
    summary: async (api) => {
      const r = await api.get('/api/practitioner-payouts/payouts?limit=1').catch(() => null)
      const total = r?.total ?? (Array.isArray(r?.data) ? r.data.length : 0)
      return { metric: total > 0 ? `${total} payouts` : 'Sin payouts', status: 'active' }
    },
    primaryAction: { label: 'Ver', view: VIEW_PAYOUTS },
  }],
  sidebar: [{ category: 'commercial', view: VIEW_PAYOUTS, label: 'Payouts', icon: icons.download }],
  routes:  { [VIEW_PAYOUTS]: () => <Payouts /> },
}
