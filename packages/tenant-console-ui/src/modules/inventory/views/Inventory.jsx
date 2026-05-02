import { useState } from 'react'
import { api } from '../../../shell/lib/api'
import { useApp } from '../../../shell/lib/context'
import { useFetch, PageHeader, Table } from '../../../shell/lib/list-helpers'

export default function Inventory() {
  const { toast } = useApp()
  const [data, { loading, error, refetch }] = useFetch(() => api.get('/api/inventory/?limit=200'))

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (error)   return <div className="p-10 text-center text-danger">Error: {error}</div>

  const rows = data?.data ?? data ?? []

  async function setQty(sku, qty) {
    try { await api.put(`/api/inventory/${encodeURIComponent(sku)}`, { quantity_on_hand: Number(qty) }); toast('Stock actualizado'); refetch() }
    catch (e) { toast(e.message, 'danger') }
  }

  return (
    <div className="p-8 max-w-6xl fade-up">
      <PageHeader kicker="Operaciones" title="Inventario" subtitle="Stock por SKU. Edita la cantidad on-hand directamente; las reservas/commits las gestiona el flujo de pedidos." />
      <Table
        cols={[
          { key: 'sku',                label: 'SKU', render: (r) => <span className="font-mono">{r.sku}</span> },
          { key: 'quantity_on_hand',   label: 'On hand', render: (r) => <SkuEdit sku={r.sku} value={r.quantity_on_hand ?? 0} onSave={setQty} /> },
          { key: 'reserved',           label: 'Reservado', render: (r) => r.quantity_reserved ?? 0 },
          { key: 'available',          label: 'Disponible', render: (r) => (r.quantity_on_hand ?? 0) - (r.quantity_reserved ?? 0) },
          { key: 'updated_at',         label: 'Actualizado', render: (r) => r.updated_at?.slice(0, 10) ?? '—' },
        ]}
        rows={rows}
        empty={{ title: 'Sin SKUs', hint: 'Crea SKUs desde la API o desde el editor de catálogo.' }}
      />
    </div>
  )
}

function SkuEdit({ sku, value, onSave }) {
  const [v, setV] = useState(value)
  const [editing, setEditing] = useState(false)
  if (!editing) return <button onClick={() => setEditing(true)} className="font-mono text-[13px] hover:underline">{value}</button>
  return (
    <span className="inline-flex items-center gap-1">
      <input type="number" className="input w-20 text-[12px] py-1" value={v} onChange={(e) => setV(e.target.value)} />
      <button onClick={() => { onSave(sku, v); setEditing(false) }} className="text-[12px] text-ok hover:underline">OK</button>
      <button onClick={() => { setV(value); setEditing(false) }} className="text-[12px] text-ink3 hover:underline">Cancelar</button>
    </span>
  )
}
