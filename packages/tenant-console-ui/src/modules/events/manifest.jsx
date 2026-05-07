import EventsAdmin from './views/EventsAdmin.jsx'
import { icons } from '../../shell/lib/icons'

const VIEW_EVENTS = 'events-admin'

// Manifest del módulo `events` — agenda pública del landing editable
// desde la consola del admin. Los datos viven en `app_aikikan.events`
// y se exponen en `/api/aikikan/events`. La sección "Comercial" de la
// sidebar ya agrupa otros recursos del cliente final (promos, packs,
// disputas, etc.); los eventos encajan naturalmente ahí.
export default {
  id:         'events',
  capability: 'events',
  label:      'Eventos',

  dashboardCards: [{
    id:       'events.summary',
    category: 'commercial',
    label:    'Eventos',
    summary:  async (api) => {
      try {
        const r = await api.get('/api/aikikan/events')
        const list = Array.isArray(r) ? r : []
        return {
          metric: list.length === 0 ? 'Sin eventos' : `${list.length} en agenda`,
          status: 'active',
        }
      } catch (_e) {
        return { metric: '—' }
      }
    },
    primaryAction: { label: 'Gestionar', view: VIEW_EVENTS },
  }],

  sidebar: [{ category: 'commercial', view: VIEW_EVENTS, label: 'Eventos', icon: icons.tag }],

  routes: { [VIEW_EVENTS]: () => <EventsAdmin /> },
}
