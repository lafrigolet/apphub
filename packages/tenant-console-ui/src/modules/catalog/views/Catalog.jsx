import { useState } from 'react'
import { api } from '../../../shell/lib/api'
import { useApp } from '../../../shell/lib/context'
import { useFetch, PageHeader, Table } from '../../../shell/lib/list-helpers'
import { icons } from '../../../shell/lib/icons'

export default function Catalog() {
  const { toast } = useApp()
  const [data, { loading, error, refetch }] = useFetch(() => api.get('/api/catalog/items?limit=200'))

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (error)   return <div className="p-10 text-center text-danger">Error: {error}</div>

  const rows = data?.data ?? data ?? []

  async function setStatus(id, status) {
    try { await api.patch(`/api/catalog/items/${id}/status`, { status }); toast(`Item ${status}`); refetch() }
    catch (e) { toast(e.message, 'danger') }
  }

  return (
    <div className="p-8 max-w-7xl fade-up">
      <PageHeader
        kicker="Negocio"
        title="Catálogo"
        subtitle="Items publicados en la app. Importa/exporta CSV; cambia el status para retirar un item de la vidriera."
        actions={
          <div className="flex items-center gap-2">
            <a href="/api/catalog/items/export.csv" target="_blank" rel="noopener" className="btn btn-ghost">{icons.download}Export CSV</a>
          </div>
        }
      />
      <Table
        cols={[
          { key: 'sku',       label: 'SKU', render: (r) => <span className="font-mono text-[12px]">{r.sku}</span> },
          { key: 'title',     label: 'Título' },
          { key: 'price',     label: 'Precio', render: (r) => `${(r.price_cents ?? 0) / 100} €` },
          { key: 'status',    label: 'Estado' },
          { key: 'updated',   label: 'Actualizado', render: (r) => r.updated_at?.slice(0, 10) },
          { key: 'actions',   label: '', render: (r) => (
            <select className="select text-[12px]" value={r.status} onChange={(e) => setStatus(r.id, e.target.value)} onClick={(e) => e.stopPropagation()}>
              <option value="draft">draft</option>
              <option value="published">published</option>
              <option value="archived">archived</option>
            </select>
          ) },
        ]}
        rows={rows}
        empty={{ title: 'Sin items' }}
      />
    </div>
  )
}
