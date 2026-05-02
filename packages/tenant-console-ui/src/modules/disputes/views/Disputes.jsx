import { useState } from 'react'
import { api } from '../../../shell/lib/api'
import { useApp } from '../../../shell/lib/context'
import { useFetch, PageHeader, Table } from '../../../shell/lib/list-helpers'

export default function Disputes() {
  const { toast } = useApp()
  const [status, setStatus] = useState('open')
  const [data, { loading, error, refetch }] = useFetch(
    () => api.get(`/api/disputes/?status=${status}&limit=100`),
    [status],
  )

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (error)   return <div className="p-10 text-center text-danger">Error: {error}</div>

  const rows = data?.data ?? data ?? []

  async function submitToStripe(id) {
    if (!confirm('¿Enviar la evidencia recopilada a Stripe? Esta acción es irreversible.')) return
    try { await api.post(`/api/disputes/${id}/submit-to-stripe`); toast('Evidencia enviada a Stripe'); refetch() }
    catch (e) { toast(e.message, 'danger') }
  }

  return (
    <div className="p-8 max-w-7xl fade-up">
      <PageHeader
        kicker="Comercial"
        title="Disputas"
        subtitle="Operativa pre-chargeback. Recopila evidencia, intercambia mensajes con el comprador, y submitea a Stripe cuando proceda."
        actions={
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">Abiertas</option>
            <option value="resolved">Resueltas</option>
            <option value="lost">Perdidas</option>
            <option value="won">Ganadas</option>
          </select>
        }
      />
      <Table
        cols={[
          { key: 'id',         label: 'ID', render: (r) => <span className="font-mono text-[11px]">{r.id?.slice(0, 8)}</span> },
          { key: 'order_id',   label: 'Pedido', render: (r) => r.order_id?.slice(0, 8) ?? '—' },
          { key: 'reason',     label: 'Motivo' },
          { key: 'amount',     label: 'Importe', render: (r) => `${(r.amount_cents ?? 0) / 100} €` },
          { key: 'created_at', label: 'Abierta', render: (r) => r.created_at?.slice(0, 10) },
          { key: 'actions',    label: '', render: (r) => (
            r.status === 'open'
              ? <button onClick={(e) => { e.stopPropagation(); submitToStripe(r.id) }} className="text-[12px] text-link hover:underline">Submit a Stripe</button>
              : null
          ) },
        ]}
        rows={rows}
        empty={{ title: 'Sin disputas en este estado' }}
      />
    </div>
  )
}
