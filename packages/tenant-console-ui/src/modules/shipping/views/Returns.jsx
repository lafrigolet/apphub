import { useState } from 'react'
import { api } from '../../../shell/lib/api'
import { useApp } from '../../../shell/lib/context'
import { useFetch, PageHeader, Table } from '../../../shell/lib/list-helpers'

export default function Returns() {
  const { toast } = useApp()
  const [tab, setTab] = useState('returns')
  const [returns, returnsState] = useFetch(() => api.get('/api/shipping/returns?limit=100'))
  const [zones, zonesState]     = useFetch(() => api.get('/api/shipping/zones'))

  const returnRows = returns?.data ?? returns ?? []
  const zoneRows   = zones?.data ?? zones ?? []

  async function approve(id) {
    try { await api.post(`/api/shipping/returns/${id}/approve`); toast('Devolución aprobada'); returnsState.refetch() }
    catch (e) { toast(e.message, 'danger') }
  }

  return (
    <div className="p-8 max-w-7xl fade-up">
      <PageHeader kicker="Operaciones" title="Envíos y devoluciones" subtitle="Gestión de RMA y zonas/tarifas. El tracking de shipments se consume vía webhook desde el carrier." />
      <div className="flex gap-2 mb-5">
        <button onClick={() => setTab('returns')} className={`px-3 py-1.5 rounded-lg text-[13px] ${tab === 'returns' ? 'bg-ink text-white' : 'bg-paper2 text-ink2'}`}>Devoluciones</button>
        <button onClick={() => setTab('zones')}   className={`px-3 py-1.5 rounded-lg text-[13px] ${tab === 'zones'   ? 'bg-ink text-white' : 'bg-paper2 text-ink2'}`}>Zonas y tarifas</button>
      </div>
      {tab === 'returns' && (
        returnsState.loading ? <div className="text-ink3">Cargando…</div>
        : returnsState.error ? <div className="text-danger">Error: {returnsState.error}</div>
        : <Table
            cols={[
              { key: 'id',        label: 'RMA',     render: (r) => <span className="font-mono text-[11px]">{r.id?.slice(0, 8)}</span> },
              { key: 'order_id',  label: 'Pedido',  render: (r) => r.order_id?.slice(0, 8) ?? '—' },
              { key: 'reason',    label: 'Motivo' },
              { key: 'status',    label: 'Estado' },
              { key: 'created',   label: 'Solicitada', render: (r) => r.created_at?.slice(0, 10) },
              { key: 'actions',   label: '', render: (r) => r.status === 'requested'
                ? <button onClick={() => approve(r.id)} className="text-[12px] text-ok hover:underline">Aprobar</button>
                : null },
            ]}
            rows={returnRows}
            empty={{ title: 'Sin devoluciones' }}
          />
      )}
      {tab === 'zones' && (
        zonesState.loading ? <div className="text-ink3">Cargando…</div>
        : zonesState.error ? <div className="text-danger">Error: {zonesState.error}</div>
        : <Table
            cols={[
              { key: 'name',       label: 'Zona' },
              { key: 'countries',  label: 'Países', render: (r) => (r.countries ?? []).join(', ') },
            ]}
            rows={zoneRows}
            empty={{ title: 'Sin zonas configuradas' }}
          />
      )}
    </div>
  )
}
