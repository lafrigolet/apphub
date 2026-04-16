import { useState } from 'react'
import { MOCK_DISPUTES } from '../../data/mock'
import { useToast } from '../../components/ui/ToastProvider'
import Modal from '../../components/ui/Modal'
import ProgressBar from '../../components/ui/ProgressBar'
import Badge from '../../components/ui/Badge'

const REF_DATE = new Date('2025-04-11')

function daysLeft(deadline) {
  return Math.ceil((new Date(deadline) - REF_DATE) / 86400000)
}

const EVIDENCE_SLOTS = [
  { title: 'Descripción del producto/servicio', desc: 'Explica qué se vendió y cuándo se entregó' },
  { title: 'Comunicación con el cliente',        desc: 'Capturas de emails, chats o registros de contacto' },
  { title: 'Prueba de entrega',                  desc: 'Número de seguimiento, firma de recepción, etc.' },
]

function EvidenceModal({ isOpen, onClose }) {
  const toast = useToast()
  const [uploaded, setUploaded] = useState([false, false, false])

  function handleUpload(i) {
    setUploaded((prev) => { const n = [...prev]; n[i] = true; return n })
    toast.show('Archivo adjuntado ✓', 'success')
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="p-6">
        <h2 className="text-lg font-semibold text-ink mb-1">Aportar evidencias</h2>
        <p className="text-sm text-slate mb-5">Sube documentos que demuestren que el cargo fue legítimo.</p>
        <div className="space-y-4 mb-5">
          {EVIDENCE_SLOTS.map((slot, i) => (
            <div key={slot.title}>
              <label className="field-label">{slot.title}</label>
              <p className="text-xs text-slate mb-2">{slot.desc}</p>
              {uploaded[i] ? (
                <div className="border-2 border-sage rounded-lg p-4 text-center">
                  <div className="text-sage-dark font-medium text-sm">✓ Archivo adjunto</div>
                </div>
              ) : (
                <div
                  className="border-2 border-dashed border-mist-2 rounded-lg p-4 text-center cursor-pointer hover:border-stripe transition-colors"
                  onClick={() => handleUpload(i)}
                >
                  <svg className="mx-auto mb-2 text-slate" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                  </svg>
                  <p className="text-xs text-slate">Arrastra o <span className="text-stripe font-medium">selecciona archivo</span></p>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            className="btn-primary flex-1"
            onClick={() => { onClose(); toast.show('Evidencias enviadas a Stripe ✓', 'success') }}
          >
            Enviar evidencias
          </button>
          <button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </Modal>
  )
}

export default function DisputesPage() {
  const toast = useToast()
  const [evidenceDispute, setEvidenceDispute] = useState(null)

  return (
    <div className="fade-up">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Disputas y chargebacks</h1>
          <p className="text-sm text-slate mt-0.5">{MOCK_DISPUTES.length} disputas abiertas requieren atención</p>
        </div>
      </div>

      <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-3 fade-up delay-1">
        <svg className="text-red-500 mt-0.5 flex-shrink-0" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"/>
        </svg>
        <div>
          <p className="text-sm font-semibold text-red-700">{MOCK_DISPUTES.length} disputas requieren respuesta urgente</p>
          <p className="text-xs text-red-600 mt-0.5">El banco del cliente puede fallar a su favor si no se aportan evidencias antes del plazo.</p>
        </div>
      </div>

      <div className="space-y-4">
        {MOCK_DISPUTES.map((d, i) => {
          const days = daysLeft(d.deadline)
          const urgentColor = days <= 3 ? '#DC2626' : '#F59E0B'
          return (
            <div key={d.id} className={`card p-6 fade-up delay-${i + 2}`}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-ink text-[15px]">€ {d.amount.toFixed(2)}</span>
                    <Badge variant="red">{d.status === 'needs_response' ? 'Respuesta requerida' : 'En revisión'}</Badge>
                  </div>
                  <p className="text-sm text-slate">{d.merchant} · {d.reason}</p>
                  <p className="font-mono text-xs text-slate mt-1">Transacción: {d.transaction}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate mb-1">Plazo de respuesta</p>
                  <p className="font-semibold text-ink">{d.deadline}</p>
                  <p className={`text-xs font-medium ${days <= 3 ? 'text-red-500' : 'text-amber-500'}`}>{days} días restantes</p>
                </div>
              </div>

              <ProgressBar fillPercent={Math.max(10, (days / 14) * 100)} color={urgentColor} />
              <div className="mt-4 flex gap-2">
                <button
                  className="btn-primary flex items-center gap-2 text-sm"
                  onClick={() => setEvidenceDispute(d.id)}
                >
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                  </svg>
                  Adjuntar evidencia
                </button>
                <button
                  className="btn-ghost text-sm"
                  onClick={() => toast.show('Disputa aceptada. El importe se deducirá del saldo.', 'info')}
                >
                  Aceptar disputa
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <EvidenceModal isOpen={!!evidenceDispute} onClose={() => setEvidenceDispute(null)} />
    </div>
  )
}
