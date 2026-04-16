import { useMemo, useState } from 'react'
import { MOCK_TRANSACTIONS } from '../../data/mock'
import { useToast } from '../../components/ui/ToastProvider'
import TransactionRow from '../../components/shared/TransactionRow'
import TransactionDetailModal from './TransactionDetailModal'
import RefundModal from './RefundModal'

export default function TransactionsPage() {
  const toast = useToast()
  const [transactions, setTransactions] = useState([...MOCK_TRANSACTIONS])
  const [search, setSearch]             = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedTxId, setSelectedTxId] = useState(null)
  const [refundTxId, setRefundTxId]     = useState(null)

  const filtered = useMemo(() =>
    transactions.filter((tx) => {
      const q = search.toLowerCase()
      return (
        (!q || tx.id.includes(q) || tx.merchant.toLowerCase().includes(q)) &&
        (!statusFilter || tx.status === statusFilter)
      )
    }),
    [transactions, search, statusFilter],
  )

  function handleRefund(txId) {
    setTransactions((prev) =>
      prev.map((tx) => (tx.id === txId ? { ...tx, status: 'refunded' } : tx)),
    )
    setRefundTxId(null)
    toast.show('Reembolso procesado correctamente', 'success')
  }

  const selectedTx = transactions.find((t) => t.id === selectedTxId) ?? null
  const refundTx   = transactions.find((t) => t.id === refundTxId)   ?? null

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Transacciones</h1>
          <p className="text-sm text-slate mt-0.5">{transactions.length} transacciones encontradas</p>
        </div>
        <button
          className="btn-secondary flex items-center gap-2"
          onClick={() => toast.show('Exportando CSV...', 'success')}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
          </svg>
          Exportar CSV
        </button>
      </div>

      {/* Filters */}
      <div className="card-flat p-4 mb-6 flex gap-3 flex-wrap">
        <input
          className="input w-48"
          placeholder="Buscar por ID o merchant…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="succeeded">succeeded</option>
          <option value="refunded">refunded</option>
          <option value="processing">processing</option>
          <option value="failed">failed</option>
        </select>
        <select className="input w-40">
          <option>Últimos 7 días</option>
          <option>Último mes</option>
          <option>Rango personalizado</option>
        </select>
      </div>

      {/* Table */}
      <div className="card">
        <table className="w-full">
          <thead>
            <tr className="border-b border-mist-2">
              {['ID Transacción','Merchant','Método de pago','Importe','Split neto merchant','Estado','Fecha'].map((h) => (
                <th key={h} className="px-5 py-3 text-left text-[10px] font-medium text-slate uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} onRowClick={setSelectedTxId} />
            ))}
          </tbody>
        </table>
      </div>

      <TransactionDetailModal
        tx={selectedTx}
        onClose={() => setSelectedTxId(null)}
        onRefund={(id) => { setSelectedTxId(null); setRefundTxId(id) }}
      />
      <RefundModal
        tx={refundTx}
        onClose={() => setRefundTxId(null)}
        onConfirm={handleRefund}
      />
    </div>
  )
}
