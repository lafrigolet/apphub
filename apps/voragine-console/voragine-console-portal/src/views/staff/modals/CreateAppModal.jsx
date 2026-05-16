import { useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'
import { icons } from '../../../lib/icons'

function slugify(value) {
  return String(value).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

// Strong random password used as the temporary credential while the admin
// completes the set-password flow via email. Never shown in the UI.
function randomPassword() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 32) + 'A1!'
}

export default function CreateAppModal({ onCreated }) {
  const { closeModal, toast } = useApp()
  // App identity
  const [displayName, setDisplayName]    = useState('')
  const [appId, setAppId]                = useState('')
  const [appIdTouched, setAppIdTouched]  = useState(false)
  const [subdomain, setSubdomain]        = useState('')
  const [subTouched, setSubTouched]      = useState(false)
  const [jwtAudience, setJwtAudience]    = useState('')
  const [jwtTouched, setJwtTouched]      = useState(false)
  // First tenant + admin
  const [tenantName, setTenantName]      = useState('')
  const [tenantTouched, setTenantTouched] = useState(false)
  const [adminEmail, setAdminEmail]      = useState('')
  const [adminName, setAdminName]        = useState('')
  // Features
  const [splitpayEnabled, setSplitpayEnabled] = useState(false)
  // State
  const [submitting, setSubmitting]      = useState(false)
  const [error, setError]                = useState(null)
  const [step, setStep]                  = useState(null) // current sub-step shown on the button label

  function onDisplayNameChange(v) {
    setDisplayName(v)
    const slug = slugify(v)
    if (!appIdTouched)    setAppId(slug)
    if (!subTouched)      setSubdomain(slug)
    if (!jwtTouched)      setJwtAudience(slug)
    if (!tenantTouched)   setTenantName(v)
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      // 1. Register the app in platform_tenants.apps
      setStep('Creando app…')
      await api.post('/api/apps/', {
        appId,
        displayName,
        subdomain,
        jwtAudience: jwtAudience || appId,
        splitpayEnabled,
      })

      // 2. Create the first tenant for that app (one-tenant-per-app on creation;
      //    additional tenants can be added later via the Tenants view)
      setStep('Creando tenant inicial…')
      const tenantSubdomain = slugify(tenantName) || subdomain
      const tenant = await api.post('/api/tenants/tenants', {
        appId,
        displayName: tenantName || displayName,
        subdomain: tenantSubdomain,
      })

      // 3. Register the admin user. The password is a strong random value the
      //    admin will replace via the set-password email below.
      setStep('Creando usuario admin…')
      await api.post('/api/auth/register', {
        appId,
        tenantId: tenant.id,
        email: adminEmail,
        password: randomPassword(),
        role: 'admin',
      })

      // 4. Trigger the set-password email (notifications module listens to
      //    auth.password_reset_requested and dispatches the email)
      setStep('Enviando email de bienvenida…')
      await api.post('/api/auth/forgot-password', {
        appId,
        tenantId: tenant.id,
        email: adminEmail,
      })

      toast(`App ${appId} creada. Email de bienvenida enviado a ${adminEmail}.`)
      onCreated?.()
      closeModal()
    } catch (err) {
      setError(`${step ? step + ' ' : ''}${err.message ?? 'Error inesperado'}`)
    } finally {
      setSubmitting(false)
      setStep(null)
    }
  }

  const valid = displayName && appId && subdomain && tenantName && adminEmail

  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-[24px] tracking-tight">Nueva app</div>
            <div className="text-[13px] text-ink3 mt-1">
              Crea la app, su primer tenant y el usuario administrador en una sola operación.
              El admin recibirá un email para fijar su contraseña inicial.
            </div>
          </div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>

      <form className="p-6 space-y-6" onSubmit={onSubmit}>
        {/* — App — */}
        <section className="space-y-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-ink3">App</div>

          <div>
            <div className="label mb-1.5">Nombre comercial</div>
            <input
              className="input"
              placeholder="Yoga Studio"
              value={displayName}
              onChange={(e) => onDisplayNameChange(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="label mb-1.5">
                app_id <span className="text-ink3 font-normal">(estable)</span>
              </div>
              <input
                className="input font-mono"
                placeholder="yoga-studio"
                value={appId}
                onChange={(e) => { setAppId(slugify(e.target.value)); setAppIdTouched(true) }}
                required
                pattern="[a-z0-9][a-z0-9\-]*"
              />
            </div>

            <div>
              <div className="label mb-1.5">Subdominio</div>
              <div className="flex items-center gap-2">
                <input
                  className="input font-mono"
                  placeholder="yoga"
                  value={subdomain}
                  onChange={(e) => { setSubdomain(slugify(e.target.value)); setSubTouched(true) }}
                  required
                  pattern="[a-z0-9][a-z0-9\-]*"
                />
                <span className="text-ink3 text-[12.5px] whitespace-nowrap">.hulkstein.com</span>
              </div>
            </div>
          </div>

          <div>
            <div className="label mb-1.5">
              JWT audience <span className="text-ink3 font-normal">(opcional, default = app_id)</span>
            </div>
            <input
              className="input font-mono"
              placeholder={appId || 'yoga-studio'}
              value={jwtAudience}
              onChange={(e) => { setJwtAudience(slugify(e.target.value)); setJwtTouched(true) }}
              pattern="[a-z0-9][a-z0-9\-]*"
            />
          </div>
        </section>

        {/* — Tenant inicial — */}
        <section className="space-y-4 border-t border-line pt-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-ink3">Tenant inicial</div>
          <div>
            <div className="label mb-1.5">Nombre del tenant</div>
            <input
              className="input"
              placeholder={displayName || 'Nombre del cliente'}
              value={tenantName}
              onChange={(e) => { setTenantName(e.target.value); setTenantTouched(true) }}
              required
            />
            <div className="text-[11.5px] text-ink3 mt-1">
              Cliente concreto del app. Podrás añadir más tenants después desde la sección Tenants.
            </div>
          </div>
        </section>

        {/* — Admin — */}
        <section className="space-y-4 border-t border-line pt-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-ink3">Usuario administrador</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="label mb-1.5">Email</div>
              <input
                type="email"
                className="input"
                placeholder="admin@cliente.com"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <div className="label mb-1.5">Nombre <span className="text-ink3 font-normal">(opcional)</span></div>
              <input
                className="input"
                placeholder="Ana García"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
              />
            </div>
          </div>
          <div className="bg-paper2 border border-line rounded-lg p-3 text-[12.5px] text-ink2">
            Se creará el usuario con role <span className="font-mono text-ink">admin</span> y se enviará un email para
            que fije su contraseña. Al primer login podrá entrar al portal de la app y a su consola de administración.
          </div>
        </section>

        {/* — Features — */}
        <section className="space-y-3 border-t border-line pt-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-ink3">Features</div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={splitpayEnabled}
              onChange={(e) => setSplitpayEnabled(e.target.checked)}
            />
            <div>
              <div className="text-[13.5px] text-ink">Habilitar Split Pay (Stripe Connect)</div>
              <div className="text-[11.5px] text-ink3 mt-0.5">
                Permite a los tenants de esta app cobrar pagos divididos a través de Stripe Connect.
                Aparecerá una sección "Splitpay" en su consola para configurar la cuenta y las reglas de reparto.
              </div>
            </div>
          </label>
        </section>

        {error && (
          <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost" disabled={submitting}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid || submitting}>
            {submitting ? (step || 'Creando…') : 'Crear app + admin'}
          </button>
        </div>
      </form>
    </>
  )
}
