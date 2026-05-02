import { useState } from 'react'
import { api } from '../../../shell/lib/api'
import { useApp } from '../../../shell/lib/context'
import { useFetch, PageHeader, Table } from '../../../shell/lib/list-helpers'

const STATUSES = ['', 'requested', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show', 'rescheduled']

export default function Bookings() {
  const { toast, navigate } = useApp()
  const [status, setStatus] = useState('')
  const [data, { loading, error, refetch }] = useFetch(
    () => api.get(`/api/bookings/?limit=100${status ? '&status=' + status : ''}`),
    [status],
  )

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (error)   return <div className="p-10 text-center text-danger">Error: {error}</div>

  const rows = data?.data ?? data ?? []

  async function cancel(b) {
    if (!confirm(`¿Cancelar la reserva ${b.id.slice(0, 8)}?`)) return
    try { await api.post(`/api/bookings/${b.id}/cancel`, { reason: 'tenant_console' }); toast('Reserva cancelada'); refetch() }
    catch (e) { toast(e.message, 'danger') }
  }

  return (
    <div className="p-8 max-w-7xl fade-up">
      <PageHeader
        kicker="Operaciones"
        title="Reservas"
        subtitle="Listado de reservas filtrado por estado. Click en una fila para ver el detalle (próximamente)."
        actions={
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'Todas'}</option>)}
          </select>
        }
      />
      <Table
        cols={[
          { key: 'id',       label: 'ID',     render: (r) => <span className="font-mono text-[11px]">{r.id.slice(0, 8)}</span> },
          { key: 'starts',   label: 'Inicio', render: (r) => r.starts_at?.slice(0, 16).replace('T', ' ') },
          { key: 'service',  label: 'Servicio', render: (r) => r.service_id?.slice(0, 8) ?? '—' },
          { key: 'client',   label: 'Cliente', render: (r) => r.client_user_id?.slice(0, 8) ?? '—' },
          { key: 'status',   label: 'Estado' },
          { key: 'actions',  label: '', render: (r) => (
            ['cancelled', 'completed', 'no_show'].includes(r.status) ? null
            : <button onClick={(e) => { e.stopPropagation(); cancel(r) }} className="text-danger text-[12px] hover:underline">Cancelar</button>
          ) },
        ]}
        rows={rows}
        empty={{ title: 'Sin reservas', hint: 'No hay reservas que coincidan con el filtro.' }}
      />
    </div>
  )
}
