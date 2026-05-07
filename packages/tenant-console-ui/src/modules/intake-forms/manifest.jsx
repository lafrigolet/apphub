import Submissions from './views/Submissions'
import { icons } from '../../shell/lib/icons'

const VIEW_FORMS = 'intake-forms-list'

export default {
  id: 'intake-forms', capability: 'intake-forms', label: 'Formularios',
  dashboardCards: [{
    id: 'intake-forms.list', category: 'operations', label: 'Formularios',
    summary: async (api) => {
      const r = await api.get('/api/intake-forms/templates').catch(() => null)
      const list = r?.data ?? r ?? []
      return { metric: list.length === 0 ? 'Sin plantillas' : `${list.length} plantilla${list.length === 1 ? '' : 's'}`, status: 'active' }
    },
    primaryAction: { label: 'Ver', view: VIEW_FORMS },
  }],
  sidebar: [{ category: 'operations', view: VIEW_FORMS, label: 'Formularios', icon: icons.audit }],
  routes:  { [VIEW_FORMS]: () => <Submissions /> },
}
