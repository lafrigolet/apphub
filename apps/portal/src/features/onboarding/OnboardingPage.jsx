import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../components/ui/ToastProvider'
import StepIndicator from '../../components/ui/StepIndicator'

const STEPS = ['Tipo de cuenta', 'Datos fiscales', 'Cuenta bancaria', 'Verificación', 'Activación']

/* ── Step 1 ─────────────────────────────────── */
function Step1({ onNext }) {
  const [selected, setSelected] = useState('business')
  const TYPES = [
    { value: 'business',    title: 'Empresa (S.L., S.A.)',              desc: 'Persona jurídica con CIF' },
    { value: 'individual',  title: 'Autónomo / Freelance',              desc: 'Persona física con NIF' },
    { value: 'nonprofit',   title: 'Asociación sin ánimo de lucro',     desc: 'ONGs, asociaciones, fundaciones' },
  ]
  return (
    <>
      <h3 className="font-semibold text-ink text-[15px] mb-1">Tipo de cuenta</h3>
      <p className="text-sm text-slate mb-5">¿Cómo opera tu negocio?</p>
      <div className="space-y-3 mb-6">
        {TYPES.map((t) => (
          <div
            key={t.value}
            className={`kyc-card ${selected === t.value ? 'selected' : ''}`}
            onClick={() => setSelected(t.value)}
          >
            <p className="font-medium text-sm text-ink">{t.title}</p>
            <p className="text-xs text-slate mt-0.5">{t.desc}</p>
          </div>
        ))}
      </div>
      <button className="btn-primary w-full" onClick={onNext}>Continuar →</button>
    </>
  )
}

/* ── Step 2 ─────────────────────────────────── */
function Step2({ onNext, onBack }) {
  return (
    <>
      <h3 className="font-semibold text-ink text-[15px] mb-1">Datos fiscales y de contacto</h3>
      <p className="text-sm text-slate mb-5">Requeridos por Stripe para verificación KYC.</p>
      <div className="space-y-4 mb-6">
        <div><label className="field-label">Nombre o razón social</label><input className="input" defaultValue="Wellness Center Valencia S.L." /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="field-label">CIF / NIF</label><input className="input" defaultValue="B12345678" /></div>
          <div>
            <label className="field-label">País</label>
            <select className="input"><option>España</option><option>Francia</option><option>Italia</option></select>
          </div>
        </div>
        <div><label className="field-label">Dirección</label><input className="input" defaultValue="Calle Gran Vía 45, Valencia" /></div>
        <div><label className="field-label">Email de contacto</label><input className="input" type="email" defaultValue="hola@wellnesscenter.es" /></div>
        <div><label className="field-label">Sitio web (opcional)</label><input className="input" placeholder="https://" /></div>
      </div>
      <div className="flex gap-2">
        <button className="btn-secondary flex-1" onClick={onBack}>← Atrás</button>
        <button className="btn-primary flex-1" onClick={onNext}>Continuar →</button>
      </div>
    </>
  )
}

/* ── Step 3 ─────────────────────────────────── */
function Step3({ onNext, onBack }) {
  return (
    <>
      <h3 className="font-semibold text-ink text-[15px] mb-1">Cuenta bancaria</h3>
      <p className="text-sm text-slate mb-5">Aquí recibirás tus liquidaciones.</p>
      <div className="space-y-4 mb-6">
        <div><label className="field-label">Titular de la cuenta</label><input className="input" defaultValue="Wellness Center Valencia S.L." /></div>
        <div><label className="field-label">IBAN</label><input className="input font-mono" defaultValue="ES91 2100 0418 4502 0005 1332" /></div>
        <div>
          <label className="field-label">Frecuencia de payout</label>
          <select className="input">
            <option>Diario automático</option>
            <option>Semanal (lunes)</option>
            <option>Mensual</option>
            <option>Manual</option>
          </select>
        </div>
      </div>
      <div className="bg-mist rounded-lg p-3 mb-5 text-xs text-slate flex items-start gap-2">
        <svg width="12" height="12" className="mt-0.5 flex-shrink-0" fill="none" stroke="#6B7280" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        El IBAN se validará automáticamente mediante un micro-depósito de prueba en 1–2 días hábiles.
      </div>
      <div className="flex gap-2">
        <button className="btn-secondary flex-1" onClick={onBack}>← Atrás</button>
        <button className="btn-primary flex-1" onClick={onNext}>Continuar →</button>
      </div>
    </>
  )
}

