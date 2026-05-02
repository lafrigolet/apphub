import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'

export default function NotificationsTemplates() {
  const { toast, navigate } = useApp()
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [localeFilter, setLocaleFilter] = useState('all')

  function reload() {
    setLoading(true)
    api.get('/api/notifications/admin/templates')
      .then((r) => setTemplates(r?.data ?? []))
      .catch((err) => toast(err.message ?? 'Error', 'danger'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  async function toggle(t) {
    try {
      await api.patch(`/api/notifications/admin/templates/${t.id}`, { enabled: !t.enabled })
      toast(`Template ${t.key} (${t.locale}) ${t.enabled ? 'deshabilitada' : 'habilitada'}`)
      reload()
    } catch (err) { toast(err.message, 'danger') }
  }

  async function newLocale(t) {
    const locale = window.prompt(`Nuevo locale para "${t.key}" (${t.channel}). Ejemplos: en, ca, fr`, '')
    if (!locale) return
    try {
      const created = await api.post('/api/notifications/admin/templates', {
        key:       t.key,
        channel:   t.channel,
        locale:    locale.trim().toLowerCase(),
        subject:   t.subject,
        body_text: t.body_text,
        body_html: t.body_html,
        variables: t.variables,
      })
      toast(`Variante ${locale} creada — abre el editor`)
      navigate('config-notifications-template-edit', { templateId: created?.data?.id })
    } catch (err) { toast(err.message ?? 'Error', 'danger') }
  }

  const locales = useMemo(() => {
    const s = new Set(templates.map((t) => t.locale).filter(Boolean))
    return ['all', ...Array.from(s).sort()]
  }, [templates])

  const visible = localeFilter === 'all'
    ? templates
    : templates.filter((t) => t.locale === localeFilter)

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>

  return (
    <div className="p-8 max-w-5xl fade-up">
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Configuración / Notifications</div>
          <h1 className="font-display text-[44px] leading-none tracking-tight"><span className="italic font-normal">Plantillas</span></h1>
          <p className="text-ink3 mt-3 max-w-2xl">
            {templates.length} plantilla(s) registradas. Cualquier evento sin plantilla en DB cae al texto hardcoded del código.
            La búsqueda usa <code className="font-mono">(key, channel, locale)</code>; si el locale pedido no existe se usa <code className="font-mono">es</code> como fallback.
          </p>
        </div>
        <button onClick={() => navigate('config-notifications')} className="btn btn-ghost">← Configuración</button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <span className="text-[12px] uppercase tracking-[0.14em] text-ink3">Locale</span>
        <select value={localeFilter} onChange={(e) => setLocaleFilter(e.target.value)} className="input">
          {locales.map((l) => <option key={l} value={l}>{l === 'all' ? 'Todos' : l}</option>)}
        </select>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-paper2 text-ink3 uppercase text-[11px] tracking-wider">
            <tr>
              <th className="text-left p-3">Key</th>
              <th className="text-left p-3">Channel</th>
              <th className="text-left p-3">Locale</th>
              <th className="text-left p-3">Subject</th>
              <th className="text-left p-3">Vars</th>
              <th className="text-left p-3">Estado</th>
              <th className="text-right p-3"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
              <tr key={t.id} className="border-t border-line">
                <td className="p-3 font-mono">{t.key}</td>
                <td className="p-3">{t.channel}</td>
                <td className="p-3 font-mono uppercase">{t.locale}</td>
                <td className="p-3 max-w-xs truncate">{t.subject ?? <span className="text-ink3 italic">—</span>}</td>
                <td className="p-3">
                  {(t.variables ?? []).map((v) => (
                    <span key={v} className="inline-block px-1.5 py-0.5 mr-1 mb-1 rounded bg-paper2 font-mono text-[11px] text-ink3">{`{{${v}}}`}</span>
                  ))}
                </td>
                <td className="p-3">
                  <button onClick={() => toggle(t)} className={`text-[12px] ${t.enabled ? 'text-ok' : 'text-ink3'}`}>
                    {t.enabled ? '✓ habilitada' : '✗ deshabilitada'}
                  </button>
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button onClick={() => newLocale(t)} className="btn btn-ghost text-[12px] mr-1">+ Locale</button>
                  <button onClick={() => navigate('config-notifications-template-edit', { templateId: t.id })} className="btn btn-ghost text-[12px]">Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
