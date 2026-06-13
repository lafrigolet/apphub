import { useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'
import { APP_ID } from '../../../lib/auth'
import { icons } from '../../../lib/icons'

function slugify(name) {
  return String(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `tenant-${Date.now()}`
}

export default function CreateTenantModal({ onCreated }) {
  const { closeModal, toast } = useApp()
  const [displayName, setDisplayName]   = useState('')
  const [legalName, setLegalName]       = useState('')
  const [country, setCountry]           = useState('ES')
  const [cif, setCif]                   = useState('')
  const [plan, setPlan]                 = useState('PRO')
  const [contactEmail, setContactEmail] = useState('')
  const [submitting, setSubmitting]     = useState(false)
  const [error, setError]               = useState(null)

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const created = await api.post('/api/tenants/tenants', {
        appId: APP_ID,
        displayName,
        subdomain: slugify(displayName),
      })
      if (legalName || cif || country || plan || contactEmail) {
        await api.patch(`/api/tenants/tenants/${created.id}`, {
          legalName:    legalName    || undefined,
          cif:          cif          || undefined,
          country:      country      || undefined,
          plan,
          contactEmail: contactEmail || undefined,
        })
      }
      toast('Tenant creado')
      onCreated?.()
      closeModal()
    } catch (err) {
      setError(err.message ?? 'Error al crear tenant')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-[24px] tracking-tight">Nueva cuenta</div>
            <div className="text-[13px] text-ink3 mt-1">Crea una cuenta para {APP_ID}.</div>
          </div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <form className="p-6 space-y-5" onSubmit={onSubmit}>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <div className="label mb-1.5">Nombre comercial</div>
            <input className="input" placeholder="Tienda Ana"
              value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </div>
          <div>
            <div className="label mb-1.5">Razón social</div>
            <input className="input" placeholder="Tienda Ana SL"
              value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </div>
          <div>
            <div className="label mb-1.5">País</div>
            <select className="select" value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="ES">España</option><option value="FR">Francia</option><option value="GB">Reino Unido</option>
            </select>
          </div>
          <div>
            <div className="label mb-1.5">CIF / VAT</div>
            <input className="input font-mono" placeholder="B12345678"
              value={cif} onChange={(e) => setCif(e.target.value)} />
          </div>
          <div>
            <div className="label mb-1.5">Plan</div>
            <select className="select" value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option>STARTER</option><option>PRO</option><option>ENTERPRISE</option>
            </select>
          </div>
        </div>

        <div className="border-t border-line pt-5">
          <div className="label mb-1.5">Email de contacto (opcional)</div>
          <input type="email" className="input" placeholder="contacto@ejemplo.com"
            value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </div>

        {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Creando…' : 'Crear tenant'}
          </button>
        </div>
      </form>
    </>
  )
}
