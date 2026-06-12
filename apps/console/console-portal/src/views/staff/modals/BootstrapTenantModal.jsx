import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'
import { icons } from '../../../lib/icons'

function slugify(name) {
  return String(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function Section({ title, subtitle, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-line rounded-lg bg-paper">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <div className="font-medium text-[14px]">{title}</div>
          {subtitle && <div className="text-[12px] text-ink3 mt-0.5">{subtitle}</div>}
        </div>
        <span className={`text-ink3 transition-transform ${open ? 'rotate-180' : ''}`}>{icons.chevron}</span>
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-line bg-white space-y-3">{children}</div>}
    </div>
  )
}

function Field({ label, required, hint, children }) {
  return (
    <div>
      <div className="label mb-1.5">
        {label}{required ? ' *' : ''}
      </div>
      {children}
      {hint && <div className="text-[11.5px] text-ink3 mt-1">{hint}</div>}
    </div>
  )
}

export default function BootstrapTenantModal({ onCreated, initial }) {
  const { closeModal, toast } = useApp()
  const [apps, setApps] = useState([])
  const [appMode, setAppMode] = useState('existing')   // 'existing' | 'new'
  const [appId, setAppId] = useState('')

  const [appNew, setAppNew] = useState({ appId: '', displayName: '', subdomain: '', enabledModules: '' })
  // `initial` permite pre-rellenar el formulario (p.ej. al provisionar desde un
  // lead: nombre comercial → tenant, email del prospecto → owner).
  const [tenant, setTenant] = useState(() => {
    const t = {
      displayName: '', subdomain: '', legalName: '', cif: '', country: 'ES',
      contactEmail: '', contactPhone: '', address: '', defaultLocale: 'es',
      ...(initial?.tenant ?? {}),
    }
    if (!t.subdomain && t.displayName) t.subdomain = slugify(t.displayName)
    return t
  })
  const [tenantSubdomainTouched, setTenantSubdomainTouched] = useState(false)
  const [owner, setOwner] = useState(() => ({
    email:       initial?.owner?.email ?? '',
    displayName: initial?.owner?.displayName ?? '',
  }))
  const [subscription, setSubscription] = useState({
    period: '', amountCents: '', currency: 'eur', stripePriceId: '', billingEmail: '',
  })
  const [flags, setFlags] = useState({ splitpayEnabled: false, customDomain: '' })

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    api.get('/api/tenants/apps').then(setApps).catch(() => setApps([]))
  }, [])

  // Auto-derive tenant subdomain del displayName mientras staff no lo edite.
  function setTenantDisplay(v) {
    setTenant(t => ({
      ...t,
      displayName: v,
      subdomain: tenantSubdomainTouched ? t.subdomain : slugify(v),
    }))
  }

  function setNewApp(field, v) {
    setAppNew(a => {
      const next = { ...a, [field]: v }
      // Mientras el subdomain no haya sido tocado a mano, lo derivamos del displayName.
      if (field === 'displayName' && !a._subdomainTouched) next.subdomain = slugify(v)
      if (field === 'appId' && !a.appId) next.appId = slugify(v)
      return next
    })
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const appPayload = appMode === 'existing'
        ? (() => {
            const a = apps.find(x => x.app_id === appId)
            if (!a) throw new Error('Selecciona una app existente')
            return {
              appId:       a.app_id,
              displayName: a.display_name,
              subdomain:   a.subdomain,
              enabledModules: Array.isArray(a.enabled_modules) ? a.enabled_modules : undefined,
            }
          })()
        : {
            appId:       appNew.appId.trim(),
            displayName: appNew.displayName.trim(),
            subdomain:   appNew.subdomain.trim() || slugify(appNew.displayName),
            enabledModules: appNew.enabledModules
              ? appNew.enabledModules.split(',').map(s => s.trim()).filter(Boolean)
              : undefined,
          }

      const body = {
        app: appPayload,
        tenant: {
          displayName:   tenant.displayName.trim(),
          subdomain:     tenant.subdomain.trim() || slugify(tenant.displayName),
          legalName:     tenant.legalName.trim()    || undefined,
          cif:           tenant.cif.trim()          || undefined,
          country:       tenant.country             || undefined,
          contactEmail:  tenant.contactEmail.trim(),
          contactPhone:  tenant.contactPhone.trim() || undefined,
          address:       tenant.address.trim()     || undefined,
          defaultLocale: tenant.defaultLocale      || undefined,
        },
        owner: {
          email:       owner.email.trim(),
          displayName: owner.displayName.trim(),
        },
        subscription: (() => {
          const s = {}
          if (subscription.period)        s.period = subscription.period
          if (subscription.amountCents)   s.amountCents = Number(subscription.amountCents)
          if (subscription.currency)      s.currency = subscription.currency
          if (subscription.stripePriceId) s.stripePriceId = subscription.stripePriceId.trim()
          if (subscription.billingEmail)  s.billingEmail = subscription.billingEmail.trim()
          return Object.keys(s).length ? s : undefined
        })(),
        flags: (() => {
          const f = {}
          if (flags.splitpayEnabled) f.splitpayEnabled = true
          if (flags.customDomain)    f.customDomain = flags.customDomain.trim()
          return Object.keys(f).length ? f : undefined
        })(),
      }

      const res = await api.post('/api/tenants/tenants/bootstrap', body)
      setResult(res.data)
      toast(`Tenant ${res.data.tenant.display_name} creado · email enviado a ${res.data.owner.email}`)
      onCreated?.(res.data)
    } catch (err) {
      setError(err.message ?? 'Error en bootstrap')
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <>
        <div className="p-6 border-b border-line flex items-center justify-between">
          <div>
            <div className="font-display text-[24px] tracking-tight">Tenant creado</div>
            <div className="text-[13px] text-ink3 mt-1">El email con el magic-link se envió al owner.</div>
          </div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-paper2 border border-line rounded-lg p-4 text-[13px]">
            <div><span className="text-ink3">Tenant:</span> <span className="font-medium">{result.tenant.display_name}</span></div>
            <div><span className="text-ink3">Subdomain:</span> <span className="font-mono">{result.tenant.subdomain}</span></div>
            <div><span className="text-ink3">Owner:</span> <span className="font-mono">{result.owner.email}</span></div>
          </div>
          <div>
            <div className="label mb-1.5">Magic-link (caduca {new Date(result.owner.expiresAt).toLocaleString()})</div>
            <input
              readOnly
              className="input font-mono text-[12px]"
              value={result.owner.magicLinkUrl}
              onClick={(e) => e.target.select()}
            />
            <div className="text-[11.5px] text-ink3 mt-1">
              Si el email no llega, comparte este enlace con el owner directamente.
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button onClick={closeModal} className="btn btn-primary">Cerrar</button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="p-6 border-b border-line flex items-center justify-between">
        <div>
          <div className="font-display text-[24px] tracking-tight">Bootstrap nuevo tenant</div>
          <div className="text-[13px] text-ink3 mt-1">
            Crea app (si no existe), tenant y owner en una sola operación. El owner recibirá un email para fijar contraseña.
          </div>
        </div>
        <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
      </div>

      <form onSubmit={onSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">

        <Section title="App" subtitle="A qué aplicación pertenece este tenant" defaultOpen>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAppMode('existing')}
              className={`btn btn-sm ${appMode === 'existing' ? 'btn-primary' : 'btn-ghost'}`}>
              App existente
            </button>
            <button type="button" onClick={() => setAppMode('new')}
              className={`btn btn-sm ${appMode === 'new' ? 'btn-primary' : 'btn-ghost'}`}>
              Nueva app
            </button>
          </div>
          {appMode === 'existing' ? (
            <Field label="Selecciona app" required>
              <select className="select" value={appId} onChange={(e) => setAppId(e.target.value)} required>
                <option value="">— Elige una —</option>
                {apps.map(a => (
                  <option key={a.app_id} value={a.app_id}>{a.display_name} ({a.app_id})</option>
                ))}
              </select>
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="App ID" required hint="kebab-case, único globalmente">
                <input className="input font-mono" placeholder="aikikan"
                  value={appNew.appId} onChange={(e) => setNewApp('appId', e.target.value)} required />
              </Field>
              <Field label="Display name" required>
                <input className="input" placeholder="Aikikan"
                  value={appNew.displayName} onChange={(e) => setNewApp('displayName', e.target.value)} required />
              </Field>
              <Field label="Subdomain" required hint="usado para X.hulkstein.com">
                <input className="input font-mono" placeholder="aikikan"
                  value={appNew.subdomain}
                  onChange={(e) => setAppNew(a => ({ ...a, subdomain: e.target.value, _subdomainTouched: true }))}
                  required />
              </Field>
              <Field label="Módulos habilitados" hint="separados por coma (opcional)">
                <input className="input font-mono" placeholder="dashboard,members"
                  value={appNew.enabledModules}
                  onChange={(e) => setNewApp('enabledModules', e.target.value)} />
              </Field>
            </div>
          )}
        </Section>

        <Section title="Identidad del tenant" subtitle="Datos comerciales y de contacto" defaultOpen>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Display name" required>
              <input className="input" placeholder="Acme Corp"
                value={tenant.displayName} onChange={(e) => setTenantDisplay(e.target.value)} required />
            </Field>
            <Field label="Subdomain" required hint={`URL del tenant: ${tenant.subdomain || '<subdomain>'}.hulkstein.com`}>
              <input className="input font-mono" placeholder="acme"
                value={tenant.subdomain}
                onChange={(e) => { setTenantSubdomainTouched(true); setTenant(t => ({ ...t, subdomain: e.target.value })) }}
                required />
            </Field>
            <Field label="Razón social">
              <input className="input" placeholder="Acme S.L."
                value={tenant.legalName} onChange={(e) => setTenant(t => ({ ...t, legalName: e.target.value }))} />
            </Field>
            <Field label="CIF / VAT">
              <input className="input font-mono" placeholder="B12345678"
                value={tenant.cif} onChange={(e) => setTenant(t => ({ ...t, cif: e.target.value }))} />
            </Field>
            <Field label="País">
              <select className="select" value={tenant.country} onChange={(e) => setTenant(t => ({ ...t, country: e.target.value }))}>
                <option value="ES">España</option>
                <option value="FR">Francia</option>
                <option value="GB">Reino Unido</option>
              </select>
            </Field>
            <Field label="Locale por defecto">
              <select className="select" value={tenant.defaultLocale} onChange={(e) => setTenant(t => ({ ...t, defaultLocale: e.target.value }))}>
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </Field>
            <Field label="Email de contacto" required>
              <input type="email" className="input" placeholder="contacto@acme.com"
                value={tenant.contactEmail} onChange={(e) => setTenant(t => ({ ...t, contactEmail: e.target.value }))} required />
            </Field>
            <Field label="Teléfono">
              <input className="input" placeholder="+34 600 000 000"
                value={tenant.contactPhone} onChange={(e) => setTenant(t => ({ ...t, contactPhone: e.target.value }))} />
            </Field>
            <div className="col-span-2">
              <Field label="Dirección">
                <input className="input" placeholder="Calle Mayor 1, Madrid"
                  value={tenant.address} onChange={(e) => setTenant(t => ({ ...t, address: e.target.value }))} />
              </Field>
            </div>
          </div>
        </Section>

        <Section title="Owner" subtitle="Quien recibirá el magic-link de activación" defaultOpen>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email" required>
              <input type="email" className="input" placeholder="owner@acme.com"
                value={owner.email} onChange={(e) => setOwner(o => ({ ...o, email: e.target.value }))} required />
            </Field>
            <Field label="Nombre" required>
              <input className="input" placeholder="Ana García"
                value={owner.displayName} onChange={(e) => setOwner(o => ({ ...o, displayName: e.target.value }))} required />
            </Field>
          </div>
        </Section>

        <Section title="Subscripción a la plataforma" subtitle="Opcional — configurable luego" defaultOpen={false}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Periodo">
              <select className="select" value={subscription.period}
                onChange={(e) => setSubscription(s => ({ ...s, period: e.target.value }))}>
                <option value="">— sin configurar —</option>
                <option value="monthly">Mensual</option>
                <option value="annual">Anual</option>
              </select>
            </Field>
            <Field label="Importe (céntimos)">
              <input type="number" min="0" className="input font-mono" placeholder="4900"
                value={subscription.amountCents}
                onChange={(e) => setSubscription(s => ({ ...s, amountCents: e.target.value }))} />
            </Field>
            <Field label="Moneda">
              <select className="select" value={subscription.currency}
                onChange={(e) => setSubscription(s => ({ ...s, currency: e.target.value }))}>
                <option value="eur">EUR</option>
                <option value="usd">USD</option>
                <option value="gbp">GBP</option>
              </select>
            </Field>
            <Field label="Stripe price_id">
              <input className="input font-mono" placeholder="price_xxx"
                value={subscription.stripePriceId}
                onChange={(e) => setSubscription(s => ({ ...s, stripePriceId: e.target.value }))} />
            </Field>
            <div className="col-span-2">
              <Field label="Email de facturación">
                <input type="email" className="input" placeholder="finance@acme.com"
                  value={subscription.billingEmail}
                  onChange={(e) => setSubscription(s => ({ ...s, billingEmail: e.target.value }))} />
              </Field>
            </div>
          </div>
        </Section>

        <Section title="Feature flags" subtitle="Opcional" defaultOpen={false}>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={flags.splitpayEnabled}
              onChange={(e) => setFlags(f => ({ ...f, splitpayEnabled: e.target.checked }))} />
            Habilitar Split Pay
          </label>
          <Field label="Custom domain" hint="Opcional — el owner podrá verificarlo después">
            <input className="input font-mono" placeholder="acme.com"
              value={flags.customDomain}
              onChange={(e) => setFlags(f => ({ ...f, customDomain: e.target.value }))} />
          </Field>
        </Section>

        {error && (
          <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-line -mx-6 px-6 -mb-6 pb-6 sticky bottom-0 bg-white">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Creando…' : 'Bootstrap tenant'}
          </button>
        </div>
      </form>
    </>
  )
}
