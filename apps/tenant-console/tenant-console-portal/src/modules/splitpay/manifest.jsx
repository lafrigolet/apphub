// Stripe Connect onboarding + split rules. The view short-circuits when
// app.splitpay_enabled is false, so the module can be listed in
// enabled_modules even before staff flips the activation toggle — the user
// just sees a "not enabled" notice from the underlying view.
import Splitpay from './views/Splitpay'
import { icons } from '../../shell/lib/icons'

const VIEW_SPLITPAY = 'splitpay-config'

export default {
  id:         'splitpay',
  capability: 'splitpay',
  label:      'Split Pay',

  dashboardCards: [
    {
      id:       'splitpay.config',
      category: 'configuration',
      label:    'Split Pay',
      summary:  async (api) => {
        const me = await api.get('/api/auth/me').catch(() => null)
        const appId = me?.appId ?? me?.app_id
        if (!appId) return { metric: '—' }
        const app = await api.get(`/api/apps/${encodeURIComponent(appId)}`).catch(() => null)
        if (!app?.splitpay_enabled) return { metric: 'No habilitado', status: 'unconfigured' }
        return { metric: 'Configurar Stripe', status: 'active' }
      },
      primaryAction: { label: 'Abrir', view: VIEW_SPLITPAY },
    },
  ],

  sidebar: [
    { category: 'configuration', view: VIEW_SPLITPAY, label: 'Split Pay', icon: icons.tag },
  ],

  routes: {
    [VIEW_SPLITPAY]: () => <Splitpay />,
  },
}
