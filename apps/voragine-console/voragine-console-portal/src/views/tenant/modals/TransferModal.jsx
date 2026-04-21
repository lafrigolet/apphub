import { useApp } from '../../../context/AppContext'
import { ADMINS_BY_TENANT } from '../../../data/mock'
import { icons } from '../../../lib/icons'

export default function TransferModal() {
  const { closeModal, toast, currentTenant } = useApp()
  const t = currentTenant()
  const admins = (ADMINS_BY_TENANT[t.id] || []).filter(a => a.role === 'ADMIN')

  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-[22px]">Transferir propiedad</div>
            <div className="text-[13px] text-ink3 mt-1">Proceso de doble confirmación · tú dejarás de ser Owner.</div>
          </div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <form className="p-6 space-y-4" onSubmit={e => { e.preventDefault(); closeModal(); toast('Transferencia iniciada — pendiente de aceptación del destinatario') }}>
        <div>
          <div className="label mb-1.5">Destinatario</div>
          <select className="select">
            {admins.length
              ? admins.map(a => <option key={a.id}>{a.name} · {a.email}</option>)
              : <option disabled>No hay administradores elegibles</option>
            }
          </select>
          <div className="text-[11.5px] text-ink3 mt-1.5">Solo Admins actuales del tenant pueden recibir la propiedad.</div>
        </div>
        <div>
          <div className="label mb-1.5">Confirma con tu contraseña</div>
          <input type="password" className="input" required />
        </div>
        <div className="bg-warnbg border border-warn/30 rounded-lg p-3 text-[12.5px] text-warn flex gap-2">
          <span className="mt-0.5">{icons.info}</span>
          <div>El destinatario recibirá un email con un enlace de aceptación (expira en 48h). Hasta que acepte, los roles no cambian. Tras aceptar, tú pasarás a ser Admin.</div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={!admins.length}>
            {icons.transfer}Iniciar transferencia
          </button>
        </div>
      </form>
    </>
  )
}
