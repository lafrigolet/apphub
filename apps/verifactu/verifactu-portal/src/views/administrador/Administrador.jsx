import { useState, useEffect } from 'react'
import Sidebar from '../../components/Sidebar.jsx'
import { Wordmark } from '../../components/icons.jsx'
import { useSection } from '../../hooks/index.js'
import { api } from '../../lib/api.js'
import { scopeQS, APP_ID, DEMO_TENANT_ID } from '../../lib/tenant.js'
import { pillTone, adminUsuarios } from '../../data/mock.js'

const navItems = [
  { id: 'certificados', label: 'Certificados', icon: <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1l9 4v6c0 5-3.8 9.4-9 11-5.2-1.6-9-6-9-11V5z" /><path d="M9 12l2 2 4-4" /></svg> },
  { id: 'usuarios', label: 'Usuarios y permisos', icon: <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg> },
  { id: 'flujo', label: 'Control de flujo', icon: <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h4l3 8 4-16 3 8h4" /></svg> },
  { id: 'auditoria', label: 'Auditoría / Eventos', icon: <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M8 13h2M8 17h2M14 13h2M14 17h2" /></svg> },
]

const show = (active, id) => `${active === id ? '' : 'hidden'}`
const Shield = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1l9 4v6c0 5-3.8 9.4-9 11-5.2-1.6-9-6-9-11V5z" /></svg>
)

export default function Administrador() {
  const [active, go] = useSection('certificados')
  const [certificados, setCertificados] = useState([])
  const [auditoria, setAuditoria] = useState([])
  const [config, setConfig] = useState(null)
  const [dlq, setDlq] = useState(true)

  useEffect(() => {
    const qs = scopeQS()
    api.get(`/api/verifactu/certificados?${qs}`).then(setCertificados).catch(() => {})
    api.get(`/api/verifactu/eventos?${qs}`).then(setAuditoria).catch(() => {})
    api.get(`/api/verifactu/config?${qs}`).then((c) => { setConfig(c); setDlq(c.dlqEnabled) }).catch(() => {})
  }, [])

  const toggleDlq = () => {
    const next = !dlq
    setDlq(next)
    api.patch('/api/verifactu/config', { appId: APP_ID, tenantId: DEMO_TENANT_ID, dlqEnabled: next }).catch(() => {})
  }

  return (
    <div className="flex min-h-screen font-sans text-tinta antialiased">
      <Sidebar items={navItems} active={active} onSelect={go} />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white/80 backdrop-blur border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <Wordmark className="lg:hidden font-display font-700" />
            <span className="pill bg-azul-50 text-azul-600 border border-azul-100">Administrador</span>
          </div>
          <span className="hidden sm:flex pill bg-emerald-50 text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Sistema operativo</span>
        </header>

        <main className="p-6 max-w-6xl w-full mx-auto">

          {/* CERTIFICADOS */}
          <section data-section className={show(active, 'certificados')}>
            <h1 className="font-display font-700 text-2xl">Certificados</h1>
            <p className="text-slate-500 mt-1 text-sm">Certificados electrónicos para la autenticación mTLS frente a la AEAT. Custodia segura, nunca en repositorio.</p>
            <div className="grid md:grid-cols-3 gap-4 mt-6">
              <div className="md:col-span-2 bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
                {certificados.map((c) => (
                  <div key={c.nombre} className="p-5 flex items-center gap-4">
                    <div className={`h-10 w-10 rounded-xl grid place-items-center ${c.iconTone === 'emerald' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}><Shield className="w-5 h-5" /></div>
                    <div className="flex-1"><div className="font-600 text-sm">{c.nombre}</div><div className="font-mono text-xs text-slate-400">{c.meta}</div></div>
                    <span className={`pill ${pillTone[c.tone] ?? 'bg-slate-100 text-slate-500'}`}>{c.estado}</span>
                  </div>
                ))}
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col">
                <h3 className="font-600 text-sm">Almacén seguro</h3>
                <p className="text-xs text-slate-500 mt-2 leading-relaxed flex-1">Las claves privadas residen en vault/HSM. Acceso por mínimo privilegio y rotación programada.</p>
                <div className="mt-4 flex items-center justify-between text-sm"><span className="text-slate-400">Vault</span><span className="pill bg-emerald-50 text-emerald-600">Sellado</span></div>
              </div>
            </div>
          </section>

          {/* USUARIOS */}
          <section data-section className={show(active, 'usuarios')}>
            <h1 className="font-display font-700 text-2xl">Usuarios y permisos</h1>
            <p className="text-slate-500 mt-1 text-sm">Control de acceso por rol al sistema de facturación.</p>
            <div className="bg-white border border-slate-200 rounded-2xl mt-6 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-400 text-xs font-mono uppercase"><tr><th className="text-left font-500 px-5 py-3">Usuario</th><th className="text-left font-500 px-5 py-3">Rol</th><th className="text-left font-500 px-5 py-3">Acceso</th><th className="text-left font-500 px-5 py-3">Estado</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {adminUsuarios.map((u) => (
                    <tr key={u.email} className="hover:bg-slate-50">
                      <td className="px-5 py-3 flex items-center gap-2"><span className={`h-7 w-7 rounded-full grid place-items-center text-xs font-700 ${u.rolPrimary ? 'bg-azul-100 text-azul-700' : 'bg-slate-100 text-slate-600'}`}>{u.initials}</span>{u.email}</td>
                      <td className="px-5 py-3"><span className={`pill ${u.rolPrimary ? 'bg-azul-50 text-azul-600' : 'bg-slate-100 text-slate-600'}`}>{u.rol}</span></td>
                      <td className="px-5 py-3 text-slate-500 font-mono text-xs">{u.acceso}</td>
                      <td className="px-5 py-3"><span className="pill bg-emerald-50 text-emerald-600">Activo</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* FLUJO */}
          <section data-section className={show(active, 'flujo')}>
            <h1 className="font-display font-700 text-2xl">Control de flujo</h1>
            <p className="text-slate-500 mt-1 text-sm">Parámetros de remisión a la AEAT. Los valores se ajustan dinámicamente con la respuesta del servicio.</p>
            <div className="grid md:grid-cols-2 gap-4 mt-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-6">
                <h3 className="font-600 text-sm mb-4">Parámetros de envío</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between"><div><div className="text-sm font-600">Tiempo de espera entre envíos</div><div className="text-xs text-slate-400 font-mono">TiempoEsperaEnvio</div></div><span className="font-mono font-700 text-azul-600">{config?.tiempoEsperaEnvio ?? 60} s</span></div>
                  <div className="flex items-center justify-between"><div><div className="text-sm font-600">Máx. registros por remisión</div><div className="text-xs text-slate-400 font-mono">verificar límite oficial</div></div><span className="font-mono font-700 text-azul-600">{(config?.maxRegistrosLote ?? 1000).toLocaleString('es-ES')}</span></div>
                  <div className="flex items-center justify-between"><div><div className="text-sm font-600">Reintentos con backoff</div><div className="text-xs text-slate-400 font-mono">errores no admisibles</div></div><span className="font-mono font-700 text-azul-600">{config?.reintentos ?? 3}</span></div>
                  <div className="flex items-center justify-between"><div><div className="text-sm font-600">Cola dead-letter</div></div><div className={`toggle ${dlq ? '' : 'off'}`} onClick={toggleDlq} /></div>
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-6">
                <h3 className="font-600 text-sm mb-4">Estado de la cola</h3>
                <div className="space-y-3">
                  <div><div className="flex justify-between text-xs mb-1"><span className="text-slate-400">Pendientes</span><span className="font-mono">312</span></div><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-azul-500" style={{ width: '31%' }} /></div></div>
                  <div><div className="flex justify-between text-xs mb-1"><span className="text-slate-400">En proceso</span><span className="font-mono">120</span></div><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-azul-400" style={{ width: '12%' }} /></div></div>
                  <div><div className="flex justify-between text-xs mb-1"><span className="text-slate-400">DLQ (revisar)</span><span className="font-mono text-rose-500">4</span></div><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-rose-400" style={{ width: '4%' }} /></div></div>
                </div>
                <div className="mt-5 p-3 rounded-xl bg-azul-50 border border-azul-100 text-xs text-azul-800 font-mono">No enviar antes del TiempoEsperaEnvio devuelto por la AEAT.</div>
              </div>
            </div>
          </section>

          {/* AUDITORIA */}
          <section data-section className={show(active, 'auditoria')}>
            <h1 className="font-display font-700 text-2xl">Auditoría / Eventos</h1>
            <p className="text-slate-500 mt-1 text-sm">Traza inalterable de eventos del SIF y accesos. Soporte para exportación a requerimiento de la AEAT.</p>
            <div className="bg-white border border-slate-200 rounded-2xl mt-6 divide-y divide-slate-100 font-mono text-xs">
              {auditoria.map((a) => (
                <div key={a.ts + a.tag} className="flex items-center gap-3 p-4"><span className="text-slate-400">{a.ts}</span><span className={`pill ${pillTone[a.tone] ?? 'bg-slate-100 text-slate-600'}`}>{a.tag}</span><span className="text-slate-600 flex-1">{a.text}</span></div>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 font-mono mt-3">Catálogo de eventos obligatorios: verificar contra la Orden HAC/1177/2024.</p>
          </section>

        </main>
      </div>
    </div>
  )
}
