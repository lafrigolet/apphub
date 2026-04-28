import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { api } from '../../lib/api'
import { icons } from '../../lib/icons'
import { EmptyState } from '../../lib/ui'
import CreateAppModal from './modals/CreateAppModal'

function StatusPill({ status }) {
  const cls = status === 'active'
    ? 'bg-okbg text-ok border-ok/30'
    : 'bg-paper2 text-ink3 border-line'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${cls}`}>{status}</span>
}

export default function StaffApps() {
  const { openModal, toast } = useApp()
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  function reload() {
    setLoading(true)
    api.get('/api/apps/')
      .then((list) => setApps(Array.isArray(list) ? list : []))
      .catch((err) => { setApps([]); toast(err.message ?? 'Error cargando apps', 'danger') })
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  async function toggleStatus(app) {
    const next = app.status === 'active' ? 'suspended' : 'active'
    try {
      await api.patch(`/api/apps/${app.app_id}/status`, { status: next })
      toast(`App ${app.app_id} → ${next}`)
      reload()
    } catch (err) {
      toast(err.message ?? 'No se pudo cambiar el estado', 'danger')
    }
  }

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>

  const filtered = apps.filter((a) => {
    const q = query.toLowerCase()
    if (!q) return true
    return [a.app_id, a.display_name, a.subdomain, a.jwt_audience]
      .filter(Boolean).some((x) => String(x).toLowerCase().includes(q))
  })

  return (
    <div className="p-8 max-w-7xl fade-up">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Plataforma</div>
          <h1 className="font-display text-[44px] leading-none tracking-tight">
            <span className="italic font-normal">Apps</span>
          </h1>
          <p className="text-ink3 mt-3 max-w-xl">
            {filtered.length} de {apps.length} apps · cada app define un <code className="font-mono text-ink">app_id</code> y el
            subdominio bajo el que sirve su portal (p. ej. <span className="font-mono">yoga.apphub.com</span>).
          </p>
        </div>
        <button
          onClick={() => openModal(<CreateAppModal onCreated={reload} />, { size: 'md' })}
          className="btn btn-primary shrink-0"
        >
          {icons.plus}<span>Nueva app</span>
        </button>
      </div>

      <div className="bg-white border border-line rounded-xl p-4 mb-4 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[260px] relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3">{icons.search}</span>
            <input
              className="input pl-9"
              placeholder="Buscar por app_id, nombre, subdominio…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="bg-white border border-line rounded-xl shadow-card overflow-hidden">
        <table className="t">
          <thead>
            <tr>
              <th>App</th>
              <th>app_id</th>
              <th>Subdominio</th>
              <th>JWT audience</th>
              <th>Estado</th>
              <th className="text-right pr-6">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0
              ? <EmptyState cols={6} msg="No hay apps registradas con esos filtros." />
              : filtered.map((a) => (
                <tr key={a.app_id}>
                  <td>
                    <div className="font-medium">{a.display_name}</div>
                  </td>
                  <td className="font-mono text-[12.5px] text-ink2">{a.app_id}</td>
                  <td className="font-mono text-[12.5px] text-ink2">{a.subdomain}</td>
                  <td className="font-mono text-[12.5px] text-ink3">{a.jwt_audience}</td>
                  <td><StatusPill status={a.status} /></td>
                  <td className="text-right pr-6">
                    <button
                      onClick={() => toggleStatus(a)}
                      className="btn btn-ghost btn-sm"
                      title={a.status === 'active' ? 'Suspender' : 'Reactivar'}
                    >
                      {a.status === 'active' ? icons.pause : icons.play}
                      <span>{a.status === 'active' ? 'Suspender' : 'Reactivar'}</span>
                    </button>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}
