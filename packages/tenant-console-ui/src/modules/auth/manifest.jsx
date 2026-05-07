// Administrators of the tenant — list owners + admins, change roles, revoke.
// Mirrors views/tenant/Admins.jsx from voragine-console.
import Admins from './views/Admins'
import { icons } from '../../shell/lib/icons'

const VIEW_ADMINS = 'auth-admins'

export default {
  id:         'auth',
  capability: 'auth',
  label:      'Administradores',

  dashboardCards: [
    {
      id:       'auth.admins',
      category: 'configuration',
      label:    'Administradores',
      summary:  async (api) => {
        try {
          const r = await api.get('/api/users/?role=owner,admin&limit=200')
          const list = Array.isArray(r) ? r : (r?.data ?? [])
          return {
            metric: list.length === 0 ? 'Sin administradores' : `${list.length} con acceso`,
            status: list.length === 0 ? 'unconfigured' : 'active',
          }
        } catch (_e) {
          return { metric: '—' }
        }
      },
      primaryAction: { label: 'Gestionar', view: VIEW_ADMINS },
    },
  ],

  sidebar: [
    { category: 'configuration', view: VIEW_ADMINS, label: 'Administradores', icon: icons.admins },
  ],

  routes: {
    [VIEW_ADMINS]: () => <Admins />,
  },
}
