import Bookings from './views/Bookings'
import { icons } from '../../shell/lib/icons'

const VIEW_BOOKINGS = 'bookings-list'

export default {
  id: 'bookings', capability: 'bookings', label: 'Reservas',
  dashboardCards: [{
    id: 'bookings.upcoming', category: 'operations', label: 'Reservas próximas',
    summary: async (api) => {
      const r = await api.get('/api/bookings/?status=confirmed&limit=1').catch(() => null)
      const total = r?.total ?? (Array.isArray(r?.data) ? r.data.length : 0)
      return { metric: total > 0 ? `${total} confirmadas` : 'Sin reservas', status: 'active' }
    },
    primaryAction: { label: 'Ver listado', view: VIEW_BOOKINGS },
  }],
  sidebar: [{ category: 'operations', view: VIEW_BOOKINGS, label: 'Reservas', icon: icons.dashboard }],
  routes:  { [VIEW_BOOKINGS]: () => <Bookings /> },
}
