import Rooms from './views/Rooms'
import { icons } from '../../shell/lib/icons'

const VIEW_ROOMS = 'telehealth-rooms'

export default {
  id: 'telehealth', capability: 'telehealth', label: 'Telehealth',
  dashboardCards: [{
    id: 'telehealth.rooms', category: 'operations', label: 'Telehealth',
    summary: async () => ({ metric: 'Read-only', status: 'active' }),
    primaryAction: { label: 'Ver salas', view: VIEW_ROOMS },
  }],
  sidebar: [{ category: 'operations', view: VIEW_ROOMS, label: 'Telehealth', icon: icons.eye }],
  routes:  { [VIEW_ROOMS]: () => <Rooms /> },
}
