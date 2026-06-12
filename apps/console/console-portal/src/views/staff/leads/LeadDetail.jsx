import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { fmtDate, relTime } from '../../../lib/utils'
import { icons } from '../../../lib/icons'
import LeadStatusBadge, { LEAD_STATUSES, statusLabel } from './LeadStatusBadge'
import BootstrapTenantModal from '../modals/BootstrapTenantModal'
import {
  getLead, getActivities, patchLead, addActivity, deleteLead, convertLead,
} from './leadsApi'

const ACTIVITY_TYPES = [['note', 'Nota'], ['call', 'Llamada'], ['email', 'Email'], ['meeting', 'Reunión']]

// Etiqueta legible de una entrada del timeline.
function activityLine(a) {
  if (a.type === 'status_change') {
    const { from, to } = a.metadata ?? {}
    return `Estado: ${statusLabel(from)} → ${statusLabel(to)}`
  }
  if (a.type === 'assignment')  return 'Reasignación'
  if (a.type === 'system')      return a.body || 'Evento de sistema'
  return a.body
}

export default function LeadDetail({ id, staffMap = {}, onChanged }) {
  const { closeModal, toast, identity, openModal } = useApp()
  const [lead, setLead] = useState(null)
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // Estado local de los controles de acción.
  const [status, setStatus] = useState('new')
  const [lostReason, setLostReason] = useState('')
  const [score, setScore] = useState('')
  const [tags, setTags] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [note, setNote] = useState('')
  const [noteType, setNoteType] = useState('note')

  function hydrate(l) {
    setLead(l)
    setStatus(l.status)
    setScore(l.score ?? '')
    setTags((l.tags ?? []).join(', '))
    setFollowUp(l.next_follow_up_at ? l.next_follow_up_at.slice(0, 16) : '')
  }

  async function reload() {
    const [l, acts] = await Promise.all([getLead(id), getActivities(id)])
    if (l) hydrate(l)
    setActivities(acts ?? [])
  }

  useEffect(() => {
    reload().catch(() => toast('No se pudo cargar el lead', 'err')).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Aplica un patch parcial, refresca el detalle y avisa a la lista.
  async function apply(patch, okMsg) {
    setBusy(true)
    try {
      await patchLead(id, patch)
      await reload()
      onChanged?.()
      if (okMsg) toast(okMsg)
    } catch (e) {
      toast(e?.message || 'No se pudo guardar', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function applyStatus() {
    if (status === 'lost' && !lostReason.trim()) { toast('Indica el motivo de pérdida', 'err'); return }
    await apply({ status, ...(status === 'lost' ? { lostReason: lostReason.trim() } : {}) }, 'Estado actualizado')
  }

  async function submitActivity(e) {
    e.preventDefault()
    if (!note.trim()) return
    setBusy(true)
    try {
      await addActivity(id, { type: noteType, body: note.trim() })
      setNote('')
      await reload()
      onChanged?.()
      toast('Actividad registrada')
    } catch (err) {
      toast(err?.message || 'No se pudo registrar', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function convert() {
    if (!tenantId.trim()) { toast('Indica el tenant_id', 'err'); return }
    setBusy(true)
    try {
      await convertLead(id, tenantId.trim())
      await reload()
      onChanged?.()
      toast('Lead convertido a tenant')
    } catch (err) {
      toast(err?.status === 409 ? 'El lead ya estaba convertido' : (err?.message || 'No se pudo convertir'), 'err')
    } finally {
      setBusy(false)
    }
  }

  // Provisión completa (REUSE bootstrap de tenant-config): abre el modal de
  // bootstrap pre-rellenado con los datos del lead; al crearse el tenant
  // sellamos la conversión (convert) para enlazar lead_id → tenant_id. El
  // bootstrap ya crea app+tenant+owner y envía el magic-link de activación.
  function provision() {
    if (!lead) return
    openModal(
      <BootstrapTenantModal
        initial={{
          tenant: { displayName: lead.business_name || lead.contact_name, contactEmail: lead.email },
          owner:  { email: lead.email, displayName: lead.contact_name },
        }}
        onCreated={async (res) => {
          try {
            if (res?.tenant?.id) await convertLead(id, res.tenant.id)
            onChanged?.()
            toast('Lead provisionado y convertido a tenant')
          } catch {
            toast('Tenant creado, pero no se pudo enlazar el lead', 'err')
          }
        }}
      />,
      { size: 'xl' },
    )
  }

  async function remove() {
    if (!window.confirm('¿Borrar este lead y todo su historial? (RGPD, irreversible)')) return
    setBusy(true)
    try {
      await deleteLead(id)
      onChanged?.()
      toast('Lead borrado')
      closeModal()
    } catch (err) {
      toast(err?.message || 'No se pudo borrar', 'err')
      setBusy(false)
    }
  }

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (!lead)   return <div className="p-10 text-center text-ink3">Lead no encontrado.</div>

  return (
    <div className="max-h-[85vh] overflow-y-auto">
      <div className="p-6 border-b border-line flex items-start justify-between gap-4 sticky top-0 bg-white z-10">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-display text-[22px]">{lead.contact_name}</h2>
            <LeadStatusBadge status={lead.status} />
          </div>
          <div className="text-[13px] text-ink3 mt-1">{lead.email}{lead.phone ? ` · ${lead.phone}` : ''}</div>
        </div>
        <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
      </div>

      <div className="grid md:grid-cols-2 gap-6 p-6">
        {/* Columna izquierda — ficha + timeline */}
        <div className="space-y-5">
          <dl className="text-[13px] space-y-1.5">
            <Row label="Empresa">{lead.business_name || '—'}</Row>
            <Row label="Sector">{lead.industry || '—'}</Row>
            <Row label="Fuente">{lead.source || '—'}</Row>
            <Row label="App">{lead.app_id || '—'}</Row>
            <Row label="Campaña">{lead.utm_campaign || '—'}</Row>
            <Row label="Comercial">{lead.assigned_to ? (staffMap[lead.assigned_to] || lead.assigned_to) : '— sin asignar'}</Row>
            <Row label="Alta">{fmtDate(lead.created_at, true)}</Row>
            {lead.converted_tenant_id && <Row label="Tenant">{lead.converted_tenant_id}</Row>}
          </dl>

          {lead.message && (
            <div className="bg-paper2 border border-line rounded-lg p-3 text-[13px] text-ink2 whitespace-pre-wrap">{lead.message}</div>
          )}

          <div>
            <div className="label mb-2">Actividad</div>
            <form onSubmit={submitActivity} className="flex gap-2 mb-3">
              <select className="select w-28" value={noteType} onChange={(e) => setNoteType(e.target.value)}>
                {ACTIVITY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input className="input flex-1" placeholder="Añadir nota, llamada…" value={note} onChange={(e) => setNote(e.target.value)} />
              <button type="submit" disabled={busy || !note.trim()} className="btn btn-primary btn-sm">Añadir</button>
            </form>
            <ul className="space-y-2">
              {activities.length === 0 && <li className="text-[13px] text-ink3">Sin actividad todavía.</li>}
              {activities.map((a) => (
                <li key={a.id} className="border-l-2 border-line pl-3 py-0.5">
                  <div className="text-[13px]">{activityLine(a)}</div>
                  <div className="text-[11.5px] text-ink3">
                    {(a.author_email || 'sistema')} · {relTime(a.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Columna derecha — acciones */}
        <div className="space-y-4">
          <Panel label="Estado">
            <div className="flex gap-2">
              <select className="select flex-1" value={status} onChange={(e) => setStatus(e.target.value)}>
                {LEAD_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
              <button onClick={applyStatus} disabled={busy} className="btn btn-ghost btn-sm">Aplicar</button>
            </div>
            {status === 'lost' && (
              <input className="input mt-2" placeholder="Motivo de pérdida (obligatorio)" value={lostReason} onChange={(e) => setLostReason(e.target.value)} />
            )}
          </Panel>

          <Panel label="Asignación">
            <div className="flex gap-2">
              <button onClick={() => apply({ assignedTo: identity?.userId }, 'Asignado a ti')} disabled={busy} className="btn btn-ghost btn-sm">Asignar a mí</button>
              <button onClick={() => apply({ assignedTo: null }, 'Desasignado')} disabled={busy || !lead.assigned_to} className="btn btn-ghost btn-sm">Quitar</button>
            </div>
          </Panel>

          <Panel label="Score (0–100)">
            <div className="flex gap-2">
              <input type="number" min="0" max="100" className="input flex-1" value={score} onChange={(e) => setScore(e.target.value)} />
              <button onClick={() => apply({ score: score === '' ? null : Number(score) }, 'Score guardado')} disabled={busy} className="btn btn-ghost btn-sm">Guardar</button>
            </div>
          </Panel>

          <Panel label="Tags (separadas por coma)">
            <div className="flex gap-2">
              <input className="input flex-1" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, urgente" />
              <button onClick={() => apply({ tags: tags.split(',').map((t) => t.trim()).filter(Boolean) }, 'Tags guardadas')} disabled={busy} className="btn btn-ghost btn-sm">Guardar</button>
            </div>
          </Panel>

          <Panel label="Volver a contactar el…">
            <div className="flex gap-2">
              <input type="datetime-local" className="input flex-1" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
              <button onClick={() => apply({ nextFollowUpAt: followUp ? new Date(followUp).toISOString() : null }, 'Follow-up guardado')} disabled={busy} className="btn btn-ghost btn-sm">Guardar</button>
            </div>
          </Panel>

          {!lead.converted_tenant_id && (
            <Panel label="Convertir a tenant">
              <button onClick={provision} disabled={busy} className="btn btn-primary btn-sm w-full mb-2">
                {icons.plus}<span>Provisionar tenant nuevo</span>
              </button>
              <div className="text-[11.5px] text-ink3 mb-2">…o enlazar a un tenant ya existente:</div>
              <div className="flex gap-2">
                <input className="input flex-1" placeholder="tenant_id (UUID)" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
                <button onClick={convert} disabled={busy} className="btn btn-ghost btn-sm">Enlazar</button>
              </div>
            </Panel>
          )}

          <div className="pt-2 border-t border-line">
            <button onClick={remove} disabled={busy} className="btn btn-ghost btn-sm text-danger">{icons.trash}<span>Borrar (RGPD)</span></button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink3">{label}</dt>
      <dd className="text-ink text-right truncate">{children}</dd>
    </div>
  )
}

function Panel({ label, children }) {
  return (
    <div>
      <div className="label mb-1.5">{label}</div>
      {children}
    </div>
  )
}
