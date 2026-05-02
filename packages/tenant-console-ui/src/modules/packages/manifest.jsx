import Packages from './views/Packages'
import { icons } from '../../shell/lib/icons'

const VIEW_PKG = 'packages-templates'

export default {
  id: 'packages', capability: 'packages', label: 'Packs',
  dashboardCards: [{
    id: 'packages.summary', category: 'commercial', label: 'Packs',
    summary: async (api) => {
      const r = await api.get('/api/packages/templates').catch(() => null)
      const list = r?.data ?? r ?? []
      return { metric: list.length === 0 ? 'Sin packs' : `${list.length} plantilla${list.length === 1 ? '' : 's'}`, status: 'active' }
    },
    primaryAction: { label: 'Ver', view: VIEW_PKG },
  }],
  sidebar: [{ category: 'commercial', view: VIEW_PKG, label: 'Packs', icon: icons.tag }],
  routes:  { [VIEW_PKG]: () => <Packages /> },
}
