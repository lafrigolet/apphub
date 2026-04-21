import { useApp } from '../../context/AppContext'
import { icons } from '../../lib/icons'
import { ArchiveModal, ExportModal } from '../staff/modals/TenantActionModals'
import TransferModal from './modals/TransferModal'

export default function TenantDanger() {
  const { openModal, currentTenant } = useApp()
  const t = currentTenant()

  return (
    <div className="p-8 max-w-3xl fade-up">
      <div className="mb-8">
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">{t.name}</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight text-danger">
          <span className="italic font-normal">Zona peligrosa</span>
        </h1>
        <p className="text-ink3 mt-3 max-w-xl">
          Acciones irreversibles o que afectan gravemente al tenant. Solo el Owner puede ejecutarlas.
        </p>
      </div>

      <div className="space-y-4">
        <div className="bg-white border border-line rounded-xl shadow-card p-5 flex items-start justify-between gap-4">
          <div>
            <div className="font-medium text-[15px]">Transferir propiedad</div>
            <div className="text-[13px] text-ink3 mt-1 max-w-md">
              Cede la titularidad del tenant a otro administrador. Tras la confirmación, perderás el rol de Owner y pasarás a ser Admin.
            </div>
          </div>
          <button onClick={() => openModal(<TransferModal />)} className="btn btn-ghost shrink-0">
            {icons.transfer}Transferir
          </button>
        </div>

        <div className="bg-white border border-line rounded-xl shadow-card p-5 flex items-start justify-between gap-4">
          <div>
            <div className="font-medium text-[15px]">Exportar todos los datos (RGPD)</div>
            <div className="text-[13px] text-ink3 mt-1 max-w-md">
              Descarga un ZIP con todos los datos del tenant (transacciones, configuración, admins, audit log). Se envía por email cifrado.
            </div>
          </div>
          <button onClick={() => openModal(<ExportModal />)} className="btn btn-ghost shrink-0">
            {icons.download}Exportar
          </button>
        </div>

        <div className="bg-[#FBF3F2] border border-danger/30 rounded-xl p-5 flex items-start justify-between gap-4">
          <div>
            <div className="font-medium text-[15px] text-danger">Archivar tenant</div>
            <div className="text-[13px] text-ink3 mt-1 max-w-md">
              Detiene la operativa y libera el subdominio. Los datos se conservan durante 90 días antes del borrado definitivo. Requiere tecleo del nombre para confirmar.
            </div>
          </div>
          <button onClick={() => openModal(<ArchiveModal tenant={t} />)} className="btn btn-danger shrink-0">
            {icons.archive}Archivar
          </button>
        </div>
      </div>
    </div>
  )
}
