// Pill de estado para leads. Los estados del CRM (new→contacted→qualified→
// won|lost, +closed legacy) no coinciden con los de tenants/pagos, así que
// llevan su propio mapa de color en vez de reutilizar ui/StatusBadge.
const STYLES = {
  new:       { label: 'Nuevo',        cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  contacted: { label: 'Contactado',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  qualified: { label: 'Cualificado',  cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  won:       { label: 'Ganado',       cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  lost:      { label: 'Perdido',      cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  closed:    { label: 'Cerrado',      cls: 'bg-stone-100 text-stone-600 border-stone-200' },
}

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost']

export function statusLabel(status) {
  return STYLES[status]?.label ?? status
}

export default function LeadStatusBadge({ status }) {
  const s = STYLES[status] ?? { label: status, cls: 'bg-stone-100 text-stone-600 border-stone-200' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${s.cls}`}>
      {s.label}
    </span>
  )
}
