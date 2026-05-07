import { api } from '../../../shell/lib/api'
import { useFetch, PageHeader, Table } from '../../../shell/lib/list-helpers'

export default function Threads() {
  const [data, { loading, error }] = useFetch(() => api.get('/api/messaging/threads?limit=100'))

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (error)   return <div className="p-10 text-center text-danger">Error: {error}</div>

  const rows = data?.data ?? data ?? []

  return (
    <div className="p-8 max-w-6xl fade-up">
      <PageHeader kicker="Conversaciones" title="Mensajes" subtitle="Hilos buyer ↔ vendor. El tiempo real está en ADR 010 (deferido); este listado se refresca al entrar." />
      <Table
        cols={[
          { key: 'id',           label: 'Hilo', render: (r) => <span className="font-mono text-[11px]">{r.id?.slice(0, 8)}</span> },
          { key: 'subject',      label: 'Asunto' },
          { key: 'last_msg_at',  label: 'Último mensaje', render: (r) => r.last_message_at?.slice(0, 16).replace('T', ' ') ?? '—' },
          { key: 'unread',       label: 'Sin leer', render: (r) => r.unread_count ?? 0 },
        ]}
        rows={rows}
        empty={{ title: 'Sin hilos' }}
      />
    </div>
  )
}
