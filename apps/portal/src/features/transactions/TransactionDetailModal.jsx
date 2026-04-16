import Modal from '../../components/ui/Modal'
import SplitBar from '../../components/ui/SplitBar'
import { TxStatusBadge } from '../../components/shared/StatusBadge'

const SPLIT_COLORS = {
  merchant:  '#635BFF',
  platform:  '#00C896',
  affiliate: '#FF6B35',
  stripe:    '#9CA3AF',
}

export default function TransactionDetailModal({ tx, onClose, onRefund }) {
  if (!tx) return null

  const splitRows = [
    { label: 'Merchant recibe',     amt: tx.split.merchant,  textColor: 'text-sage-dark', dot: 'bg-sage'   },
    { label: 'Comisión plataforma', amt: tx.split.platform,  textColor: 'text-stripe',    dot: 'bg-stripe' },
    { label: 'Comisión afiliado',   amt: tx.split.affiliate, textColor: 'text-ember',     dot: 'bg-ember'  },
    { label: 'Fee Stripe',          amt: tx.split.stripe,    textColor: 'text-slate',     dot: 'bg-slate'  },
  ].filter((r) => r.amt > 0)

  const barSegments = [
    { percent: (tx.split.merchant  / tx.amount) * 100, color: SPLIT_COLORS.merchant  },
    { percent: (tx.split.platform  / tx.amount) * 100, color: SPLIT_COLORS.platform  },
    { percent: (tx.split.affiliate / tx.amount) * 100, color: SPLIT_COLORS.affiliate },
    { percent: (tx.split.stripe    / tx.amount) * 100, color: SPLIT_COLORS.stripe    },
  ]

  return (
    <Modal isOpen={!!tx} onClose={onClose}>
      <div className="p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="text-[10px] font-medium text-slate uppercase tracking-wider mb-1">Detalle de transacción</p>
            <h2 className="text-xl font-semibold text-ink">€ {tx.amount.toFixed(2)}</h2>
            <p className="font-mono text-xs text-slate mt-1">{tx.id}</p>
          </div>
          <TxStatusBadge status={tx.status} />
        </div>

        <div className="bg-mist rounded-xl p-4 mb-5 space-y-2.5">
          {[['Merchant', tx.merchant], ['Método de pago', tx.method], ['Fecha', tx.date]].map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm">
              <span className="text-slate">{k}</span>
              <span className="font-medium text-ink">{v}</span>
            </div>
          ))}
        </div>

        <p className="text-xs font-medium text-slate uppercase tracking-wider mb-3">Desglose del split</p>
        <div className="space-y-2 mb-5">
          {splitRows.map(({ label, amt, textColor, dot }) => (
            <div key={label} className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${dot}`} style={{ opacity: 0.7 }} />
              <span className="text-sm text-slate flex-1">{label}</span>
              <span className={`text-sm font-semibold ${textColor}`}>€ {amt.toFixed(2)}</span>
              <span className="text-xs text-slate w-10 text-right">{((amt / tx.amount) * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>

        <SplitBar segments={barSegments} />

        <div className="divider my-5" />
        {tx.status === 'succeeded' ? (
          <div className="flex gap-2">
            <button className="btn-danger flex-1" onClick={() => onRefund(tx.id)}>Emitir reembolso</button>
            <button className="btn-secondary flex-1" onClick={onClose}>Cerrar</button>
          </div>
        ) : (
          <button className="btn-secondary w-full" onClick={onClose}>Cerrar</button>
        )}
      </div>
    </Modal>
  )
}
