// Reusable Splitpay configuration panels shared by:
//   - views/tenant/Splitpay.jsx (owner/admin acting on their own tenant)
//   - views/staff/TenantDetail.jsx → TabStripe (staff impersonating a tenant)
//
// The `scopeQuery` prop is appended to API URLs so staff can pass
// ?appId=&tenantId= to target a specific tenant. For tenant-side use it stays
// empty and the backend uses the JWT's tenant.

import { useEffect, useState } from 'react'
import { api } from '../../shell/lib/api'
import { icons } from '../../shell/lib/icons'

function StatusPill({ status }) {
  const color =
    status === 'active'     ? 'bg-okbg text-ok border-ok/30' :
    status === 'restricted' ? 'bg-warnbg text-warn border-warn/30' :
    status === 'pending'    ? 'bg-paper2 text-ink2 border-line' :
                              'bg-paper2 text-ink3 border-line'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${color}`}>
      {status ?? 'no conectado'}
    </span>
  )
}

export function CuentaPanel({ scopeQuery = '', onToast }) {
  const [accounts, setAccounts]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [creating, setCreating]   = useState(false)
  const [email, setEmail]         = useState('')
  const [country, setCountry]     = useState('ES')
  const [error, setError]         = useState(null)

  function reload() {
    setLoading(true)
    api.get(`/api/splitpay/connect-accounts${scopeQuery}`)
      .then((res) => setAccounts(Array.isArray(res) ? res : (res?.data ?? [])))
      .catch(() => setAccounts([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [scopeQuery])

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    try {
      const res = await api.post(`/api/splitpay/connect-accounts${scopeQuery}`, {
        email,
        country,
        returnUrl:  window.location.href,
        refreshUrl: window.location.href,
      })
      const url = res?.onboardingUrl ?? res?.data?.onboardingUrl
      if (url) {
        onToast?.('Abriendo onboarding de Stripe en una pestaña nueva')
        window.open(url, '_blank', 'noopener,noreferrer')
      } else {
        onToast?.('Cuenta creada')
      }
      setCreating(false); setEmail('')
      reload()
    } catch (err) {
      setError(err.message ?? 'No se pudo crear la cuenta')
    }
  }

  if (loading) return <div className="p-10 text-center text-ink3">Cargando cuenta…</div>

  if (accounts.length === 0) {
    return (
      <div className="bg-white border border-line rounded-xl shadow-card p-6">
        <div className="font-display text-[20px] mb-1">Sin cuenta de Stripe Connect</div>
        <p className="text-[13px] text-ink3 mb-5">
          Crea una cuenta Connect para empezar a recibir pagos divididos. Stripe enviará a una página de
          onboarding para completar el KYC y conectar la cuenta bancaria.
        </p>
        {!creating
          ? (
            <button onClick={() => setCreating(true)} className="btn btn-primary">
              {icons.plus}<span>Conectar con Stripe</span>
            </button>
          )
          : (
            <form className="space-y-4" onSubmit={handleCreate}>
              <div>
                <div className="label mb-1.5">Email del titular</div>
                <input type="email" required className="input"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="finanzas@empresa.com" />
              </div>
              <div>
                <div className="label mb-1.5">País</div>
                <select className="select" value={country} onChange={(e) => setCountry(e.target.value)}>
                  <option value="ES">España</option>
                  <option value="FR">Francia</option>
                  <option value="DE">Alemania</option>
                  <option value="GB">Reino Unido</option>
                </select>
              </div>
              {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Crear cuenta y abrir onboarding</button>
              </div>
            </form>
          )
        }
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {accounts.map((a) => (
        <div key={a.id} className="bg-white border border-line rounded-xl shadow-card">
          <div className="px-5 py-4 border-b border-line flex items-center justify-between">
            <div>
              <div className="font-display text-[20px]">{a.email ?? 'Cuenta Connect'}</div>
              <div className="text-xs text-ink3 mt-0.5 font-mono">{a.stripe_account_id ?? a.stripeAccountId}</div>
            </div>
            <StatusPill status={a.status} />
          </div>
          <dl className="divide-y divide-line">
            <div className="px-5 py-3 flex justify-between text-[13px]">
              <dt className="text-ink3">Charges enabled</dt>
              <dd className={(a.charges_enabled ?? a.chargesEnabled) ? 'text-ok' : 'text-ink3'}>
                {(a.charges_enabled ?? a.chargesEnabled) ? 'Sí' : 'No'}
              </dd>
            </div>
            <div className="px-5 py-3 flex justify-between text-[13px]">
              <dt className="text-ink3">Payouts enabled</dt>
              <dd className={(a.payouts_enabled ?? a.payoutsEnabled) ? 'text-ok' : 'text-ink3'}>
                {(a.payouts_enabled ?? a.payoutsEnabled) ? 'Sí' : 'No'}
              </dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  )
}

export function ReglasPanel({ scopeQuery = '', onToast }) {
  const [rules, setRules]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName]         = useState('')
  const [platformPct, setPlatformPct] = useState(10)
  const [recipients, setRecipients]   = useState([{ accountId: '', label: '', percentage: 90 }])
  const [error, setError]       = useState(null)

  function reload() {
    setLoading(true)
    api.get(`/api/splitpay/split-rules${scopeQuery}`)
      .then((res) => setRules(Array.isArray(res) ? res : (res?.data ?? [])))
      .catch(() => setRules([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [scopeQuery])

  function updateRecipient(idx, key, val) {
    setRecipients((rs) => rs.map((r, i) => i === idx ? { ...r, [key]: val } : r))
  }
  function addRecipient() {
    setRecipients((rs) => [...rs, { accountId: '', label: '', percentage: 0 }])
  }
  function removeRecipient(idx) {
    setRecipients((rs) => rs.filter((_, i) => i !== idx))
  }

  const recipientTotal = recipients.reduce((s, r) => s + Number(r.percentage || 0), 0)
  const total = Number(platformPct) + recipientTotal
  const totalsOk = Math.abs(total - 100) < 0.01

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    if (!totalsOk) {
      setError(`Los porcentajes deben sumar 100% (actual: ${total}%).`)
      return
    }
    try {
      await api.post(`/api/splitpay/split-rules${scopeQuery}`, {
        name,
        platformFeePercent: Number(platformPct),
        recipients: recipients.map((r) => ({
          accountId: r.accountId,
          label:     r.label,
          percentage: Number(r.percentage),
        })),
      })
      onToast?.('Regla creada')
      setCreating(false); setName(''); setPlatformPct(10)
      setRecipients([{ accountId: '', label: '', percentage: 90 }])
      reload()
    } catch (err) {
      setError(err.message ?? 'No se pudo crear la regla')
    }
  }

  async function handleDeactivate(id) {
    try {
      // For DELETE we need to append the scope to the URL with the right separator
      const sep = scopeQuery ? (scopeQuery.startsWith('?') ? '&' : '?') : ''
      const tail = scopeQuery ? `${sep}${scopeQuery.replace(/^\?/, '')}` : ''
      await api.delete(`/api/splitpay/split-rules/${id}${tail}`)
      onToast?.('Regla desactivada')
      reload()
    } catch (err) {
      onToast?.(err.message ?? 'No se pudo desactivar', 'danger')
    }
  }

  if (loading) return <div className="p-10 text-center text-ink3">Cargando reglas…</div>

  return (
    <div className="space-y-4">
      <div className="bg-white border border-line rounded-xl shadow-card">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="font-display text-[20px]">Reglas de reparto</div>
            <div className="text-xs text-ink3 mt-0.5">{rules.length} reglas configuradas</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setCreating((c) => !c)}>
            {icons.plus}<span>{creating ? 'Cancelar' : 'Nueva regla'}</span>
          </button>
        </div>

        {creating && (
          <form className="px-5 py-4 border-b border-line space-y-4 bg-paper" onSubmit={handleCreate}>
            <div>
              <div className="label mb-1.5">Nombre</div>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Reparto estándar" required />
            </div>
            <div>
              <div className="label mb-1.5">Comisión plataforma (%)</div>
              <input type="number" min="0" max="100" step="0.1" className="input"
                value={platformPct} onChange={(e) => setPlatformPct(e.target.value)} required />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="label">Destinatarios</div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={addRecipient}>
                  {icons.plus}<span>Añadir destinatario</span>
                </button>
              </div>
              <div className="space-y-2">
                {recipients.map((r, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-5">
                      <div className="text-[10.5px] text-ink3 mb-1">Account ID</div>
                      <input
                        className="input font-mono text-[12.5px]"
                        placeholder="acct_1NXXXXXXXXXXXXXX"
                        value={r.accountId}
                        onChange={(e) => updateRecipient(idx, 'accountId', e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-span-4">
                      <div className="text-[10.5px] text-ink3 mb-1">Etiqueta</div>
                      <input
                        className="input"
                        placeholder="Comerciante"
                        value={r.label}
                        onChange={(e) => updateRecipient(idx, 'label', e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-span-2">
                      <div className="text-[10.5px] text-ink3 mb-1">%</div>
                      <input
                        type="number" min="0" max="100" step="0.1"
                        className="input"
                        value={r.percentage}
                        onChange={(e) => updateRecipient(idx, 'percentage', e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-span-1 text-right">
                      {recipients.length > 1 && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeRecipient(idx)} title="Quitar">
                          {icons.trash}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className={`text-[11.5px] mt-2 ${totalsOk ? 'text-ok' : 'text-warn'}`}>
                Total: {total}% {totalsOk ? '✓' : `(falta ${(100 - total).toFixed(2)}% para 100%)`}
              </div>
            </div>

            {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary btn-sm">Crear regla</button>
            </div>
          </form>
        )}

        <table className="t">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>% Plataforma</th>
              <th>Estado</th>
              <th className="text-right pr-6">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0
              ? <tr><td colSpan={4} className="text-center text-ink3 py-8">No hay reglas configuradas todavía.</td></tr>
              : rules.map((r) => {
                const active = r.active !== false && r.is_active !== false && r.isActive !== false
                return (
                  <tr key={r.id}>
                    <td className="font-medium">{r.name ?? '—'}</td>
                    <td className="font-mono text-[12.5px]">{r.platform_fee_percent ?? r.platformFeePercent ?? '—'}%</td>
                    <td><StatusPill status={active ? 'active' : 'inactive'} /></td>
                    <td className="text-right pr-6">
                      {active && (
                        <button onClick={() => handleDeactivate(r.id)} className="btn btn-ghost btn-sm" title="Desactivar">
                          {icons.pause}<span>Desactivar</span>
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function SplitpayConfigTabs({ scopeQuery = '', onToast }) {
  const [tab, setTab] = useState('cuenta')
  return (
    <>
      <div className="flex items-center gap-1 border-b border-line mb-6">
        {[['cuenta', 'Cuenta Stripe'], ['reglas', 'Reglas de reparto']].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-[13.5px] border-b-2 -mb-px ${tab === k ? 'border-ink text-ink font-medium' : 'border-transparent text-ink3 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'cuenta' && <CuentaPanel scopeQuery={scopeQuery} onToast={onToast} />}
      {tab === 'reglas' && <ReglasPanel scopeQuery={scopeQuery} onToast={onToast} />}
    </>
  )
}
