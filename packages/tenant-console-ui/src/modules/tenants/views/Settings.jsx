import { useEffect, useState } from 'react'
import { useApp } from '../../../shell/lib/context'
import { api } from '../../../shell/lib/api'

export default function TenantSettings() {
  const { role, toast, myTenant } = useApp()
  const isOwner = role === 'owner'
  const t = myTenant

  const [form, setForm]     = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  useEffect(() => {
    if (!t) return
    setForm({
      displayName:   t.display_name ?? '',
      legalName:     t.legal_name ?? '',
      cif:           t.cif ?? '',
      country:       t.country ?? 'ES',
      contactEmail:  t.contact_email ?? '',
      contactPhone:  t.contact_phone ?? '',
      address:       t.address ?? '',
      defaultLocale: t.default_locale ?? 'es',
    })
  }, [t])

  if (!t || !form) return <div className="p-10 text-center text-ink3">Cargando…</div>

  function upd(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  async function submit(e) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      await api.patch(`/api/tenants/tenants/${t.id}`, {
        displayName:   form.displayName || undefined,
        legalName:     form.legalName   || undefined,
        cif:           form.cif         || undefined,
        country:       form.country     || undefined,
        contactEmail:  form.contactEmail || undefined,
        contactPhone:  form.contactPhone || undefined,
        address:       form.address     || undefined,
        defaultLocale: form.defaultLocale || undefined,
      })
      toast('Cambios guardados')
    } catch (err) {
      setError(err.message ?? 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-4xl fade-up">
      <div className="mb-8">
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">{form.displayName}</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">Ajustes</span> del tenant
        </h1>
        <p className="text-ink3 mt-3 max-w-xl">
          {isOwner
            ? 'Como Owner, puedes editar todos los campos.'
            : 'Como Admin, puedes editar los campos operativos. Los datos fiscales requieren permiso de Staff.'}
        </p>
      </div>

      <form className="space-y-8" onSubmit={submit}>
        <section className="bg-white border border-line rounded-xl shadow-card p-6">
          <div className="mb-5">
            <div className="font-display text-[20px]">Identidad</div>
            <div className="text-xs text-ink3 mt-0.5">Datos mostrados a clientes y contrapartes</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="label mb-1.5">Nombre comercial</div>
              <input className="input" value={form.displayName} onChange={(e) => upd('displayName', e.target.value)} />
            </div>
            <div>
              <div className="label mb-1.5">
                Razón social {!isOwner && <span className="text-ink3 normal-case text-[10px] ml-1">· solo Owner</span>}
              </div>
              <input className="input" value={form.legalName} onChange={(e) => upd('legalName', e.target.value)} disabled={!isOwner} />
            </div>
            <div>
              <div className="label mb-1.5">
                Identificador fiscal {!isOwner && <span className="text-ink3 normal-case text-[10px] ml-1">· solo Owner</span>}
              </div>
              <input className="input font-mono" value={form.cif} onChange={(e) => upd('cif', e.target.value)} disabled={!isOwner} />
            </div>
            <div>
              <div className="label mb-1.5">País</div>
              <select className="select" value={form.country} onChange={(e) => upd('country', e.target.value)} disabled={!isOwner}>
                <option value="ES">España</option>
                <option value="FR">Francia</option>
                <option value="GB">Reino Unido</option>
              </select>
            </div>
          </div>
        </section>

        <section className="bg-white border border-line rounded-xl shadow-card p-6">
          <div className="mb-5">
            <div className="font-display text-[20px]">Notificaciones</div>
            <div className="text-xs text-ink3 mt-0.5">Idioma por defecto para emails y SMS de este tenant</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="label mb-1.5">Idioma por defecto</div>
              <select className="select" value={form.defaultLocale} onChange={(e) => upd('defaultLocale', e.target.value)}>
                <option value="es">Español (es)</option>
                <option value="en">English (en)</option>
              </select>
              <div className="text-[11px] text-ink3 mt-1">
                Se usa cuando la reserva/cita no trae locale explícito. Los recordatorios del scheduler usan este valor.
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white border border-line rounded-xl shadow-card p-6">
          <div className="mb-5">
            <div className="font-display text-[20px]">Contacto</div>
            <div className="text-xs text-ink3 mt-0.5">Canal para notificaciones operativas</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="label mb-1.5">Email de contacto</div>
              <input type="email" className="input" value={form.contactEmail} onChange={(e) => upd('contactEmail', e.target.value)} />
            </div>
            <div>
              <div className="label mb-1.5">Teléfono</div>
              <input className="input" value={form.contactPhone} onChange={(e) => upd('contactPhone', e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <div className="label mb-1.5">Dirección postal</div>
              <input className="input" value={form.address} onChange={(e) => upd('address', e.target.value)} />
            </div>
          </div>
        </section>

        {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}

        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
        </div>
      </form>
    </div>
  )
}
