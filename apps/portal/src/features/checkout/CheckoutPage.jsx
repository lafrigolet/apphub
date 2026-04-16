import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../components/ui/ToastProvider'
import StepIndicator from '../../components/ui/StepIndicator'
import SplitBar from '../../components/ui/SplitBar'

const STEPS = ['Contacto', 'Pago', 'Confirmación']

const ORDER_ITEMS = [
  { name: 'Kit Tratamiento Capilar Premium', price: 59.00 },
  { name: 'Mascarilla Hidratante x2',         price: 24.00 },
  { name: 'Aceite Esencial Argán',             price: 18.00 },
]

const SPLIT_SEGMENTS = [
  { percent: 80, color: '#635BFF' },
  { percent: 15, color: '#00C896' },
  { percent: 5,  color: '#FF6B35' },
]

/* ── Step 1 ─────────────────────────────────── */
function Step1({ onNext }) {
  const [form, setForm] = useState({ nombre: 'Ana', apellidos: 'García', email: 'ana@email.com', telefono: '+34 611 234 567' })
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  return (
    <div className="card-flat p-6">
      <StepIndicator steps={STEPS} current={1} />
      <h3 className="font-medium text-ink text-[15px] mb-5">Datos de contacto</h3>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="field-label">Nombre</label><input className="input" value={form.nombre} onChange={set('nombre')} /></div>
          <div><label className="field-label">Apellidos</label><input className="input" value={form.apellidos} onChange={set('apellidos')} /></div>
        </div>
        <div><label className="field-label">Email</label><input className="input" type="email" value={form.email} onChange={set('email')} /></div>
        <div><label className="field-label">Teléfono</label><input className="input" type="tel" value={form.telefono} onChange={set('telefono')} /></div>
      </div>
      <button className="btn-primary w-full mt-6" onClick={onNext}>Continuar al pago →</button>
      <p className="text-[10px] text-slate text-center mt-3">Pago seguro con encriptación SSL</p>
    </div>
  )
}

/* ── Step 2 ─────────────────────────────────── */
function Step2({ onNext, onBack }) {
  const [method, setMethod]   = useState('card')
  const [policy, setPolicy]   = useState(false)
  const [loading, setLoading] = useState(false)

  function pay() {
    setLoading(true)
    setTimeout(() => { setLoading(false); onNext() }, 1800)
  }

  return (
    <div className="card-flat p-6">
      <StepIndicator steps={STEPS} current={2} />
      <h3 className="font-medium text-ink text-[15px] mb-5">Método de pago</h3>

      <div className="grid grid-cols-3 gap-2 mb-5">
        {[['💳','Tarjeta','card'],['🍎','Apple Pay','apple'],['G','Google Pay','google']].map(([ic,l,v]) => (
          <button
            key={v}
            onClick={() => setMethod(v)}
            className={`kyc-card text-center py-3 ${method === v ? 'selected' : ''}`}
          >
            <div className="text-lg mb-1">{ic}</div>
            <div className="text-xs font-medium text-ink">{l}</div>
          </button>
        ))}
      </div>

      {method === 'card' && (
        <div>
          <label className="field-label">Número de tarjeta</label>
          <input className="stripe-input mb-3" defaultValue="4242 4242 4242 4242" maxLength={19} />
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div><label className="field-label">Caducidad</label><input className="stripe-input" defaultValue="12/27" /></div>
            <div><label className="field-label">CVC</label><input className="stripe-input" defaultValue="424" /></div>
          </div>
          <div className="bg-mist rounded-lg p-3 text-xs text-slate mb-4 flex items-center gap-2">
            <svg width="12" height="12" fill="none" stroke="#6B7280" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>
            Tarjeta de test: <span className="font-mono font-medium text-ink">4242 4242 4242 4242</span>
          </div>
        </div>
      )}

      <div className="text-xs text-slate mb-4 flex items-start gap-2">
        <input type="checkbox" id="policy" className="mt-0.5 accent-stripe" checked={policy} onChange={(e) => setPolicy(e.target.checked)} />
        <label htmlFor="policy">
          Acepto los <span className="text-stripe">términos de compra</span> y la <span className="text-stripe">política de devolución de 30 días</span> de Casa del Agua Madrid.
        </label>
      </div>

      <button className="btn-primary w-full" onClick={pay} disabled={loading}>
        {loading ? <div className="spinner mx-auto" /> : 'Pagar € 101,00'}
      </button>
      <button className="btn-ghost w-full mt-2 text-sm" onClick={onBack}>← Volver</button>
    </div>
  )
}

