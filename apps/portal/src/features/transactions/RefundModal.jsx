import { useState } from 'react'
import Modal from '../../components/ui/Modal'

export default function RefundModal({ tx, onClose, onConfirm }) {
  const [type, setType]     = useState('full')
  const [partial, setPartial] = useState('')

  if (!tx) return null

  return (
    <Modal isOpen={!!tx} onClose={onClose}>
      <div className="p-6">
        <h2 className="text-lg font-semibold text-ink mb-1">Emitir reembolso</h2>
        <p className="text-sm text-slate mb-5">Los splits se revertirán proporcionalmente a cada beneficiario.</p>

        <label className="field-label">Tipo de reembolso</label>
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div
            className={`kyc-card ${type === 'full' ? 'selected' : ''}`}
            onClick={() => setType('full')}
          >
            <p className="font-medium text-sm text-ink">Total</p>
            <p className="text-xs text-slate mt-1">€ {tx.amount.toFixed(2)}</p>
          </div>
          <div
            className={`kyc-card ${type === 'partial' ? 'selected' : ''}`}
            onClick={() => setType('partial')}
          >
            <p className="font-medium text-sm text-ink">Parcial</p>
            <p className="text-xs text-slate mt-1">Importe personalizado</p>
          </div>
        </div>

        {type === 'partial' && (
          <div className="mb-5">
            <label className="field-label">Importe a reembolsar</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate text-sm">€</span>
              <input
                className="input pl-7"
                type="number"
                max={tx.amount}
                placeholder="0.00"
                value={partial}
                onChange={(e) => setPartial(e.target.value)}
              />
            </div>
          </div>
        )}

        <label className="field-label">Motivo (opcional)</label>
        <select className="input mb-5">
          <option>Producto dañado</option>
          <option>Error en el pedido</option>
          <option>Solicitud del cliente</option>
          <option>Otro</option>
        </select>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-5 text-xs text-amber-700">
          ⚠️ El plazo estimado de devolución al cliente es de 5–10 días hábiles.
        </div>

        <div className="flex gap-2">
          <button className="btn-danger flex-1" onClick={() => onConfirm(tx.id)}>Confirmar reembolso</button>
          <button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </Modal>
  )
}
