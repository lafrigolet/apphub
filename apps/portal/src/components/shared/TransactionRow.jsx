import { TxStatusBadge } from './StatusBadge'

export default function TransactionRow({ tx, onRowClick, compact = false }) {
  const cell = compact ? 'px-6 py-3.5' : 'px-5 py-3.5'
  return (
    <tr
      className="tr-hover border-t border-mist-2 cursor-pointer"
      onClick={() => onRowClick(tx.id)}
    >
      <td className={`${cell} font-mono text-xs text-${compact ? 'slate' : 'stripe'}`}>{tx.id}</td>
      <td className={`${cell} text-sm font-medium text-ink`}>{tx.merchant}</td>
      <td className={`${cell} text-sm text-slate`}>{tx.method}</td>
      <td className={`${cell} text-sm font-semibold text-ink`} style={{ fontVariantNumeric: 'tabular-nums' }}>
        € {tx.amount.toFixed(2)}
      </td>
      {!compact && (
        <td className={`${cell} text-sm text-sage-dark font-medium`}>€ {tx.split.merchant.toFixed(2)}</td>
      )}
      <td className={`${cell}`}><TxStatusBadge status={tx.status} /></td>
      <td className={`${cell} text-xs text-slate`}>{tx.date}</td>
    </tr>
  )
}
