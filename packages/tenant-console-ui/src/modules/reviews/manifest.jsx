import Reviews from './views/Reviews'
import { icons } from '../../shell/lib/icons'

const VIEW_REVIEWS = 'reviews-moderation'

export default {
  id: 'reviews', capability: 'reviews', label: 'Reseñas',
  dashboardCards: [{
    id: 'reviews.pending', category: 'commercial', label: 'Reseñas pendientes',
    summary: async (api) => {
      const r = await api.get('/api/reviews/?status=pending&limit=1').catch(() => null)
      const total = r?.total ?? (Array.isArray(r?.data) ? r.data.length : 0)
      return { metric: total > 0 ? `${total} por moderar` : 'Sin pendientes', status: total > 0 ? 'unconfigured' : 'active' }
    },
    primaryAction: { label: 'Moderar', view: VIEW_REVIEWS },
  }],
  sidebar: [{ category: 'commercial', view: VIEW_REVIEWS, label: 'Reseñas', icon: icons.eye }],
  routes:  { [VIEW_REVIEWS]: () => <Reviews /> },
}
