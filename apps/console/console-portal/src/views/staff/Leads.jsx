import { useEffect, useState, useCallback } from 'react'
import { useApp } from '../../context/AppContext'
import { api } from '../../lib/api'
import { PLATFORM_APP, PLATFORM_TENANT } from '../../lib/auth'
import { fmtDate, relTime, initials } from '../../lib/utils'
import { icons } from '../../lib/icons'
import { EmptyState } from '../../lib/ui'
import LeadStatusBadge, { LEAD_STATUSES, statusLabel } from './leads/LeadStatusBadge'
import { listLeads, downloadLeadsCsv } from './leads/leadsApi'
import LeadDetail from './leads/LeadDetail'

const INBOXES = [
  { k: 'all',        label: 'Todos' },
  { k: 'mine',       label: 'Mis leads' },
  { k: 'unassigned', label: 'Sin asignar' },
  { k: 'followup',   label: 'Follow-up vencido' },
]

const STATUS_OPTIONS = [['ALL', 'Todos los estados'], ...LEAD_STATUSES.map((s) => [s, statusLabel(s)])]

// Mapa userId → display para mostrar el comercial dueño. Best-effort: si la
// llamada a auth falla, caemos a un id corto.
function useStaffMap() {
  const [map, setMap] = useState({})
  useEffect(() => {
    api.get(`/api/users/?appId=${PLATFORM_APP}&tenantId=${PLATFORM_TENANT}&role=staff,super_admin`)
      .then((list) => {
        const m = {}
        for (const u of list ?? []) m[u.id] = u.display_name || u.email || u.id
        setMap(m)
      })
      .catch(() => setMap({}))
  }, [])
  return map
}

function OwnerCell({ id, staffMap }) {
  if (!id) return <span className="text-ink3 text-[12px]">— sin asignar</span>
  const label = staffMap[id] || `${id.slice(0, 8)}…`
  return (
    <div className="flex items-center gap-2">
      <span className="avatar" style={{ background: '#D9D2C220', border: '1px solid #D9D2C230', width: 24, height: 24, fontSize: 10 }}>{initials(label)}</span>
      <span className="text-[13px] truncate max-w-[140px]">{label}</span>
    </div>
  )
}

