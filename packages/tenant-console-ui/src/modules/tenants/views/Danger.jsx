import { useApp } from '../../../shell/lib/context'
import { adaptTenant } from '../../../shell/lib/adapters'
import { icons } from '../../../shell/lib/icons'
import { ArchiveModal, ExportModal } from '../../../views/staff/modals/TenantActionModals'
import TransferModal from '../../../views/tenant/modals/TransferModal'

export default function TenantDanger() {
  const { openModal, myTenant, logout } = useApp()
  const t = myTenant

  if (!t) return <div className="p-10 text-center text-ink3">Cargando…</div>
  const adaptedT = adaptTenant(t)
  const tenantName = t.display_name

  return (
    <div className="p-8 max-w-3xl fade-up">
      <div className="mb-8">
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">{tenantName}</div>
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
              Cede la titularidad del tenant a otro administrador. (Próximamente.)
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
              Descarga un ZIP con todos los datos del tenant. (Próximamente.)
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
              Detiene la operativa y libera el subdominio. Al archivar se cerrará tu sesión ya que perderás acceso al tenant.
            </div>
          </div>
          <button
            onClick={() => openModal(<ArchiveModal tenant={adaptedT} onDone={() => setTimeout(logout, 1000)} />)}
            className="btn btn-danger shrink-0"
          >
            {icons.archive}Archivar
          </button>
        </div>
      </div>
    </div>
  )
}
