import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api.js'

const STATUSES = ['new', 'contacted', 'closed', 'spam']
const PAGE_SIZE = 50

const STATUS_STYLES = {
  new:       'bg-electric-50 text-electric-700 border-electric-200',
  contacted: 'bg-spark-400/15 text-spark-600 border-spark-400/30',
  closed:    'bg-ink-900/5 text-ink-700 border-ink-900/10',
  spam:      'bg-red-50 text-red-700 border-red-200',
}

// Derivado del campo `source` que cada formulario del landing rellena:
// - 'landing-budget'  → modal de la calculadora solar
// - 'landing-contact' → form general de la sección Contacto
// Cualquier otro valor (incluido el legacy 'landing' previo a CRM-lite) cae
// en "Otro" — el comercial ve el source crudo para no perder info.
const KINDS = [
  { id: '',                 label: 'Todos' },
  { id: 'landing-contact',  label: 'Contacto' },
  { id: 'landing-budget',   label: 'Presupuesto' },
]

const KIND_BADGES = {
  'landing-contact': { label: 'Contacto',    cls: 'bg-electric-50 text-electric-700 border-electric-200' },
  'landing-budget':  { label: 'Presupuesto', cls: 'bg-spark-400/15 text-spark-700 border-spark-400/30' },
}

function renderKindBadge(source) {
  const b = KIND_BADGES[source]
  if (b) return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium border ${b.cls}`}>{b.label}</span>
  return <span className="text-xs text-ink-700/60">{source || '—'}</span>
}

export default function InquiriesList() {
  const [statusFilter, setStatusFilter] = useState('')
  const [kindFilter, setKindFilter]     = useState('')   // client-side por ahora
  const [offset, setOffset]             = useState(0)
  const [rows, setRows]                 = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    params.set('limit', PAGE_SIZE)
    params.set('offset', offset)
    api('GET', `/api/inquiries/v1/inquiries?${params}`)
      .then((j) => setRows(j.data ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [statusFilter, offset])

  // Filtro de Tipo es client-side hasta que el endpoint admin acepte
  // ?source=... (roadmap iteración 5).
  const visibleRows = useMemo(() => {
    if (!kindFilter) return rows
    return rows.filter((r) => r.source === kindFilter)
  }, [rows, kindFilter])

  function changeStatus(next) {
    setStatusFilter(next)
    setOffset(0)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-semibold">Leads</h1>
        <p className="text-sm text-ink-700 mt-1">
          Leads recibidos por los formularios del landing (contacto + presupuesto).
        </p>
      </div>

      <div className="space-y-3 mb-6">
        <FilterRow label="Tipo">
          {KINDS.map((k) => (
            <FilterPill key={k.id} label={k.label} active={kindFilter === k.id} onClick={() => setKindFilter(k.id)} />
          ))}
        </FilterRow>
        <FilterRow label="Status">
          <FilterPill label="Todos" active={statusFilter === ''} onClick={() => changeStatus('')} />
          {STATUSES.map((s) => (
            <FilterPill key={s} label={s} active={statusFilter === s} onClick={() => changeStatus(s)} />
          ))}
        </FilterRow>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">{error}</div>
      )}

      <div className="bg-white rounded-2xl border border-ink-900/5 shadow-soft overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bone/60 text-ink-700/70 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3">Fecha</th>
              <th className="text-left px-5 py-3">Nombre</th>
              <th className="text-left px-5 py-3">Email</th>
              <th className="text-left px-5 py-3">Servicio</th>
              <th className="text-left px-5 py-3">Tipo</th>
              <th className="text-left px-5 py-3">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-5 py-12 text-center text-ink-700/60">Cargando…</td></tr>
            )}
            {!loading && visibleRows.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-12 text-center text-ink-700/60">
                Sin leads{statusFilter ? ` con status "${statusFilter}"` : ''}{kindFilter ? ` de tipo "${KIND_BADGES[kindFilter]?.label ?? kindFilter}"` : ''}.
              </td></tr>
            )}
            {!loading && visibleRows.map((r) => (
              <tr key={r.id} className="border-t border-ink-900/5 hover:bg-bone/40">
                <td className="px-5 py-3 whitespace-nowrap text-ink-700">{formatDate(r.created_at ?? r.createdAt)}</td>
                <td className="px-5 py-3 font-medium">{r.contact_name ?? r.contactName}</td>
                <td className="px-5 py-3 text-ink-700">{r.email}</td>
                <td className="px-5 py-3 text-ink-700">{r.subject ?? '—'}</td>
                <td className="px-5 py-3">{renderKindBadge(r.source)}</td>
                <td className="px-5 py-3">
                  <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[r.status]}`}>{r.status}</span>
                </td>
                <td className="px-5 py-3 text-right">
                  <Link to={`/admin/inquiries/${r.id}`} className="text-electric-700 font-medium hover:text-electric-900 transition">Ver →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4 text-sm text-ink-700">
        <div>
          {visibleRows.length > 0 && `Mostrando ${offset + 1}–${offset + visibleRows.length}${kindFilter && rows.length !== visibleRows.length ? ` (filtrado de ${rows.length})` : ''}`}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}
            className="px-3 py-1.5 rounded-lg border border-ink-900/10 disabled:opacity-40 hover:border-ink-900/30 transition">← Anterior</button>
          <button onClick={() => setOffset(offset + PAGE_SIZE)} disabled={rows.length < PAGE_SIZE}
            className="px-3 py-1.5 rounded-lg border border-ink-900/10 disabled:opacity-40 hover:border-ink-900/30 transition">Siguiente →</button>
        </div>
      </div>
    </div>
  )
}

function FilterRow({ label, children }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-[10px] uppercase tracking-widest text-ink-700/60 font-mono">{label}</span>
      <div className="flex items-center gap-2 flex-wrap">{children}</div>
    </div>
  )
}

function FilterPill({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition border ${active ? 'bg-ink-900 text-white border-ink-900' : 'bg-white text-ink-700 border-ink-900/10 hover:border-ink-900/30'}`}>
      {label}
    </button>
  )
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('es-ES', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}
