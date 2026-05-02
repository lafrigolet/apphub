// Manifest for the `notifications` module — first one wired in Fase 1.
// Surfaces the email-domain authentication flow that already lives in
// platform/notifications via the shared EmailDomainsManager component.
//
// Future entries (per-tenant templates, SMS sender authentication, etc.)
// add themselves here as additional `dashboardCards` / `sidebar` /
// `routes`, no shell changes required.
import EmailDomainsView from './views/EmailDomainsView'

const VIEW_EMAILS = 'notifications-emails'

export default {
  id:         'notifications',
  capability: 'notifications',
  label:      'Notifications',

  dashboardCards: [
    {
      id:       'notifications.email-domains',
      category: 'configuration',
      label:    'Dominios de email',
      // Resolves a count of verified domains so the card metric is
      // representative. Falls back to the raw total when verified isn't a
      // distinguishing concept (early bootstrap).
      summary: async (api) => {
        const r = await api.get('/api/notifications/email-domains')
        const items = r?.data ?? []
        const verified = items.filter((d) => d.status === 'verified').length
        return {
          metric: items.length === 0
            ? 'Sin configurar'
            : `${verified} verificado${verified === 1 ? '' : 's'} / ${items.length}`,
          status: items.length === 0 ? 'unconfigured' : 'active',
        }
      },
      primaryAction: { label: 'Configurar', view: VIEW_EMAILS },
    },
  ],

  sidebar: [
    { category: 'configuration', view: VIEW_EMAILS, label: 'Email domains' },
  ],

  routes: {
    [VIEW_EMAILS]: () => <EmailDomainsView />,
  },
}
