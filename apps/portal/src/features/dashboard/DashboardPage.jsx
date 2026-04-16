import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MOCK_TRANSACTIONS } from '../../data/mock'
import TransactionRow from '../../components/shared/TransactionRow'
import TransactionDetailModal from '../transactions/TransactionDetailModal'
import RefundModal from '../transactions/RefundModal'

const CHART_BARS = [40,65,50,80,70,90,60,85,72,95,68,88]
const CHART_LABELS = ['Ab','Ab','Ab','Ab','Ab','Ab','Ab','Ab','Ab','Ab','Ab','Hoy']

const METRICS = [
  { label: 'Volumen hoy',     value: '€ 4.218', delta: '+12%',     up: true  },
  { label: 'Transacciones',   value: '38',       delta: '+4',       up: true  },
  { label: 'Tasa de éxito',   value: '97.3%',    delta: '+0.4%',    up: true  },
  { label: 'Saldo disponible', value: '€ 4.130', delta: 'liquidar', up: null  },
]

const INCOME_ROWS = [
  { label: 'Merchants',  pct: 80, color: '#635BFF', amount: '€3.374' },
  { label: 'Plataforma', pct: 15, color: '#00C896', amount: '€633'   },
  { label: 'Afiliados',  pct: 5,  color: '#FF6B35', amount: '€211'   },
]

export default function DashboardPage() {
  const [transactions, setTransactions] = useState([...MOCK_TRANSACTIONS])
  const [selectedTxId, setSelectedTxId] = useState(null)
  const [refundTxId, setRefundTxId]     = useState(null)

  function handleRefund(txId) {
    setTransactions((prev) =>
      prev.map((tx) => (tx.id === txId ? { ...tx, status: 'refunded' } : tx)),
    )
  }

  const selectedTx = transactions.find((t) => t.id === selectedTxId) ?? null
  const refundTx   = transactions.find((t) => t.id === refundTxId)   ?? null

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Dashboard</h1>
          <p className="text-sm text-slate mt-0.5">Hoy, 11 de abril de 2025 · Modo sandbox</p>
        </div>
        <Link to="/checkout" className="btn-primary flex items-center gap-2">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          Nuevo cobro
        </Link>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {METRICS.map((m, i) => (
          <div key={m.label} className={`card-flat p-5 fade-up delay-${i + 1}`}>
            <p className="text-xs text-slate uppercase tracking-wider font-medium mb-3">{m.label}</p>
            <p className="text-2xl font-semibold text-ink mb-1" style={{ fontVariantNumeric: 'tabular-nums' }}>{m.value}</p>
            {m.up !== null ? (
              <span className={`text-xs font-medium ${m.up ? 'text-sage-dark' : 'text-ember'}`}>
                {m.up ? '↑' : '↓'} {m.delta} vs ayer
              </span>
            ) : (
              <Link to="/payouts" className="text-xs text-stripe font-medium hover:underline">
                Ver {m.delta} →
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* Chart + income breakdown */}
      <div className="grid grid-cols-3 gap-6 mb-8">
        {/* Bar chart */}
        <div className="col-span-2 card p-6 fade-up delay-3">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-medium text-ink text-[15px]">Volumen de cobros</h3>
              <p className="text-xs text-slate mt-0.5">Últimos 12 días</p>
            </div>
            <span className="badge badge-blue">Sandbox</span>
          </div>
          <div className="flex items-end gap-2 h-[100px]">
            {CHART_BARS.map((h, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <div
                  className={`bar w-6 ${i === 11 ? 'bg-stripe' : 'bg-mist-2'}`}
                  style={{ height: h }}
                  title={`${h * 12}€`}
                />
                <span className="text-[9px] text-slate">{CHART_LABELS[i]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Income breakdown */}
        <div className="card p-6 fade-up delay-4">
          <h3 className="font-medium text-ink text-[15px] mb-4">Distribución de ingresos</h3>
          <div className="space-y-3">
            {INCOME_ROWS.map((r) => (
              <div key={r.label}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-slate">{r.label}</span>
                  <span className="font-medium text-ink">{r.amount} <span className="text-slate">({r.pct}%)</span></span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${r.pct}%`, background: r.color }} />
                </div>
              </div>
            ))}
          </div>
          <div className="divider my-4" />
          <p className="text-xs text-slate">Basado en la regla <span className="font-medium text-ink">Marketplace Estándar</span></p>
        </div>
      </div>

      {/* Recent transactions */}
      <div className="card fade-up delay-5">
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <h3 className="font-medium text-ink text-[15px]">Transacciones recientes</h3>
          <Link to="/transactions" className="text-xs text-stripe font-medium hover:underline">Ver todas →</Link>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-t border-mist-2">
              {['ID','Merchant','Método','Importe','Estado','Fecha'].map((h) => (
                <th key={h} className="px-6 py-3 text-left text-[10px] font-medium text-slate uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transactions.slice(0, 4).map((tx) => (
              <TransactionRow key={tx.id} tx={tx} onRowClick={setSelectedTxId} compact />
            ))}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      <TransactionDetailModal
        tx={selectedTx}
        onClose={() => setSelectedTxId(null)}
        onRefund={(id) => { setSelectedTxId(null); setRefundTxId(id) }}
      />
      <RefundModal
        tx={refundTx}
        onClose={() => setRefundTxId(null)}
        onConfirm={(id) => { handleRefund(id); setRefundTxId(null) }}
      />
    </div>
  )
}
