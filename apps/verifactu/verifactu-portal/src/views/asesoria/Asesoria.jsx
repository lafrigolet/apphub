import { useState, useEffect } from 'react'
import Sidebar from '../../components/Sidebar.jsx'
import { Wordmark, IconPlus } from '../../components/icons.jsx'
import { useSection } from '../../hooks/index.js'
import { api } from '../../lib/api.js'
import { scopeQS } from '../../lib/tenant.js'
import { pillTone, asesoriaEstadoLabel, asesoriaIncidencias } from '../../data/mock.js'

const navItems = [
  { id: 'cartera', label: 'Cartera de clientes', icon: <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /></svg> },
  { id: 'remisiones', label: 'Remisiones', icon: <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></svg> },
  { id: 'representacion', label: 'Representación', icon: <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg> },
  { id: 'incidencias', label: 'Incidencias', icon: <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg> },
]

const show = (active, id) => `${active === id ? '' : 'hidden'}`
const initials = (name) => name.split(' ').map((w) => w[0]).slice(0, 2).join('')

export default function Asesoria() {
  const [active, go] = useSection('cartera')
  const [clientes, setClientes] = useState([])
  const [lotes, setLotes] = useState([])
  const [representacion, setRepresentacion] = useState([])

  useEffect(() => {
    const qs = scopeQS()
    api.get(`/api/verifactu/clientes?${qs}`).then(setClientes).catch(() => {})
    api.get(`/api/verifactu/lotes?${qs}`).then(setLotes).catch(() => {})
    api.get(`/api/verifactu/representacion?${qs}`).then(setRepresentacion).catch(() => {})
  }, [])

  return (
    <div className="flex min-h-screen font-sans text-tinta antialiased">
      <Sidebar items={navItems} active={active} onSelect={go} />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white/80 backdrop-blur border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <Wordmark className="lg:hidden font-display font-700" />
            <span className="pill bg-azul-50 text-azul-600 border border-azul-100">Asesoría / Representante</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:flex pill bg-slate-100 text-slate-600 font-mono">14 clientes activos</span>
            <div className="h-8 w-8 rounded-full bg-azul-100 grid place-items-center text-azul-700 text-xs font-700">GA</div>
          </div>
        </header>

        <main className="p-6 max-w-6xl w-full mx-auto">

          {/* CARTERA */}
          <section data-section className={show(active, 'cartera')}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div><h1 className="font-display font-700 text-2xl">Cartera de clientes</h1><p className="text-slate-500 mt-1 text-sm">Obligados tributarios que gestionas. Selecciona uno para operar en su nombre.</p></div>
              <button className="bg-azul-500 hover:bg-azul-600 text-white text-sm font-600 px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-lg shadow-azul-500/25"><IconPlus />Añadir cliente</button>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
              {clientes.map((c) => (
                <div key={c.nif} className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-azul-300 hover:shadow-lg hover:shadow-azul-500/10 transition cursor-pointer">
                  <div className="flex items-start justify-between">
                    <div className="h-10 w-10 rounded-xl bg-azul-50 grid place-items-center text-azul-700 font-700 text-sm">{initials(c.nombre)}</div>
                    <span className={`pill ${pillTone[c.estado]}`}>{asesoriaEstadoLabel[c.estado]}</span>
                  </div>
                  <h3 className="font-600 mt-3">{c.nombre}</h3>
                  <p className="font-mono text-xs text-slate-400 mt-0.5">{c.nif}</p>
                  <div className="mt-4 flex items-center justify-between text-sm"><span className="text-slate-400 text-xs">Facturas mes</span><span className="font-mono font-600">{c.facturasMes}</span></div>
                </div>
              ))}
            </div>
          </section>

          {/* REMISIONES */}
          <section data-section className={show(active, 'remisiones')}>
            <h1 className="font-display font-700 text-2xl">Remisiones por lote</h1>
            <p className="text-slate-500 mt-1 text-sm">Envíos agrupados a la AEAT respetando el control de flujo (espera y máximo de registros por remisión).</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-5"><div className="text-xs font-mono text-slate-400 uppercase">En cola</div><div className="font-display font-800 text-3xl mt-2">312</div></div>
              <div className="bg-white border border-slate-200 rounded-2xl p-5"><div className="text-xs font-mono text-slate-400 uppercase">Lote actual</div><div className="font-display font-800 text-3xl mt-2">1.000</div><div className="text-xs text-slate-400 mt-1">máx/remisión*</div></div>
              <div className="bg-white border border-slate-200 rounded-2xl p-5"><div className="text-xs font-mono text-slate-400 uppercase">Próximo envío</div><div className="font-display font-800 text-3xl mt-2">58<span className="text-base">s</span></div><div className="text-xs text-slate-400 mt-1">TiempoEsperaEnvio</div></div>
              <div className="bg-white border border-slate-200 rounded-2xl p-5"><div className="text-xs font-mono text-slate-400 uppercase">Aceptación</div><div className="font-display font-800 text-3xl mt-2 text-emerald-500">98%</div></div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl mt-4 p-5">
              <h3 className="font-600 mb-4">Lotes recientes</h3>
              <div className="space-y-2.5">
                {lotes.map((l) => (
                  <div key={l.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-3"><span className="font-mono text-xs text-slate-400">{l.id}</span><span className="text-sm">{l.info}</span></div>
                    <span className={`pill ${pillTone[l.tone]}`}>{l.pulse && <span className="h-1.5 w-1.5 rounded-full bg-azul-500 animate-pulse" />}{l.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 font-mono mt-4">*Límites de lote y tiempo de espera: verificar contra «Especificaciones de remisión voluntaria» (AEAT).</p>
            </div>
          </section>

          {/* REPRESENTACION */}
          <section data-section className={show(active, 'representacion')}>
            <h1 className="font-display font-700 text-2xl">Representación de terceros</h1>
            <p className="text-slate-500 mt-1 text-sm">Apoderamientos para el envío de registros en nombre de los obligados (Resolución de 18-dic-2024).</p>
            <div className="bg-white border border-slate-200 rounded-2xl mt-6 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-400 text-xs font-mono uppercase"><tr><th className="text-left font-500 px-5 py-3">Representado</th><th className="text-left font-500 px-5 py-3">NIF</th><th className="text-left font-500 px-5 py-3">Documento</th><th className="text-left font-500 px-5 py-3">Vigencia</th><th className="text-left font-500 px-5 py-3">Estado</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {representacion.map((r) => (
                    <tr key={r.nif} className="hover:bg-slate-50">
                      <td className="px-5 py-3">{r.representado}</td>
                      <td className="px-5 py-3 font-mono text-xs">{r.nif}</td>
                      <td className="px-5 py-3 font-mono text-xs">{r.doc}</td>
                      <td className="px-5 py-3 text-slate-500">{r.vigencia}</td>
                      <td className="px-5 py-3"><span className={`pill ${pillTone[r.tone]}`}>{r.estado}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* INCIDENCIAS */}
          <section data-section className={show(active, 'incidencias')}>
            <h1 className="font-display font-700 text-2xl">Incidencias</h1>
            <p className="text-slate-500 mt-1 text-sm">Registros rechazados o con advertencia que requieren tu atención.</p>
            <div className="space-y-3 mt-6">
              {asesoriaIncidencias.map((inc) => (
                <div key={inc.ref} className={`bg-white rounded-2xl p-5 flex gap-4 border ${inc.kind === 'error' ? 'border-rose-200' : 'border-amber-200'}`}>
                  <div className={`h-10 w-10 rounded-xl grid place-items-center shrink-0 ${inc.kind === 'error' ? 'bg-rose-50 text-rose-500' : 'bg-amber-50 text-amber-500'}`}>
                    {inc.kind === 'error'
                      ? <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
                      : <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap"><span className="font-mono text-xs text-slate-400">{inc.ref}</span><span className={`pill ${inc.kind === 'error' ? pillTone.rose : pillTone.amber}`}>{inc.tag}</span></div>
                    <p className="text-sm mt-1">{inc.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

        </main>
      </div>
    </div>
  )
}
