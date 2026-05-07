import DojosAdmin from './views/DojosAdmin.jsx'
import { icons } from '../../shell/lib/icons'

const VIEW_DOJOS = 'dojos-admin'

// Manifest del módulo `dojos` — gestiona la red de dojos del landing.
// Categoría "Operaciones" porque la red de dojos es contenido operativo
// (dirección, contacto, sensei).
export default {
  id:         'dojos',
  capability: 'dojos',
  label:      'Dojos',

  dashboardCards: [{
    id:       'dojos.summary',
    category: 'operations',
    label:    'Dojos',
    summary:  async (api) => {
      try {
        const r = await api.get('/api/aikikan/dojos')
        const list = Array.isArray(r) ? r : []
        return {
          metric: list.length === 0 ? 'Sin dojos' : `${list.length} en la red`,
          status: 'active',
        }
      } catch (_e) { return { metric: '—' } }
    },
    primaryAction: { label: 'Gestionar', view: VIEW_DOJOS },
  }],

  sidebar: [{ category: 'operations', view: VIEW_DOJOS, label: 'Dojos', icon: icons.tenants }],

  routes: { [VIEW_DOJOS]: () => <DojosAdmin /> },
}
