import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MOCK_MERCHANTS, MOCK_TRANSACTIONS } from '../../data/mock'
import { useToast } from '../../components/ui/ToastProvider'
import { MerchantStatusBadge, TxStatusBadge } from '../../components/shared/StatusBadge'
import Modal from '../../components/ui/Modal'
import { avatarInitials } from '../../lib/utils'

/* ── Merchant detail modal ──────────────────── */
function MerchantDetailModal({ merchant, transactions, onClose }) {
  const navigate  = useNavigate()
  const relatedTx = transactions.filter((t) => t.merchant === merchant?.name).slice(0, 3)

  return (
    <Modal isOpen={!!merchant} onClose={onClose}>
      {merchant && (
        <div className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-xl bg-stripe-light flex items-center justify-center text-base font-semibold text-stripe">
              {avatarInitials(merchant.name)}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ink">{merchant.name}</h2>
              <p className="font-mono text-xs text-slate mt-0.5">{merchant.id}</p>
            </div>
            <div className="ml-auto"><MerchantStatusBadge status={merchant.status} /></div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-5">
            {[
              ['Saldo disponible', `€ ${merchant.balance.toFixed(2)}`],
              ['Volumen total',    `€ ${merchant.volume.toLocaleString()}`],
              ['Regla split',      merchant.rule],
              ['Alta en plataforma', merchant.joined],
            ].map(([k, v]) => (
              <div key={k} className="bg-mist rounded-lg p-3">
                <p className="text-xs text-slate mb-1">{k}</p>
                <p className="font-semibold text-ink text-sm">{v}</p>
              </div>
            ))}
          </div>

          <p className="text-xs font-medium text-slate uppercase tracking-wider mb-3">Últimas transacciones</p>
          {relatedTx.length > 0 ? relatedTx.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between py-2 border-b border-mist-2 text-sm">
              <span className="font-mono text-xs text-slate">{tx.id}</span>
              <span className="font-semibold text-ink">€ {tx.amount.toFixed(2)}</span>
              <TxStatusBadge status={tx.status} />
            </div>
          )) : <p className="text-sm text-slate">Sin transacciones aún.</p>}

          <div className="flex gap-2 mt-5">
            <button className="btn-primary flex-1 text-sm" onClick={() => { onClose(); navigate('/payouts') }}>
              Ver liquidaciones
            </button>
            <button className="btn-secondary flex-1 text-sm" onClick={onClose}>Cerrar</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

/* ── Page ────────────────────────────────────── */
export default function MerchantsPage() {
  const toast   = useToast()
  const navigate = useNavigate()
  const [merchants, setMerchants]       = useState([...MOCK_MERCHANTS])
  const [search, setSearch]             = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedId, setSelectedId]     = useState(null)

  const filtered = useMemo(() =>
    merchants.filter((m) => {
      const q = search.toLowerCase()
      return (
        (!q || m.name.toLowerCase().includes(q) || m.id.includes(q)) &&
        (!statusFilter || m.status === statusFilter)
      )
    }),
    [merchants, search, statusFilter],
  )

  const selectedMerchant = merchants.find((m) => m.id === selectedId) ?? null

  function toggleActive(m) {
    if (m.status === 'active') {
      setMerchants((prev) => prev.map((x) => x.id === m.id ? { ...x, status: 'restricted' } : x))
      toast.show(`Cuenta ${m.name} bloqueada`, 'info')
    } else {
      setMerchants((prev) => prev.map((x) => x.id === m.id ? { ...x, status: 'active' } : x))
      toast.show(`Cuenta ${m.name} activada`, 'success')
    }
  }

  return (
    <div className="fade-up">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Merchants Connect</h1>
          <p className="text-sm text-slate mt-0.5">{merchants.length} cuentas registradas</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => navigate('/onboarding')}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          Nuevo merchant
        </button>
      </div>

      <div className="card fade-up delay-1">
        <div className="px-6 py-4 border-b border-mist-2 flex gap-3">
          <input
            className="input w-64"
            placeholder="Buscar merchant..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Todos</option>
            <option value="active">active</option>
            <option value="pending">pending</option>
            <option value="restricted">restricted</option>
          </select>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-mist-2">
              {['Merchant','ID Stripe','Estado','Regla de Split','Saldo','Volumen total','Acciones'].map((h) => (
                <th key={h} className="px-6 py-3 text-left text-[10px] font-medium text-slate uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.id} className="tr-hover border-t border-mist-2">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-stripe-light flex items-center justify-center text-xs font-semibold text-stripe">
                      {avatarInitials(m.name)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-ink">{m.name}</p>
                      <p className="text-xs text-slate">Desde {m.joined}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate">{m.id}</td>
                <td className="px-6 py-4"><MerchantStatusBadge status={m.status} /></td>
                <td className="px-6 py-4 text-sm text-slate">{m.rule}</td>
                <td className="px-6 py-4 text-sm font-semibold text-ink">€ {m.balance.toFixed(2)}</td>
                <td className="px-6 py-4 text-sm text-slate">€ {m.volume.toLocaleString()}</td>
                <td className="px-6 py-4">
                  <div className="flex gap-1">
                    <button className="btn-ghost text-xs py-1 px-2" onClick={() => setSelectedId(m.id)}>Ver ficha</button>
                    {m.status === 'active'
                      ? <button className="btn-ghost text-xs py-1 px-2 text-red-500" onClick={() => toggleActive(m)}>Bloquear</button>
                      : <button className="btn-ghost text-xs py-1 px-2 text-sage-dark" onClick={() => toggleActive(m)}>Activar</button>
                    }
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <MerchantDetailModal
        merchant={selectedMerchant}
        transactions={MOCK_TRANSACTIONS}
        onClose={() => setSelectedId(null)}
      />
    </div>
  )
}
