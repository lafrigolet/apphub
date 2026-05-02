import Threads from './views/Threads'
import { icons } from '../../shell/lib/icons'

const VIEW_THREADS = 'messaging-threads'

export default {
  id: 'messaging', capability: 'messaging', label: 'Mensajería',
  dashboardCards: [{
    id: 'messaging.unread', category: 'conversations', label: 'Mensajes',
    summary: async (api) => {
      const r = await api.get('/api/messaging/threads?limit=1').catch(() => null)
      const total = r?.total ?? (Array.isArray(r?.data) ? r.data.length : 0)
      return { metric: total > 0 ? `${total} hilos` : 'Sin hilos', status: 'active' }
    },
    primaryAction: { label: 'Ver', view: VIEW_THREADS },
  }],
  sidebar: [{ category: 'conversations', view: VIEW_THREADS, label: 'Mensajes', icon: icons.bell }],
  routes:  { [VIEW_THREADS]: () => <Threads /> },
}
