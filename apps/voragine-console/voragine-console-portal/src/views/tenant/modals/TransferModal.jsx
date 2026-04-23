import { useApp } from '../../../context/AppContext'
import { icons } from '../../../lib/icons'

export default function TransferModal() {
  const { closeModal, toast } = useApp()
  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-[22px]">Transferir propiedad</div>
            <div className="text-[13px] text-ink3 mt-1">Disponible próximamente.</div>
          </div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <div className="p-6 space-y-4">
        <div className="text-[13.5px] text-ink2 leading-relaxed">
          La transferencia de propiedad requiere un flujo de doble confirmación con aceptación por email. Este flujo aún no está implementado en el backend.
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button onClick={() => { closeModal(); toast('Próximamente', 'warn') }} className="btn btn-primary">
            {icons.transfer}OK
          </button>
        </div>
      </div>
    </>
  )
}