export default function StaffLeads() {
  const { navigate, openModal, toast } = useApp()
  const staffMap = useStaffMap()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [inbox, setInbox] = useState('all')
  const [filters, setFilters] = useState({ status: 'ALL', q: '' })
  const [mode, setMode] = useState('list')

  const reload = useCallback(() => {
    setLoading(true)
    listLeads(inbox, filters)
      .then(setLeads)
      .catch(() => setLeads([]))
      .finally(() => setLoading(false))
  }, [inbox, filters])

  useEffect(() => { reload() }, [reload])

  function openLead(lead) {
    openModal(<LeadDetail id={lead.id} staffMap={staffMap} onChanged={reload} />, { size: 'lg' })
  }

  async function exportCsv() {
    try { await downloadLeadsCsv(inbox, filters); toast('CSV exportado') }
    catch { toast('No se pudo exportar el CSV', 'err') }
  }

  return (
    <div className="p-8 max-w-7xl fade-up">
      <div className="flex items-start justify-between gap-6 mb-6">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Plataforma</div>
          <h1 className="font-display text-[44px] leading-none tracking-tight">
            <span className="italic font-normal">Leads</span>
          </h1>
          <p className="text-ink3 mt-3 max-w-xl">
            {leads.length} leads · captación desde las landings, email entrante y formularios. Asigna, cualifica y convierte.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => navigate('leads-analytics')} className="btn btn-ghost">{icons.spark}<span>Analítica</span></button>
          <button onClick={exportCsv} className="btn btn-ghost">{icons.download}<span>Exportar CSV</span></button>
        </div>
      </div>

      {/* Bandejas */}
      <div className="flex items-center gap-1 mb-4 border-b border-line">
        {INBOXES.map((t) => (
          <button
            key={t.k}
            onClick={() => setInbox(t.k)}
            className={`px-4 py-2 text-[13.5px] border-b-2 -mb-px ${inbox === t.k ? 'border-ink text-ink font-medium' : 'border-transparent text-ink3 hover:text-ink2'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white border border-line rounded-xl p-4 mb-4 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[260px] relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3">{icons.search}</span>
            <input
              className="input pl-9"
              placeholder="Buscar por nombre, email, empresa o mensaje…"
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            />
          </div>
          <select className="select" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <div className="flex items-center rounded-lg border border-line overflow-hidden">
            <button onClick={() => setMode('list')}   className={`px-3 py-1.5 text-[13px] ${mode === 'list' ? 'bg-paper2 text-ink font-medium' : 'text-ink3'}`}>Lista</button>
            <button onClick={() => setMode('kanban')} className={`px-3 py-1.5 text-[13px] ${mode === 'kanban' ? 'bg-paper2 text-ink font-medium' : 'text-ink3'}`}>Kanban</button>
          </div>
        </div>
      </div>

      {loading
        ? <div className="p-10 text-center text-ink3">Cargando…</div>
        : mode === 'list'
          ? <LeadTable leads={leads} staffMap={staffMap} onOpen={openLead} />
          : <LeadKanban leads={leads} onOpen={openLead} />}
    </div>
  )
}

function LeadTable({ leads, staffMap, onOpen }) {
  return (
    <div className="bg-white border border-line rounded-xl shadow-card overflow-hidden">
      <table className="t">
        <thead>
          <tr>
            <th>Contacto</th><th>Empresa</th><th>Estado</th><th>Fuente</th>
            <th>Comercial</th><th className="text-right">Score</th><th>Follow-up</th><th>Alta</th><th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {leads.length === 0
            ? <EmptyState cols={9} msg="Ningún lead coincide con los filtros." />
            : leads.map((l) => (
              <tr key={l.id} className="clickable" onClick={() => onOpen(l)}>
                <td>
                  <div className="font-medium truncate max-w-[200px]">{l.contact_name}</div>
                  <div className="text-xs text-ink3 truncate max-w-[200px]">{l.email}</div>
                </td>
                <td className="text-[13px]">{l.business_name || '—'}</td>
                <td><LeadStatusBadge status={l.status} /></td>
                <td><span className="font-mono text-[11.5px] text-ink2">{l.source || '—'}</span></td>
                <td><OwnerCell id={l.assigned_to} staffMap={staffMap} /></td>
                <td className="text-right font-mono text-[13px]">{l.score ?? '—'}</td>
                <td className="text-[13px] text-ink3">{l.next_follow_up_at ? fmtDate(l.next_follow_up_at) : '—'}</td>
                <td className="text-[13px] text-ink3">{relTime(l.created_at)}</td>
                <td className="text-ink3">{icons.chevronR}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}

function LeadKanban({ leads, onOpen }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {LEAD_STATUSES.map((status) => {
        const col = leads.filter((l) => l.status === status)
        return (
          <div key={status} className="bg-paper2 border border-line rounded-xl p-2 min-h-[120px]">
            <div className="flex items-center justify-between px-2 py-1.5 mb-1">
              <LeadStatusBadge status={status} />
              <span className="text-[12px] text-ink3 font-mono">{col.length}</span>
            </div>
            <div className="space-y-2">
              {col.map((l) => (
                <button
                  key={l.id}
                  onClick={() => onOpen(l)}
                  className="w-full text-left bg-white border border-line rounded-lg p-2.5 hover:shadow-card transition-shadow"
                >
                  <div className="font-medium text-[13px] truncate">{l.contact_name}</div>
                  <div className="text-[11.5px] text-ink3 truncate">{l.email}</div>
                  {l.business_name && <div className="text-[11.5px] text-ink2 truncate mt-0.5">{l.business_name}</div>}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
