import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { icons } from '../../lib/icons'
import { Kpi } from '../../lib/ui'
import { fmtNumber } from '../../lib/utils'
import { statusLabel, LEAD_STATUSES } from './leads/LeadStatusBadge'
import { getFunnel, getByDimension, getByOwner, getTimeseries } from './leads/leadsApi'

const DIMENSIONS = [
  ['source', 'Fuente'], ['app_id', 'App'], ['industry', 'Sector'],
  ['utm_campaign', 'Campaña UTM'], ['utm_source', 'UTM source'],
]

export default function LeadsAnalytics() {
  const { navigate } = useApp()
  const [funnel, setFunnel] = useState({ statusCounts: [], milestones: [] })
  const [dimension, setDimension] = useState('source')
  const [byDim, setByDim] = useState([])
  const [byOwner, setByOwner] = useState([])
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getFunnel(), getByOwner(), getTimeseries('week')])
      .then(([f, o, s]) => { setFunnel(f); setByOwner(o); setSeries(s) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { getByDimension(dimension).then(setByDim).catch(() => setByDim([])) }, [dimension])

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>

  const counts = Object.fromEntries(funnel.statusCounts.map((r) => [r.status, r.count]))
  const total = funnel.statusCounts.reduce((a, r) => a + r.count, 0)
  const won = counts.won ?? 0
  const lost = counts.lost ?? 0
  const convRate = total ? Math.round((won / total) * 100) : 0
  const maxStage = Math.max(1, ...LEAD_STATUSES.map((s) => counts[s] ?? 0))
  const milestoneByStatus = Object.fromEntries(funnel.milestones.map((m) => [m.status, m]))

  return (
    <div className="p-8 max-w-7xl fade-up">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <button onClick={() => navigate('leads')} className="btn btn-ghost btn-sm mb-3">{icons.arrow}<span>Volver a leads</span></button>
          <h1 className="font-display text-[44px] leading-none tracking-tight"><span className="italic font-normal">Analítica</span> de leads</h1>
          <p className="text-ink3 mt-3 max-w-xl">Embudo de conversión, atribución por fuente y productividad del equipo.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Kpi label="Leads totales" value={fmtNumber(total)} />
        <Kpi label="Ganados" value={fmtNumber(won)} tone="ok" />
        <Kpi label="Perdidos" value={fmtNumber(lost)} tone="danger" />
        <Kpi label="Tasa de conversión" value={`${convRate}%`} hint="ganados / totales" />
      </div>

      {/* Embudo por etapa */}
      <Section title="Embudo por etapa">
        <div className="space-y-2">
          {LEAD_STATUSES.map((s) => {
            const c = counts[s] ?? 0
            const m = milestoneByStatus[s]
            return (
              <div key={s} className="flex items-center gap-3">
                <div className="w-28 text-[13px] text-ink2">{statusLabel(s)}</div>
                <div className="flex-1 bg-paper2 rounded-full h-5 overflow-hidden border border-line">
                  <div className="h-full bg-ink/80 rounded-full" style={{ width: `${(c / maxStage) * 100}%` }} />
                </div>
                <div className="w-12 text-right font-mono text-[13px]">{c}</div>
                <div className="w-40 text-[12px] text-ink3 text-right">
                  {m ? `${m.reached} alcanzaron · ${m.avg_hours_from_creation ?? '—'}h media` : ''}
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      {/* Por dimensión */}
      <Section
        title="Atribución"
        action={
          <select className="select" value={dimension} onChange={(e) => setDimension(e.target.value)}>
            {DIMENSIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        }
      >
        <SimpleTable
          head={[DIMENSIONS.find((d) => d[0] === dimension)?.[1] ?? 'Valor', 'Total', 'Ganados', 'Perdidos']}
          rows={byDim.map((r) => [r.dimension, fmtNumber(r.total), fmtNumber(r.won), fmtNumber(r.lost)])}
          empty="Sin datos para esta dimensión."
        />
      </Section>

      {/* Por comercial */}
      <Section title="Productividad por comercial">
        <SimpleTable
          head={['Comercial', 'Total', 'Ganados', 'Perdidos', 'Abiertos', 'Horas a ganado']}
          rows={byOwner.map((r) => [
            `${(r.assigned_to ?? '').slice(0, 8)}…`, fmtNumber(r.total), fmtNumber(r.won),
            fmtNumber(r.lost), fmtNumber(r.open), r.avg_hours_to_won ?? '—',
          ])}
          empty="Ningún lead asignado todavía."
        />
      </Section>

      {/* Serie temporal */}
      <Section title="Tendencia semanal">
        <SimpleTable
          head={['Semana', 'Creados', 'Ganados']}
          rows={series.map((r) => [new Date(r.bucket).toISOString().slice(0, 10), fmtNumber(r.created), fmtNumber(r.won)])}
          empty="Sin datos en el periodo."
        />
      </Section>
    </div>
  )
}

function Section({ title, action, children }) {
  return (
    <div className="bg-white border border-line rounded-xl shadow-card p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-[18px]">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function SimpleTable({ head, rows, empty }) {
  if (!rows.length) return <div className="text-[13px] text-ink3 py-3">{empty}</div>
  return (
    <table className="t">
      <thead><tr>{head.map((h, i) => <th key={i} className={i === 0 ? '' : 'text-right'}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j} className={j === 0 ? 'font-mono text-[12px]' : 'text-right font-mono text-[13px]'}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  )
}
