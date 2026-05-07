import { api } from '../../../shell/lib/api'
import { useFetch, PageHeader, Table } from '../../../shell/lib/list-helpers'

export default function Packages() {
  const [data, { loading, error }] = useFetch(() => api.get('/api/packages/templates'))

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (error)   return <div className="p-10 text-center text-danger">Error: {error}</div>

  const rows = data?.data ?? data ?? []

  return (
    <div className="p-8 max-w-6xl fade-up">
      <PageHeader kicker="Comercial" title="Packs (paquetes prepagados)" subtitle="Plantillas de bonos. Las acciones de compra/redención y transfers las ejecuta el portal del cliente; aquí solo se ven las plantillas y auditoría." />
      <Table
        cols={[
          { key: 'name',           label: 'Nombre' },
          { key: 'sessions_total', label: 'Sesiones' },
          { key: 'price_cents',    label: 'Precio', render: (r) => `${(r.price_cents ?? 0) / 100} €` },
          { key: 'expiry_days',    label: 'Validez', render: (r) => r.expiry_days ? `${r.expiry_days} días` : '—' },
          { key: 'auto_renew',     label: 'Auto-renew', render: (r) => r.auto_renew_enabled ? '✓' : '' },
          { key: 'shareable',      label: 'Compartible', render: (r) => r.is_shareable ? '✓' : '' },
        ]}
        rows={rows}
        empty={{ title: 'Sin plantillas' }}
      />
    </div>
  )
}
