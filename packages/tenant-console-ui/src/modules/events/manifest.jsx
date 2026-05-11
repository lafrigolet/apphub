import EventsAdmin from './views/EventsAdmin.jsx'
import { icons } from '../../shell/lib/icons'

const VIEW_EVENTS = 'events-admin'

// Manifest del módulo `events` — agenda editable desde la consola del
// admin. Tras el cutover Fase 2, los datos viven en
// `platform_services.service_sessions` (eventos = sessions de un
// service con kind='event'); consumidos vía /api/services y /api/bookings.
// La sección "Comercial" agrupa otros recursos del cliente final
// (promos, packs, disputas, etc.); los eventos encajan naturalmente ahí.
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
        // Resolvemos el tenantId via subdomain (público), luego pedimos
        // las sesiones futuras públicas. El dashboard funciona aunque el
        // admin no haya hecho aún login (raro pero válido).
        const me = await api.get('/api/auth/me').catch(() => null)
        const appId    = me?.appId    ?? me?.app_id
        const tenantId = me?.tenantId ?? me?.tenant_id
        if (!appId || !tenantId) return { metric: '—' }
        const r = await api.get(`/api/services/sessions/upcoming?appId=${appId}&tenantId=${tenantId}&kind=event`)
        const list = r?.data ?? []
        return {
          metric: list.length === 0 ? 'Sin convocatorias' : `${list.length} próximas`,
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
