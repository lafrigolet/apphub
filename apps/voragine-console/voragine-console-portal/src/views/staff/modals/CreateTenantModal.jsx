import { useApp } from '../../../context/AppContext'
import { icons } from '../../../lib/icons'

export default function CreateTenantModal() {
  const { closeModal, toast } = useApp()
  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-[24px] tracking-tight">Nuevo tenant</div>
            <div className="text-[13px] text-ink3 mt-1">Crea un tenant y envía invitación al Owner inicial.</div>
          </div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <form
        className="p-6 space-y-5"
        onSubmit={e => { e.preventDefault(); closeModal(); toast('Tenant creado — invitación enviada al Owner') }}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <div className="label mb-1.5">Nombre comercial</div>
            <input className="input" placeholder="Tienda Ana" required />
          </div>
          <div>
            <div className="label mb-1.5">Razón social</div>
            <input className="input" placeholder="Tienda Ana SL" required />
          </div>
          <div>
            <div className="label mb-1.5">País</div>
            <select className="select"><option>España</option><option>Francia</option><option>Reino Unido</option></select>
          </div>
          <div>
            <div className="label mb-1.5">CIF / VAT</div>
            <input className="input font-mono" placeholder="B12345678" required />
          </div>
          <div>
            <div className="label mb-1.5">Plan</div>
            <select className="select"><option>STARTER</option><option defaultValue>PRO</option><option>ENTERPRISE</option></select>
          </div>
        </div>

        <div className="border-t border-line pt-5">
          <div className="label mb-1.5">Email del Owner inicial</div>
          <input type="email" className="input" placeholder="pedro@tiendaana.com" required />
          <div className="text-[11.5px] text-ink3 mt-1.5 flex items-center gap-1.5">
            {icons.info}Recibirá un enlace firmado con expiración de 72 horas para completar el onboarding.
          </div>
        </div>

        <div className="flex items-start gap-2 bg-paper2 border border-line rounded-lg p-3 text-[12.5px] text-ink2">
          <span className="text-ink3 mt-0.5">{icons.info}</span>
          <div>
            Se asignará automáticamente un subdominio{' '}
            <code className="font-mono text-[11.5px] bg-white px-1.5 py-0.5 rounded">[slug].voragine.app</code>{' '}
            y se generará el{' '}
            <code className="font-mono text-[11.5px] bg-white px-1.5 py-0.5 rounded">tenant_id</code>.{' '}
            La sub-tenancy estará deshabilitada por defecto.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-primary">Crear tenant</button>
        </div>
      </form>
    </>
  )
}
