import { useState } from 'react'
import { MOCK_PAYOUTS } from '../../data/mock'
import { useToast } from '../../components/ui/ToastProvider'
import { PayoutStatusBadge } from '../../components/shared/StatusBadge'
import Modal from '../../components/ui/Modal'

const FREQ_OPTIONS = [
  { title: 'Diario automático', desc: 'Cada día laborable' },
  { title: 'Semanal',           desc: 'Elige el día de la semana' },
  { title: 'Mensual',           desc: 'El primer día del mes' },
  { title: 'Manual',            desc: 'Tú decides cuándo liquidar' },
]

function PayoutConfigModal({ isOpen, onClose }) {
  const toast = useToast()
  const [selected, setSelected] = useState(0)
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="p-6">
        <h2 className="text-lg font-semibold text-ink mb-1">Frecuencia de liquidación</h2>
        <p className="text-sm text-slate mb-5">Configura cuándo quieres recibir tus fondos disponibles.</p>
        <div className="space-y-3 mb-6">
          {FREQ_OPTIONS.map((opt, i) => (
            <label
              key={opt.title}
              className={`flex items-center gap-4 kyc-card cursor-pointer ${selected === i ? 'selected' : ''}`}
              onClick={() => setSelected(i)}
            >
              <input type="radio" name="freq" className="accent-stripe" readOnly checked={selected === i} />
              <div>
                <p className="text-sm font-medium text-ink">{opt.title}</p>
                <p className="text-xs text-slate">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            className="btn-primary flex-1"
            onClick={() => { onClose(); toast.show('Frecuencia actualizada', 'success') }}
          >
            Guardar cambios
          </button>
          <button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </Modal>
  )
}

export default function PayoutsPage() {
  const toast = useToast()
  const [configOpen, setConfigOpen] = useState(false)

  return (
    <div className="fade-up">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Liquidaciones</h1>
          <p className="text-sm text-slate mt-0.5">Gestión de payouts a merchants Connect</p>
        </div>
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="card-flat p-5 fade-up delay-1">
          <p className="text-xs text-slate uppercase tracking-wider font-medium mb-2">Saldo disponible</p>
          <p className="text-2xl font-semibold text-ink mb-2">€ 4.130,50</p>
          <p className="text-xs text-sage-dark font-medium">Listo para liquidar</p>
        </div>
        <div className="card-flat p-5 fade-up delay-2">
          <p className="text-xs text-slate uppercase tracking-wider font-medium mb-2">En tránsito</p>
          <p className="text-2xl font-semibold text-ink mb-2">€ 890,00</p>
          <p className="text-xs text-slate">Disponible en 2 días</p>
        </div>
        <div className="card-flat p-5 fade-up delay-3">
          <p className="text-xs text-slate uppercase tracking-wider font-medium mb-2">Próximo payout auto</p>
          <p className="text-2xl font-semibold text-ink mb-2">13 Abr</p>
          <button
            className="text-xs text-stripe font-medium hover:underline"
            onClick={() => setConfigOpen(true)}
          >
            Cambiar frecuencia →
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card fade-up delay-4">
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <h3 className="font-medium text-ink text-[15px]">Historial de liquidaciones</h3>
          <button
            className="btn-ghost text-xs flex items-center gap-1"
            onClick={() => toast.show('Exportando historial...', 'success')}
          >
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
            Exportar
          </button>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-t border-mist-2">
              {['ID Payout','Merchant','Transacciones','Importe','Estado','Fecha estimada'].map((h) => (
                <th key={h} className="px-6 py-3 text-left text-[10px] font-medium text-slate uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_PAYOUTS.map((po) => (
              <tr key={po.id} className="tr-hover border-t border-mist-2">
                <td className="px-6 py-3.5 font-mono text-xs text-slate">{po.id}</td>
                <td className="px-6 py-3.5 text-sm font-medium text-ink">{po.merchant}</td>
                <td className="px-6 py-3.5 text-sm text-slate">{po.transactions} pagos</td>
                <td className="px-6 py-3.5 text-sm font-semibold text-ink">€ {po.amount.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</td>
                <td className="px-6 py-3.5"><PayoutStatusBadge status={po.status} /></td>
                <td className="px-6 py-3.5 text-xs text-slate">{po.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PayoutConfigModal isOpen={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  )
}
