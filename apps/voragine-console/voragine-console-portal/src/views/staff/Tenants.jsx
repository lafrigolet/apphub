import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { api } from '../../lib/api'
import { adaptTenant } from '../../lib/adapters'
import { APP_ID } from '../../lib/auth'
import { fmtDate, fmtMoney, tenantColor, initials } from '../../lib/utils'
import { icons } from '../../lib/icons'
import { StatusBadge, StripeBadge, PlanBadge, EmptyState } from '../../lib/ui'
import CreateTenantModal from './modals/CreateTenantModal'

function FilterChip({ label, filterKey, options, filters, setFilters }) {
  const [open, setOpen] = useState(false)
  const current = filters[filterKey]
  const currentLabel = options.find(o => o[0] === current)?.[1] || 'Todos'
  const isActive = current !== 'ALL'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`btn btn-ghost btn-sm ${isActive ? 'border-ink bg-paper2' : ''}`}
      >
        <span className="text-ink3">{icons.filter}</span>
        <span className="text-ink3">{label}:</span>
        <span className="font-medium">{currentLabel}</span>
        {icons.chevron}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white border border-line rounded-lg shadow-pop p-1 z-20 min-w-[160px]">
          {options.map(([v, l]) => (
            <button
              key={v}
              onClick={() => { setFilters(f => ({ ...f, [filterKey]: v })); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 rounded-md hover:bg-paper2 text-[13px] flex items-center justify-between"
            >
              <span>{l}</span>
              {current === v && <span className="text-ok">{icons.check}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function StaffTenants() {
  const { navigate, filters, setFilters, sort, setSort, openModal, toast } = useApp()
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/api/tenants/tenants?appId=${APP_ID}`)
      .then((list) => setTenants(list.map(adaptTenant)))
      .catch(() => setTenants([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>

  const filtered = tenants.filter(t => {
    const q = filters.query.toLowerCase()
    const matchQ = !q || [t.name, t.legal, t.cif, t.subdomain, t.customDomain].filter(Boolean).some(x => x.toLowerCase().includes(q))
    const matchS = filters.status === 'ALL' || t.status === filters.status
    const matchP = filters.plan === 'ALL' || t.plan === filters.plan
    const matchC = filters.country === 'ALL' || t.country === filters.country
    return matchQ && matchS && matchP && matchC
  }).sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1
    if (sort.key === 'name')     return a.name.localeCompare(b.name) * dir
    if (sort.key === 'created')  return (new Date(a.created) - new Date(b.created)) * dir
    if (sort.key === 'volMonth') return (a.volMonth - b.volMonth) * dir
    return 0
  })

  function toggleSort(key) {
    setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))
  }

  function SortArrow({ col }) {
    if (sort.key !== col) return <span className="text-ink3 opacity-30">↕</span>
    return <span>{sort.dir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div className="p-8 max-w-7xl fade-up">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Plataforma</div>
          <h1 className="font-display text-[44px] leading-none tracking-tight">
            <span className="italic font-normal">Tenants</span>
          </h1>
          <p className="text-ink3 mt-3 max-w-xl">
            {filtered.length} de {tenants.length} tenants · gestiona el ciclo de vida completo desde el alta hasta el archivado.
          </p>
        </div>
        <button
          onClick={() => openModal(<CreateTenantModal />, { size: 'lg' })}
          className="btn btn-primary shrink-0"
        >
          {icons.plus}<span>Nuevo tenant</span>
        </button>
      </div>

      <div className="bg-white border border-line rounded-xl p-4 mb-4 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[260px] relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3">{icons.search}</span>
            <input
              className="input pl-9"
              placeholder="Buscar por nombre, razón social, CIF, dominio…"
              value={filters.query}
              onChange={e => setFilters(f => ({ ...f, query: e.target.value }))}
            />
          </div>
          <FilterChip label="Estado"  filterKey="status"  options={[['ALL','Todos'],['ACTIVE','Activo'],['SUSPENDED','Suspendido'],['ARCHIVED','Archivado']]} filters={filters} setFilters={setFilters} />
          <FilterChip label="Plan"    filterKey="plan"    options={[['ALL','Todos'],['STARTER','Starter'],['PRO','Pro'],['ENTERPRISE','Enterprise']]} filters={filters} setFilters={setFilters} />
          <FilterChip label="País"    filterKey="country" options={[['ALL','Todos'],['ES','España'],['FR','Francia'],['GB','Reino Unido']]} filters={filters} setFilters={setFilters} />
        </div>
      </div>

      <div className="bg-white border border-line rounded-xl shadow-card overflow-hidden">
        <table className="t">
          <thead>
            <tr>
              <th onClick={() => toggleSort('name')}     className="cursor-pointer">Tenant <SortArrow col="name" /></th>
              <th>Dominio</th>
              <th>Plan</th>
              <th>Estado</th>
              <th>KYC</th>
              <th onClick={() => toggleSort('volMonth')} className="cursor-pointer text-right">Volumen mes <SortArrow col="volMonth" /></th>
              <th onClick={() => toggleSort('created')}  className="cursor-pointer">Alta <SortArrow col="created" /></th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0
              ? <EmptyState cols={8} msg="Ningún tenant coincide con los filtros." />
              : filtered.map(t => {
                const color = tenantColor(t.id)
                return (
                  <tr key={t.id} className="clickable" onClick={() => navigate('tenants', { tenant: t.id })}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="avatar" style={{ background: `${color}20`, color, border: `1px solid ${color}30` }}>
                          {initials(t.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{t.name}</div>
                          <div className="text-xs text-ink3 truncate">{t.legal} · {t.cif}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="text-[13px]">{t.customDomain || '—'}</div>
                      <div className="font-mono text-[11.5px] text-ink3">{t.subdomain}.voragine.app</div>
                    </td>
                    <td><PlanBadge plan={t.plan} /></td>
                    <td><StatusBadge status={t.status} /></td>
                    <td><StripeBadge status={t.stripe} /></td>
                    <td className="text-right font-mono text-[13px]">{t.volMonth ? fmtMoney(t.volMonth) : '—'}</td>
                    <td className="text-[13px] text-ink3">{fmtDate(t.created)}</td>
                    <td className="text-ink3">{icons.chevronR}</td>
                  </tr>
                )
              })
            }
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4 text-[13px] text-ink3">
        <div>Mostrando {filtered.length} resultados</div>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost btn-sm" disabled>Anterior</button>
          <button className="btn btn-ghost btn-sm" disabled>Siguiente</button>
        </div>
      </div>
    </div>
  )
}
