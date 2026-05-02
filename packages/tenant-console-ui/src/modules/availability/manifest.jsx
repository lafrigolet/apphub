import Slots from './views/Slots'
import { icons } from '../../shell/lib/icons'

const VIEW_SLOTS = 'availability-slots'

export default {
  id: 'availability', capability: 'availability', label: 'Disponibilidad',
  dashboardCards: [{
    id: 'availability.slots', category: 'operations', label: 'Disponibilidad',
    summary: async () => ({ metric: 'Read-only', status: 'active' }),
    primaryAction: { label: 'Ver slots', view: VIEW_SLOTS },
  }],
  sidebar: [{ category: 'operations', view: VIEW_SLOTS, label: 'Disponibilidad', icon: icons.search }],
  routes:  { [VIEW_SLOTS]: () => <Slots /> },
}
