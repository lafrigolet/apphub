import { useState } from 'react'
import { api } from '../../../shell/lib/api'
import { useFetch, PageHeader, Table } from '../../../shell/lib/list-helpers'

export default function Payouts() {
  const [period, setPeriod] = useState('')
  const [data, { loading, error }] = useFetch(
    () => api.get(`/api/practitioner-payouts/payouts${period ? '?period=' + period : ''}`),
    [period],
  )

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (error)   return <div className="p-10 text-center text-danger">Error: {error}</div>

  const rows = data?.data ?? data ?? []

  return (
    <div className="p-8 max-w-6xl fade-up">
      <PageHeader
        kicker="Comercial"
        title="Pagos a practitioners"
        subtitle="Cierres periódicos. Cada periodo agrega los accruals devengados y se exporta como PDF para soporte contable."
        actions={<input type="month" className="input" value={period} onChange={(e) => setPeriod(e.target.value)} />}
      />
      <Table
        cols={[
          { key: 'practitioner_id', label: 'Practitioner', render: (r) => r.practitioner_id?.slice(0, 8) ?? '—' },
          { key: 'period',          label: 'Periodo' },
          { key: 'amount_cents',    label: 'Importe', render: (r) => `${(r.amount_cents ?? 0) / 100} €` },
          { key: 'status',          label: 'Estado' },
          { key: 'closed_at',       label: 'Cerrado', render: (r) => r.closed_at?.slice(0, 10) ?? '—' },
          { key: 'actions',         label: '', render: (r) => (
            <a href={`/api/practitioner-payouts/payouts/${r.id}/pdf`} target="_blank" rel="noopener" className="text-[12px] text-link hover:underline">PDF</a>
          ) },
        ]}
        rows={rows}
        empty={{ title: 'Sin payouts en el periodo' }}
      />
    </div>
  )
}
