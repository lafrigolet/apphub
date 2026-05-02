import { useState } from 'react'
import { useApp } from '../../../shell/lib/context'
import { api } from '../../../shell/lib/api'
import { icons } from '../../../shell/lib/icons'

async function changeStatus(tenantId, status, reason) {
  return api.patch(`/api/tenants/tenants/${tenantId}/status`, { status, reason })
}

export function SuspendModal({ tenant, onDone }) {
  const { closeModal, toast } = useApp()
  const [reason, setReason]   = useState('NON_PAYMENT')
  const [note, setNote]       = useState('')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await changeStatus(tenant.id, 'suspended', note ? `${reason} — ${note}` : reason)
      toast('Tenant suspendido')
      onDone?.()
      closeModal()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-[22px] tracking-tight">Suspender {tenant.name}</div>
            <div className="text-[13px] text-ink3 mt-1">La API del tenant devolverá 403 hasta la reactivación.</div>
          </div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <form className="p-6 space-y-4" onSubmit={submit}>
        <div>
          <div className="label mb-1.5">Motivo</div>
          <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="NON_PAYMENT">Impago (NON_PAYMENT)</option>
            <option value="SECURITY_INCIDENT">Incidente de seguridad</option>
            <option value="TOS_VIOLATION">Violación de términos</option>
            <option value="MANUAL_REVIEW">Revisión manual</option>
            <option value="OTHER">Otro</option>
          </select>
        </div>
        <div>
          <div className="label mb-1.5">Nota interna</div>
          <textarea className="textarea" rows="3" placeholder="Detalles visibles solo para Staff…"
            value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-danger" disabled={busy}>{busy ? 'Suspendiendo…' : 'Suspender'}</button>
        </div>
      </form>
    </>
  )
}

export function ReactivateModal({ tenant, onDone }) {
  const { closeModal, toast } = useApp()
  const [reason, setReason] = useState('')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await changeStatus(tenant.id, 'active', reason || 'Reactivación manual')
      toast('Tenant reactivado')
      onDone?.()
      closeModal()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div className="font-display text-[22px]">Reactivar {tenant.name}</div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <form className="p-6 space-y-4" onSubmit={submit}>
        <div>
          <div className="label mb-1.5">Justificación</div>
          <textarea className="textarea" rows="3" placeholder="La suspensión se levanta porque…"
            value={reason} onChange={(e) => setReason(e.target.value)} required />
        </div>
        {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Reactivando…' : 'Reactivar'}</button>
        </div>
      </form>
    </>
  )
}

export function ArchiveModal({ tenant, onDone }) {
  const { closeModal, toast } = useApp()
  const [confirm, setConfirm] = useState('')
  const [reason, setReason]   = useState('Cliente canceló servicio')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await changeStatus(tenant.id, 'archived', reason)
      toast('Tenant archivado', 'warn')
      onDone?.()
      closeModal()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-[22px] text-danger">Archivar {tenant.name}</div>
            <div className="text-[13px] text-ink3 mt-1">Acción reversible solo dentro de los 90 días siguientes.</div>
          </div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <form className="p-6 space-y-4" onSubmit={submit}>
        <div>
          <div className="label mb-1.5">Motivo (opcional)</div>
          <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option>Cliente canceló servicio</option>
            <option>Migración a otra plataforma</option>
            <option>Fin de contrato</option>
            <option>Otro</option>
          </select>
        </div>
        <div>
          <div className="label mb-1.5">
            Confirmación · escribe <code className="font-mono text-[12px] bg-paper2 px-1.5 rounded">{tenant.name}</code> para continuar
          </div>
          <input className="input" placeholder={tenant.name} value={confirm} onChange={e => setConfirm(e.target.value)} />
        </div>
        {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-danger" disabled={confirm !== tenant.name || busy}>
            {icons.archive}{busy ? 'Archivando…' : 'Archivar definitivamente'}
          </button>
        </div>
      </form>
    </>
  )
}

export function RestoreModal({ tenant, onDone }) {
  const { closeModal, toast } = useApp()
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState(null)

  async function doRestore() {
    setBusy(true); setError(null)
    try {
      await changeStatus(tenant.id, 'active')
      toast('Tenant restaurado')
      onDone?.()
      closeModal()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div className="font-display text-[22px]">Restaurar {tenant.name}</div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <div className="p-6 space-y-4">
        <div className="text-[13px] text-ink2">El tenant vuelve a estado <strong>ACTIVE</strong>.</div>
        {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button onClick={doRestore} className="btn btn-primary" disabled={busy}>{busy ? 'Restaurando…' : 'Restaurar'}</button>
        </div>
      </div>
    </>
  )
}

export function ExportModal() {
  const { closeModal, toast, identity } = useApp()
  const email = identity?.email ?? ''
  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-[22px]">Exportar datos del tenant</div>
            <div className="text-[13px] text-ink3 mt-1">RGPD · próximamente</div>
          </div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <div className="p-6 space-y-4">
        <div className="text-[13.5px] leading-relaxed text-ink2">
          La exportación RGPD aún no está implementada en el backend. Esta acción es un stub.
        </div>
        <div>
          <div className="label mb-1.5">Email de entrega</div>
          <input type="email" className="input" defaultValue={email} />
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button onClick={() => { closeModal(); toast('Próximamente', 'warn') }} className="btn btn-primary">
            {icons.download}OK
          </button>
        </div>
      </div>
    </>
  )
}
