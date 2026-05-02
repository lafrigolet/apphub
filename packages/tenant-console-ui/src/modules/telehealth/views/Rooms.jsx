import { api } from '../../../shell/lib/api'
import { useFetch, PageHeader, Table } from '../../../shell/lib/list-helpers'

// Telehealth doesn't expose a "list rooms" endpoint per se — rooms are
// provisioned per-booking. We surface the most recent provisioned rooms
// from the booking-rooms join. Read-only for now.
export default function Rooms() {
  const [data, { loading, error }] = useFetch(
    () => api.get('/api/bookings/?modality=virtual&limit=50').catch(() => ({ data: [] })),
  )

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (error)   return <div className="p-10 text-center text-danger">Error: {error}</div>

  const rows = (data?.data ?? data ?? []).filter((b) => b.telehealth_room_id)

  return (
    <div className="p-8 max-w-6xl fade-up">
      <PageHeader kicker="Operaciones" title="Telehealth" subtitle="Salas virtuales activas. La provisión se hace al confirmar una booking de modalidad virtual; este listado es read-only." />
      <Table
        cols={[
          { key: 'starts_at',         label: 'Inicio', render: (r) => r.starts_at?.slice(0, 16).replace('T', ' ') },
          { key: 'service_id',        label: 'Servicio', render: (r) => r.service_id?.slice(0, 8) ?? '—' },
          { key: 'telehealth_room_id', label: 'Sala', render: (r) => <span className="font-mono text-[11px]">{r.telehealth_room_id?.slice(0, 12) ?? '—'}</span> },
          { key: 'status',            label: 'Estado' },
        ]}
        rows={rows}
        empty={{ title: 'Sin salas activas', hint: 'No hay reservas virtuales con sala provisionada en este momento.' }}
      />
    </div>
  )
}
