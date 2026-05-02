import { useState } from 'react'
import { api } from '../../../shell/lib/api'
import { useApp } from '../../../shell/lib/context'
import { useFetch, PageHeader, Table } from '../../../shell/lib/list-helpers'

export default function Reviews() {
  const { toast } = useApp()
  const [status, setStatus] = useState('pending')
  const [data, { loading, error, refetch }] = useFetch(
    () => api.get(`/api/reviews/?status=${status}&limit=50`),
    [status],
  )

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (error)   return <div className="p-10 text-center text-danger">Error: {error}</div>

  const rows = data?.data ?? data ?? []

  async function setStatusOf(id, next) {
    try { await api.patch(`/api/reviews/${id}/status`, { status: next }); toast(`Reseña ${next}`); refetch() }
    catch (e) { toast(e.message, 'danger') }
  }

  return (
    <div className="p-8 max-w-6xl fade-up">
      <PageHeader
        kicker="Comercial"
        title="Reseñas"
        subtitle="Modera reseñas pendientes (publicar / ocultar). Las publicadas alimentan los aggregates y el JSON-LD."
        actions={
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pending">Pendientes</option>
            <option value="published">Publicadas</option>
            <option value="hidden">Ocultas</option>
          </select>
        }
      />
      <Table
        cols={[
          { key: 'rating',   label: '★', render: (r) => '★'.repeat(r.rating ?? 0) },
          { key: 'title',    label: 'Título' },
          { key: 'body',     label: 'Texto', render: (r) => <span className="text-ink2 line-clamp-2">{r.body}</span> },
          { key: 'verified', label: 'Verif.', render: (r) => r.is_verified_purchase ? '✓' : '' },
          { key: 'created',  label: 'Fecha', render: (r) => r.created_at?.slice(0, 10) },
          { key: 'actions',  label: '', render: (r) => (
            <div className="flex gap-2 justify-end">
              {status !== 'published' && <button onClick={() => setStatusOf(r.id, 'published')} className="text-[12px] text-ok hover:underline">Publicar</button>}
              {status !== 'hidden'    && <button onClick={() => setStatusOf(r.id, 'hidden')}    className="text-[12px] text-ink3 hover:underline">Ocultar</button>}
            </div>
          ) },
        ]}
        rows={rows}
        empty={{ title: `Sin reseñas en estado "${status}"` }}
      />
    </div>
  )
}