/* ── Step 3 ─────────────────────────────────── */
function Step3({ onReset }) {
  const navigate = useNavigate()
  return (
    <div className="card-flat p-6 text-center">
      <div className="w-16 h-16 rounded-full bg-green-50 border-2 border-sage flex items-center justify-center mx-auto mb-5">
        <svg width="28" height="28" fill="none" stroke="#00A07A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <polyline className="checkmark-path" points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h3 className="text-xl font-semibold text-ink mb-2">¡Pago completado!</h3>
      <p className="text-sm text-slate mb-5">Hemos enviado el recibo a <span className="font-medium text-ink">ana@email.com</span></p>
      <div className="bg-mist rounded-xl p-4 text-left mb-5 space-y-2 text-sm">
        {[['Referencia','pi_3Nx_new'],['Importe cobrado','€ 101,00'],['Método','Visa •••• 4242'],['Fecha','11 Abr 2025 · 15:42']].map(([k,v]) => (
          <div key={k} className="flex justify-between"><span className="text-slate">{k}</span><span className="font-medium text-ink">{v}</span></div>
        ))}
      </div>
      <button className="btn-secondary w-full mb-2" onClick={onReset}>Nueva compra de prueba</button>
      <button className="btn-ghost w-full text-sm" onClick={() => navigate('/transactions')}>Ver en transacciones →</button>
    </div>
  )
}

/* ── Page ────────────────────────────────────── */
export default function CheckoutPage() {
  const [step, setStep] = useState(1)

  return (
    <div className="fade-up">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Checkout Demo</h1>
          <p className="text-sm text-slate mt-0.5">Prototipo interactivo del flujo de pago para compradores</p>
        </div>
        <span className="badge badge-yellow">Tarjetas de test Stripe</span>
      </div>

      <div className="grid grid-cols-2 gap-8 max-w-[800px] mx-auto">
        {/* Order summary */}
        <div className="card-flat p-6 fade-up delay-1">
          <h3 className="font-medium text-ink text-[15px] mb-4">Resumen del pedido</h3>
          <div className="space-y-3 mb-5">
            {ORDER_ITEMS.map(({ name, price }) => (
              <div key={name} className="flex items-center justify-between py-2 border-b border-mist-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-stripe-light flex items-center justify-center text-[10px] text-stripe font-semibold">SdA</div>
                  <span className="text-sm text-ink">{name}</span>
                </div>
                <span className="text-sm font-semibold text-ink">€ {price.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1.5 text-sm mb-5">
            <div className="flex justify-between"><span className="text-slate">Subtotal</span><span>€ 101.00</span></div>
            <div className="flex justify-between"><span className="text-slate">Envío</span><span className="text-sage-dark font-medium">Gratis</span></div>
            <div className="flex justify-between font-semibold text-ink pt-2 border-t border-mist-2 mt-2"><span>Total</span><span>€ 101.00</span></div>
          </div>
          <div className="bg-stripe-light rounded-xl p-4">
            <p className="text-xs font-medium text-stripe uppercase tracking-wider mb-3">Distribución del pago</p>
            <div className="space-y-2 text-xs">
              {[['Casa del Agua Madrid','80%','€ 78.87'],['Plataforma SplitPay','15%','€ 14.79'],['Afiliado','5%','€ 4.93']].map(([l,p,a]) => (
                <div key={l} className="flex justify-between">
                  <span className="text-slate">{l} <span className="text-stripe">({p})</span></span>
                  <span className="font-medium text-ink">{a}</span>
                </div>
              ))}
            </div>
            <div className="mt-3"><SplitBar segments={SPLIT_SEGMENTS} /></div>
          </div>
        </div>

        {/* Form area */}
        <div className="fade-up delay-2">
          {step === 1 && <Step1 onNext={() => setStep(2)} />}
          {step === 2 && <Step2 onNext={() => setStep(3)} onBack={() => setStep(1)} />}
          {step === 3 && <Step3 onReset={() => setStep(1)} />}
        </div>
      </div>
    </div>
  )
}
