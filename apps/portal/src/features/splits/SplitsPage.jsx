import { useMemo, useState } from 'react'
import { MOCK_SPLIT_RULES } from '../../data/mock'
import { useToast } from '../../components/ui/ToastProvider'
import Modal from '../../components/ui/Modal'
import { calcSplit } from '../../lib/utils'

/* ── Simulator ──────────────────────────────── */
function Simulator({ rules }) {
  const [amount, setAmount]   = useState(100)
  const [ruleId, setRuleId]   = useState(rules[0]?.id ?? 1)
  const rule = rules.find((r) => r.id === ruleId) ?? rules[0]

  const sim = useMemo(() => rule ? calcSplit(amount, rule) : null, [amount, rule])

  return (
    <div className="card p-6 mb-6 fade-up delay-1">
      <h3 className="font-medium text-ink text-[15px] mb-1">Simulador de split en tiempo real</h3>
      <p className="text-xs text-slate mb-5">Introduce un importe y ve cómo se distribuye con la regla activa.</p>
      <div className="grid grid-cols-2 gap-8">
        <div>
          <label className="field-label">Importe del cobro (€)</label>
          <input
            className="input mb-4 text-lg font-medium"
            type="number"
            value={amount}
            onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
            step="10"
            min="1"
          />
          <label className="field-label">Regla a simular</label>
          <select
            className="input"
            value={ruleId}
            onChange={(e) => setRuleId(Number(e.target.value))}
          >
            {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>

        {sim && rule && (
          <div className="bg-mist rounded-xl p-4">
            <p className="text-xs font-medium text-slate uppercase tracking-wider mb-3">
              Distribución para € {amount.toFixed(2)}
            </p>
            <div className="space-y-2.5">
              {[
                { label: 'Bruto cobrado',                        val: `€ ${amount.toFixed(2)}`,    cls: 'font-semibold text-ink' },
                { label: 'Fee Stripe (2.9% + 0.30€)',            val: `- € ${sim.stripeFee.toFixed(2)}`, cls: 'text-slate' },
                { label: 'Neto disponible',                       val: `€ ${sim.net.toFixed(2)}`,   cls: 'font-medium text-ink border-t border-mist-2 pt-2' },
                { label: `→ Merchant (${rule.merchant}%)`,       val: `€ ${sim.merchant.toFixed(2)}`,  cls: 'text-stripe font-semibold' },
                { label: `→ Plataforma (${rule.platform}%)`,     val: `€ ${sim.platform.toFixed(2)}`,  cls: 'text-sage-dark font-medium' },
                ...(rule.affiliate > 0 ? [{ label: `→ Afiliado (${rule.affiliate}%)`, val: `€ ${sim.affiliate.toFixed(2)}`, cls: 'text-ember font-medium' }] : []),
              ].map(({ label, val, cls }) => (
                <div key={label} className={`flex justify-between text-sm ${cls}`}>
                  <span>{label}</span><span>{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Edit modal ─────────────────────────────── */
function SplitRuleModal({ rule, onSave, onClose }) {
  const [name, setName]           = useState(rule?.name ?? '')
  const [merchant, setMerchant]   = useState(rule?.merchant  ?? 80)
  const [platform, setPlatform]   = useState(rule?.platform  ?? 15)
  const [affiliate, setAffiliate] = useState(rule?.affiliate ?? 5)

  const sum   = merchant + platform + affiliate
  const valid = sum === 100

  return (
    <Modal isOpen onClose={onClose}>
      <div className="p-6">
        <h2 className="text-lg font-semibold text-ink mb-5">{rule?.id ? 'Editar plantilla' : 'Nueva plantilla de split'}</h2>

        <label className="field-label">Nombre de la plantilla</label>
        <input className="input mb-5" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Marketplace Premium" />

        <div className="space-y-5 mb-5">
          {[
            { label: 'Merchant',   val: merchant,  set: setMerchant,  color: '#635BFF' },
            { label: 'Plataforma', val: platform,  set: setPlatform,  color: '#00C896' },
            { label: 'Afiliado',   val: affiliate, set: setAffiliate, color: '#FF6B35' },
          ].map(({ label, val, set, color }) => (
            <div key={label}>
              <div className="flex justify-between mb-2">
                <label className="field-label mb-0">{label}</label>
                <span className="text-sm font-semibold" style={{ color }}>{val}%</span>
              </div>
              <input
                type="range" min="0" max="100"
                value={val}
                onChange={(e) => set(Number(e.target.value))}
                style={{ accentColor: color }}
              />
            </div>
          ))}
        </div>

        {!valid && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-xs text-red-700">
            ⚠️ La suma debe ser exactamente 100%. Actualmente: {sum}%
          </div>
        )}
        {valid && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-xs text-green-700">
            ✓ La suma es 100%. Correcto.
          </div>
        )}

        <div className="flex gap-2">
          <button className="btn-primary flex-1" disabled={!valid} onClick={() => onSave({ name, merchant, platform, affiliate })}>
            Guardar
          </button>
          <button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Page ────────────────────────────────────── */
export default function SplitsPage() {
  const toast = useToast()
  const [rules, setRules]     = useState([...MOCK_SPLIT_RULES])
  const [editing, setEditing] = useState(null) // rule obj or {} for new

  function handleSave(data) {
    if (editing.id) {
      setRules((prev) => prev.map((r) => r.id === editing.id ? { ...r, ...data } : r))
      toast.show('Plantilla actualizada ✓', 'success')
    } else {
      setRules((prev) => [...prev, { id: Date.now(), active: true, ...data }])
      toast.show('Nueva plantilla creada ✓', 'success')
    }
    setEditing(null)
  }

  return (
    <div className="fade-up">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Reglas de Split</h1>
          <p className="text-sm text-slate mt-0.5">Configura cómo se distribuye cada cobro entre los beneficiarios</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setEditing({})}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          Nueva plantilla
        </button>
      </div>

      <Simulator rules={rules} />

      <div className="space-y-4">
        {rules.map((r, i) => (
          <div key={r.id} className={`card p-6 fade-up delay-${i + 2}`}>
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full mt-1 ${r.active ? 'bg-sage' : 'bg-slate'}`} />
                <div>
                  <h3 className="font-semibold text-ink text-[15px]">{r.name}</h3>
                  <p className="text-xs text-slate mt-0.5">{r.active ? 'Activa' : 'Desactivada'}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost text-xs" onClick={() => toast.show('Plantilla duplicada', 'success')}>Duplicar</button>
                <button className="btn-secondary text-xs" onClick={() => setEditing(r)}>Editar</button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { l: 'Merchant',  v: r.merchant  + '%', tc: 'text-stripe'   },
                { l: 'Plataforma',v: r.platform  + '%', tc: 'text-sage-dark' },
                { l: 'Afiliado',  v: r.affiliate + '%', tc: 'text-ember'    },
              ].map(({ l, v, tc }) => (
                <div key={l} className="bg-mist rounded-lg p-3 text-center">
                  <p className="text-xs text-slate mb-1">{l}</p>
                  <p className={`text-xl font-semibold ${tc}`}>{v}</p>
                </div>
              ))}
            </div>

            <div className="split-preview">
              <div style={{ width: `${r.merchant}%`,  background: '#635BFF' }} />
              <div style={{ width: `${r.platform}%`,  background: '#00C896' }} />
              <div style={{ width: `${r.affiliate}%`, background: '#FF6B35' }} />
            </div>
          </div>
        ))}
      </div>

      {editing !== null && (
        <SplitRuleModal rule={editing} onSave={handleSave} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