/* ── Step 4 ─────────────────────────────────── */
function Step4({ onNext, onBack }) {
  const toast = useToast()
  const [uploaded, setUploaded] = useState([false, false])
  const SLOTS = [
    { title: 'DNI / NIE (anverso)', desc: 'Sube una foto clara del frente del documento' },
    { title: 'DNI / NIE (reverso)', desc: 'Foto del reverso del documento' },
  ]
  function upload(i) {
    setUploaded((prev) => { const n = [...prev]; n[i] = true; return n })
    toast.show('Documento adjuntado ✓', 'success')
  }
  return (
    <>
      <h3 className="font-semibold text-ink text-[15px] mb-1">Verificación de identidad</h3>
      <p className="text-sm text-slate mb-5">Requerida por la normativa PSD2 y KYC de Stripe.</p>
      <div className="space-y-3 mb-6">
        {SLOTS.map((slot, i) => (
          <div key={slot.title}>
            <label className="field-label">{slot.title}</label>
            {uploaded[i] ? (
              <div className="border-2 border-sage rounded-lg p-5 text-center">
                <div className="text-sage-dark font-medium text-sm">✓ Archivo adjunto</div>
              </div>
            ) : (
              <div
                className="border-2 border-dashed border-mist-2 rounded-lg p-5 text-center cursor-pointer hover:border-stripe transition-colors"
                onClick={() => upload(i)}
              >
                <svg className="mx-auto mb-2 text-slate" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                </svg>
                <p className="text-xs text-slate">{slot.desc}</p>
                <p className="text-[10px] text-slate mt-1">PDF, JPG, PNG · máx 10 MB</p>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button className="btn-secondary flex-1" onClick={onBack}>← Atrás</button>
        <button className="btn-primary flex-1" onClick={onNext}>Enviar para revisión →</button>
      </div>
    </>
  )
}

/* ── Step 5 ─────────────────────────────────── */
function Step5({ onReset }) {
  const navigate = useNavigate()
  const STATUS_ROWS = [
    { label: 'Estado KYC',              val: 'En revisión',            variant: 'badge-yellow' },
    { label: 'Capacidad de cobros',     val: 'Pendiente de activación', variant: 'badge-gray'   },
    { label: 'Capacidad de payouts',    val: 'Pendiente de activación', variant: 'badge-gray'   },
  ]
  return (
    <div className="text-center py-4">
      <div className="w-16 h-16 rounded-full bg-stripe-light flex items-center justify-center mx-auto mb-5">
        <svg width="28" height="28" fill="none" stroke="#635BFF" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <h3 className="text-xl font-semibold text-ink mb-2">Solicitud enviada</h3>
      <p className="text-sm text-slate mb-5 max-w-[320px] mx-auto">
        Stripe revisará tu información en un plazo de <strong>1–2 días hábiles</strong>. Te notificaremos por email cuando la cuenta esté activa.
      </p>
      <div className="bg-mist rounded-xl p-4 text-left mb-6 space-y-3">
        {STATUS_ROWS.map(({ label, val, variant }) => (
          <div key={label} className="flex justify-between items-center text-sm">
            <span className="text-slate">{label}</span>
            <span className={`badge ${variant}`}>{val}</span>
          </div>
        ))}
      </div>
      <button className="btn-primary w-full mb-2" onClick={() => navigate('/merchants')}>Ver listado de merchants</button>
      <button className="btn-ghost w-full text-sm" onClick={onReset}>Nuevo onboarding de prueba</button>
    </div>
  )
}

/* ── Page ────────────────────────────────────── */
export default function OnboardingPage() {
  const [step, setStep] = useState(1)

  return (
    <div className="fade-up max-w-[640px] mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-ink mb-1">Onboarding KYC</h1>
        <p className="text-sm text-slate">Activación de cuenta Stripe Connect · Nuevo merchant</p>
      </div>

      <StepIndicator steps={STEPS} current={step} />

      <div className="card-flat p-6 fade-up delay-1">
        {step === 1 && <Step1 onNext={() => setStep(2)} />}
        {step === 2 && <Step2 onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && <Step3 onNext={() => setStep(4)} onBack={() => setStep(2)} />}
        {step === 4 && <Step4 onNext={() => setStep(5)} onBack={() => setStep(3)} />}
        {step === 5 && <Step5 onReset={() => setStep(1)} />}
      </div>
    </div>
  )
}
