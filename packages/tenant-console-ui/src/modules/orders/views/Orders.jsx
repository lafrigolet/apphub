import { useState } from 'react'
import { api } from '../../../shell/lib/api'
import { useApp } from '../../../shell/lib/context'
import { useFetch, PageHeader, Table } from '../../../shell/lib/list-helpers'

const STATUSES = ['', 'pending', 'paid', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded']

export default function Orders() {
  const { toast } = useApp()
  const [status, setStatus] = useState('')
  const [data, { loading, error, refetch }] = useFetch(
    () => api.get(`/api/orders/?limit=100${status ? '&status=' + status : ''}`),
    [status],
  )

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (error)   return <div className="p-10 text-center text-danger">Error: {error}</div>

  const rows = data?.data ?? data ?? []

  async function changeStatus(id, next) {
    try { await api.patch(`/api/orders/${id}/status`, { status: next }); toast(`Pedido ${next}`); refetch() }
    catch (e) { toast(e.message, 'danger') }
  }

  return (
    <div className="p-8 max-w-7xl fade-up">
      <PageHeader
        kicker="Negocio"
        title="Pedidos"
        subtitle="Listado del ledger de pedidos. Cambia estado, registra notas y consulta el modifications log desde el detalle."
        actions={
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'Todos'}</option>)}
          </select>
        }
      />
      <Table
        cols={[
          { key: 'id',        label: 'ID',     render: (r) => <span className="font-mono text-[11px]">{r.id?.slice(0, 8)}</span> },
          { key: 'created',   label: 'Fecha',  render: (r) => r.created_at?.slice(0, 16).replace('T', ' ') },
          { key: 'buyer',     label: 'Comprador', render: (r) => r.buyer_user_id?.slice(0, 8) ?? '—' },
          { key: 'total',     label: 'Total',  render: (r) => `${(r.total_cents ?? 0) / 100} €` },
          { key: 'status',    label: 'Estado' },
          { key: 'actions',   label: '', render: (r) => (
            <select className="select text-[12px]" value={r.status} onChange={(e) => changeStatus(r.id, e.target.value)} onClick={(e) => e.stopPropagation()}>
              {STATUSES.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) },
        ]}
        rows={rows}
        empty={{ title: 'Sin pedidos en el filtro' }}
      />
    </div>
  )
}
