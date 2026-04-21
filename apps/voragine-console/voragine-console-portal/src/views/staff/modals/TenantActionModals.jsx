import { useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { icons } from '../../../lib/icons'

export function SuspendModal({ tenant }) {
  const { closeModal, toast } = useApp()
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
      <form className="p-6 space-y-4" onSubmit={e => { e.preventDefault(); closeModal(); toast('Tenant suspendido') }}>
        <div>
          <div className="label mb-1.5">Motivo</div>
          <select className="select">
            <option value="NON_PAYMENT">Impago (NON_PAYMENT)</option>
            <option value="SECURITY_INCIDENT">Incidente de seguridad</option>
            <option value="TOS_VIOLATION">Violación de términos</option>
            <option value="MANUAL_REVIEW">Revisión manual</option>
            <option value="OTHER">Otro</option>
          </select>
        </div>
        <div>
          <div className="label mb-1.5">Nota interna</div>
          <textarea className="textarea" rows="3" placeholder="Detalles visibles solo para Staff…" />
        </div>
        <div className="bg-warnbg border border-warn/30 rounded-lg p-3 text-[12.5px] text-warn flex gap-2">
          <span className="mt-0.5">{icons.info}</span>
          <div>El Owner recibirá email inmediato con el motivo. Los webhooks salientes se pausan. Las transacciones en curso no se cancelan.</div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-danger">Suspender</button>
        </div>
      </form>
    </>
  )
}

export function ReactivateModal({ tenant }) {
  const { closeModal, toast } = useApp()
  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div className="font-display text-[22px]">Reactivar {tenant.name}</div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <form className="p-6 space-y-4" onSubmit={e => { e.preventDefault(); closeModal(); toast('Tenant reactivado') }}>
        <div>
          <div className="label mb-1.5">Justificación</div>
          <textarea className="textarea" rows="3" placeholder="La suspensión se levanta porque…" required />
        </div>
        <div className="bg-okbg border border-ok/30 rounded-lg p-3 text-[12.5px] text-ok flex gap-2">
          <span className="mt-0.5">{icons.check}</span>
          <div>Tras la reactivación, la API vuelve a aceptar peticiones y se reanudan los webhooks. Los eventos acumulados durante la suspensión <strong>no</strong> se reintentan automáticamente.</div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-primary">Reactivar</button>
        </div>
      </form>
    </>
  )
}

export function ArchiveModal({ tenant }) {
  const { closeModal, toast } = useApp()
  const [confirm, setConfirm] = useState('')
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
      <form className="p-6 space-y-4" onSubmit={e => { e.preventDefault(); closeModal(); toast('Tenant archivado', 'warn') }}>
        <div className="bg-dangerbg border border-danger/30 rounded-lg p-3 text-[12.5px] text-danger flex gap-2">
          <span className="mt-0.5">{icons.info}</span>
          <div>Al archivar: se libera el subdominio, se revocan todas las API keys, se detienen los webhooks, los Admins pierden acceso. Los datos se borran definitivamente tras 90 días.</div>
        </div>
        <div>
          <div className="label mb-1.5">Motivo (opcional)</div>
          <select className="select">
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
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-danger" disabled={confirm !== tenant.name}>
            {icons.archive}Archivar definitivamente
          </button>
        </div>
      </form>
    </>
  )
}

export function RestoreModal({ tenant }) {
  const { closeModal, toast } = useApp()
  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div className="font-display text-[22px]">Restaurar {tenant.name}</div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <div className="p-6 space-y-4">
        <div className="bg-infobg border border-info/30 rounded-lg p-3 text-[12.5px] text-info flex gap-2">
          <span className="mt-0.5">{icons.info}</span>
          <div>El tenant vuelve a estado <strong>ACTIVE</strong>. El subdominio anterior puede estar reasignado. Las API keys previas <strong>no</strong> se reactivan y los Admins deben ser reinvitados.</div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button onClick={() => { closeModal(); toast('Tenant restaurado') }} className="btn btn-primary">Restaurar</button>
        </div>
      </div>
    </>
  )
}

export function ExportModal() {
  const { closeModal, toast, role } = useApp()
  const email = { staff: 'ana@voragine.app', owner: 'pedro@tiendaana.com', admin: 'laura@tiendaana.com' }[role]
  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-[22px]">Exportar datos del tenant</div>
            <div className="text-[13px] text-ink3 mt-1">RGPD · derecho a la portabilidad</div>
          </div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <div className="p-6 space-y-4">
        <div className="text-[13.5px] leading-relaxed text-ink2">
          Se generará un archivo <strong>ZIP cifrado</strong> con todos los datos scoped por{' '}
          <code className="font-mono text-[12px] bg-paper2 px-1.5 rounded">tenant_id</code>: transacciones, split rules, administradores, configuración, webhooks y audit log.
        </div>
        <ul className="text-[13px] space-y-1.5 text-ink3">
          <li className="flex items-start gap-2"><span className="text-ok mt-0.5">{icons.check}</span>Proceso asíncrono · recibirás el enlace en ~10 min</li>
          <li className="flex items-start gap-2"><span className="text-ok mt-0.5">{icons.check}</span>URL firmada de un solo uso, expira en 7 días</li>
          <li className="flex items-start gap-2"><span className="text-ok mt-0.5">{icons.check}</span>Contraseña del ZIP enviada por canal separado</li>
        </ul>
        <div>
          <div className="label mb-1.5">Email de entrega</div>
          <input type="email" className="input" defaultValue={email} />
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button onClick={() => { closeModal(); toast('Exportación solicitada — recibirás el enlace por email') }} className="btn btn-primary">
            {icons.download}Solicitar exportación
          </button>
        </div>
      </div>
    </>
  )
}
