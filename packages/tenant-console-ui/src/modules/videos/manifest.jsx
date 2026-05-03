import VideosAdmin from './views/VideosAdmin.jsx'
import { icons } from '../../shell/lib/icons'

const VIEW_VIDEOS = 'videos-admin'

// Manifest del módulo `videos` — gestiona el carrusel del archivo
// visual del landing. Sección "Negocio" porque los vídeos son contenido
// del producto (al contrario que eventos, que están en "Comercial").
export default {
  id:         'videos',
  capability: 'videos',
  label:      'Vídeos',

  dashboardCards: [{
    id:       'videos.summary',
    category: 'business',
    label:    'Vídeos',
    summary:  async (api) => {
      try {
        const r = await api.get('/api/aikikan/videos')
        const list = Array.isArray(r) ? r : []
        return {
          metric: list.length === 0 ? 'Sin vídeos' : `${list.length} en archivo`,
          status: 'active',
        }
      } catch (_e) {
        return { metric: '—' }
      }
    },
    primaryAction: { label: 'Gestionar', view: VIEW_VIDEOS },
  }],

  sidebar: [{ category: 'business', view: VIEW_VIDEOS, label: 'Vídeos', icon: icons.eye }],

  routes: { [VIEW_VIDEOS]: () => <VideosAdmin /> },
}
