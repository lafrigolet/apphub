import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'

export default function NotificationsTemplates() {
  const { toast, navigate } = useApp()
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)

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
      toast(`Template ${t.key} ${t.enabled ? 'deshabilitada' : 'habilitada'}`)
      reload()
    } catch (err) { toast(err.message, 'danger') }
  }

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>

  return (
    <div className="p-8 max-w-5xl fade-up">
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Configuración / Notifications</div>
          <h1 className="font-display text-[44px] leading-none tracking-tight"><span className="italic font-normal">Plantillas</span></h1>
          <p className="text-ink3 mt-3 max-w-2xl">
            {templates.length} plantilla(s) registradas. Cualquier evento sin plantilla en DB cae al texto hardcoded del código.
          </p>
        </div>
        <button onClick={() => navigate('config-notifications')} className="btn btn-ghost">← Configuración</button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-paper2 text-ink3 uppercase text-[11px] tracking-wider">
            <tr>
              <th className="text-left p-3">Key</th>
              <th className="text-left p-3">Channel</th>
              <th className="text-left p-3">Subject</th>
              <th className="text-left p-3">Vars</th>
              <th className="text-left p-3">Estado</th>
              <th className="text-right p-3"></th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className="border-t border-line">
                <td className="p-3 font-mono">{t.key}</td>
                <td className="p-3">{t.channel}</td>
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
                <td className="p-3 text-right">
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
