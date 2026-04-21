import { useApp } from '../../context/AppContext'

export default function TenantSettings() {
  const { role, toast, currentTenant } = useApp()
  const t = currentTenant()
  const isOwner = role === 'owner'

  return (
    <div className="p-8 max-w-4xl fade-up">
      <div className="mb-8">
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">{t.name}</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">Ajustes</span> del tenant
        </h1>
        <p className="text-ink3 mt-3 max-w-xl">
          {isOwner
            ? 'Como Owner, puedes editar todos los campos.'
            : 'Como Admin, puedes editar los campos operativos. Los datos fiscales requieren permiso de Staff.'}
        </p>
      </div>

      <form className="space-y-8" onSubmit={e => { e.preventDefault(); toast('Cambios guardados') }}>
        <section className="bg-white border border-line rounded-xl shadow-card p-6">
          <div className="mb-5">
            <div className="font-display text-[20px]">Identidad</div>
            <div className="text-xs text-ink3 mt-0.5">Datos mostrados a clientes y contrapartes</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="label mb-1.5">Nombre comercial</div>
              <input className="input" defaultValue={t.name} />
            </div>
            <div>
              <div className="label mb-1.5">
                Razón social {!isOwner && <span className="text-ink3 normal-case text-[10px] ml-1">· solo Staff</span>}
              </div>
              <input className="input" defaultValue={t.legal} disabled={!isOwner} />
            </div>
            <div>
              <div className="label mb-1.5">
                Identificador fiscal {!isOwner && <span className="text-ink3 normal-case text-[10px] ml-1">· solo Staff</span>}
              </div>
              <input className="input font-mono" defaultValue={t.cif} disabled={!isOwner} />
            </div>
            <div>
              <div className="label mb-1.5">
                País {!isOwner && <span className="text-ink3 normal-case text-[10px] ml-1">· solo Staff</span>}
              </div>
              <select className="select" disabled={!isOwner}>
                <option>{t.country === 'ES' ? 'España' : t.country === 'FR' ? 'Francia' : t.country === 'GB' ? 'Reino Unido' : t.country}</option>
              </select>
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
              <input type="email" className="input" defaultValue={`contacto@${t.subdomain}.com`} />
            </div>
            <div>
              <div className="label mb-1.5">Teléfono</div>
              <input className="input" defaultValue="+34 900 000 000" />
            </div>
            <div className="md:col-span-2">
              <div className="label mb-1.5">Dirección postal</div>
              <input className="input" defaultValue="Calle Ejemplo 42, 28001 Madrid, ES" />
            </div>
          </div>
        </section>

        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-primary">Guardar cambios</button>
        </div>
      </form>
    </div>
  )
}
