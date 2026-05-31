import Sidebar from '../../components/Sidebar.jsx'
import { Wordmark, IconPlus } from '../../components/icons.jsx'
import { useSection } from '../../hooks/index.js'
import {
  pillTone, emisorEstadoLabel, emisorFacturas, emisorRemisiones, emisorCadena, emisorEventos,
} from '../../data/mock.js'

const navItems = [
  { id: 'resumen', label: 'Resumen', icon: <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg> },
  { id: 'facturas', label: 'Facturas', icon: <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></svg> },
  { id: 'cadena', label: 'Cadena / Integridad', icon: <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1" /><path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" /></svg> },
  { id: 'qr', label: 'QR & Cotejo', icon: <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3z" /></svg> },
  { id: 'eventos', label: 'Eventos', icon: <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="9" /></svg> },
]

const show = (active, id) => `${active === id ? '' : 'hidden'}`

export default function Emisor() {
  const [active, go] = useSection('resumen')

  return (
    <div className="flex min-h-screen font-sans text-tinta antialiased">
      <Sidebar items={navItems} active={active} onSelect={go} />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white/80 backdrop-blur border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <Wordmark className="lg:hidden font-display font-700" />
            <span className="pill bg-azul-50 text-azul-600 border border-azul-100">Emisor / Obligado</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:flex pill bg-emerald-50 text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Modalidad VERI·FACTU</span>
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-azul-100 grid place-items-center text-azul-700 text-xs font-700">EJ</div>
              <div className="hidden sm:block leading-tight">
                <div className="text-sm font-600">Ejemplo S.L.</div>
                <div className="text-[11px] font-mono text-slate-400">B12345678</div>
              </div>
            </div>
          </div>
        </header>

        <main className="p-6 max-w-6xl w-full mx-auto">

          {/* RESUMEN */}
          <section data-section className={show(active, 'resumen')}>
            <h1 className="font-display font-700 text-2xl">Buenas tardes, Ejemplo S.L.</h1>
            <p className="text-slate-500 mt-1 text-sm">Resumen de tu actividad de facturación verificable.</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-5"><div className="text-xs font-mono text-slate-400 uppercase tracking-wider">Emitidas (mes)</div><div className="font-display font-800 text-3xl mt-2">128</div><div className="text-xs text-emerald-600 mt-1">+12% vs anterior</div></div>
              <div className="bg-white border border-slate-200 rounded-2xl p-5"><div className="text-xs font-mono text-slate-400 uppercase tracking-wider">Remitidas OK</div><div className="font-display font-800 text-3xl mt-2">124</div><div className="text-xs text-slate-400 mt-1">96,9% aceptadas</div></div>
              <div className="bg-white border border-slate-200 rounded-2xl p-5"><div className="text-xs font-mono text-slate-400 uppercase tracking-wider">Con advertencia</div><div className="font-display font-800 text-3xl mt-2 text-amber-500">3</div><div className="text-xs text-slate-400 mt-1">errores admisibles</div></div>
              <div className="bg-white border border-slate-200 rounded-2xl p-5"><div className="text-xs font-mono text-slate-400 uppercase tracking-wider">Rechazadas</div><div className="font-display font-800 text-3xl mt-2 text-rose-500">1</div><div className="text-xs text-slate-400 mt-1">requiere corrección</div></div>
            </div>

            <div className="grid lg:grid-cols-3 gap-4 mt-4">
              <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-600">Remisiones recientes</h3>
                  <button onClick={() => go('facturas')} className="text-xs text-azul-600 font-600">Ver todas →</button>
                </div>
                <div className="space-y-2.5">
                  {emisorRemisiones.map((r) => (
                    <div key={r.serie} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <div className="flex items-center gap-3"><span className="font-mono text-xs text-slate-400">{r.serie}</span><span className="text-sm">{r.cliente}</span></div>
                      <span className={`pill ${pillTone[r.tone]}`}>{r.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col">
                <h3 className="font-600 mb-3">Integridad de la cadena</h3>
                <div className="flex-1 grid place-items-center py-2">
                  <div className="relative h-28 w-28">
                    <svg className="h-28 w-28 -rotate-90" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" fill="none" stroke="#e2e8f0" strokeWidth="3" /><circle cx="18" cy="18" r="15.5" fill="none" stroke="#2563eb" strokeWidth="3" strokeDasharray="97 100" strokeLinecap="round" /></svg>
                    <div className="absolute inset-0 grid place-items-center"><div className="text-center"><div className="font-display font-800 text-xl">OK</div><div className="text-[10px] font-mono text-slate-400">verificada</div></div></div>
                  </div>
                </div>
                <p className="text-xs text-slate-400 text-center font-mono">128/128 registros encadenados</p>
              </div>
            </div>
          </section>

          {/* FACTURAS */}
          <section data-section className={show(active, 'facturas')}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div><h1 className="font-display font-700 text-2xl">Facturas</h1><p className="text-slate-500 mt-1 text-sm">Registros de alta y anulación remitidos.</p></div>
              <button className="bg-azul-500 hover:bg-azul-600 text-white text-sm font-600 px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-lg shadow-azul-500/25"><IconPlus />Nueva factura</button>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl mt-6 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-400 text-xs font-mono uppercase tracking-wider">
                    <tr><th className="text-left font-500 px-5 py-3">Serie/Número</th><th className="text-left font-500 px-5 py-3">Cliente</th><th className="text-left font-500 px-5 py-3">Fecha</th><th className="text-right font-500 px-5 py-3">Total</th><th className="text-left font-500 px-5 py-3">Estado</th><th className="text-left font-500 px-5 py-3">Huella</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {emisorFacturas.map((f) => (
                      <tr key={f.serie} className="hover:bg-slate-50">
                        <td className="px-5 py-3 font-mono text-xs">{f.serie}</td>
                        <td className="px-5 py-3">{f.cliente}</td>
                        <td className="px-5 py-3 text-slate-500 font-mono text-xs">{f.fecha}</td>
                        <td className="px-5 py-3 text-right font-mono">{f.total}</td>
                        <td className="px-5 py-3"><span className={`pill ${pillTone[f.estado]}`}>{emisorEstadoLabel[f.estado]}</span></td>
                        <td className="px-5 py-3 font-mono text-xs text-slate-400">{f.huella}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* CADENA */}
          <section data-section className={show(active, 'cadena')}>
            <h1 className="font-display font-700 text-2xl">Cadena / Integridad</h1>
            <p className="text-slate-500 mt-1 text-sm">Encadenamiento de registros mediante huella SHA-256. Cada registro enlaza con el anterior.</p>
            <div className="bg-white border border-slate-200 rounded-2xl p-6 mt-6">
              <div className="space-y-0">
                {emisorCadena.map((c, i) => {
                  const last = i === emisorCadena.length - 1
                  return (
                    <div key={c.n} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className={`h-9 w-9 rounded-full grid place-items-center text-xs font-700 ${c.current ? 'bg-azul-500 text-white' : 'bg-azul-100 text-azul-700'}`}>{c.n}</div>
                        {!last && <div className="w-px flex-1 bg-azul-200" />}
                      </div>
                      <div className={`${last ? 'flex-1' : 'pb-6 flex-1'}`}>
                        <div className="flex items-center gap-2"><span className="font-mono text-sm">{c.serie}</span><span className="pill bg-emerald-50 text-emerald-600">verificado</span></div>
                        <div className="font-mono text-xs text-slate-400 mt-1 break-all">huella: {c.huella}</div>
                        {c.anterior && <div className="font-mono text-xs text-slate-300 break-all">anterior: {c.anterior}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-6 p-4 rounded-xl bg-azul-50 border border-azul-100 text-sm text-azul-800 flex gap-3">
                <svg className="w-5 h-5 shrink-0 mt-0.5 text-azul-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>
                <div><b>Cadena íntegra.</b> El orden de campos y el formato de cálculo de la huella deben replicar el documento oficial de algoritmo de hash de la AEAT. <span className="text-azul-600 font-mono text-xs">(verificar contra fuente oficial)</span></div>
              </div>
            </div>
          </section>

          {/* QR */}
          <section data-section className={show(active, 'qr')}>
            <h1 className="font-display font-700 text-2xl">QR &amp; Cotejo</h1>
            <p className="text-slate-500 mt-1 text-sm">Código QR y URL de cotejo que se incorporan a la factura para su verificación en la Sede Electrónica.</p>
            <div className="grid md:grid-cols-2 gap-4 mt-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center">
                <div className="p-4 bg-white border border-slate-200 rounded-xl">
                  <svg width="150" height="150" viewBox="0 0 29 29" shapeRendering="crispEdges"><rect width="29" height="29" fill="#fff" /><g fill="#0b1220"><rect x="0" y="0" width="7" height="7" /><rect x="2" y="2" width="3" height="3" fill="#fff" /><rect x="22" y="0" width="7" height="7" /><rect x="24" y="2" width="3" height="3" fill="#fff" /><rect x="0" y="22" width="7" height="7" /><rect x="2" y="24" width="3" height="3" fill="#fff" /><rect x="9" y="1" width="1" height="1" /><rect x="11" y="0" width="1" height="2" /><rect x="13" y="1" width="2" height="1" /><rect x="16" y="0" width="1" height="1" /><rect x="18" y="1" width="2" height="1" /><rect x="9" y="9" width="2" height="2" /><rect x="13" y="9" width="1" height="3" /><rect x="16" y="10" width="2" height="1" /><rect x="20" y="9" width="1" height="2" /><rect x="23" y="10" width="2" height="2" /><rect x="26" y="9" width="1" height="3" /><rect x="9" y="13" width="3" height="1" /><rect x="15" y="14" width="2" height="2" /><rect x="19" y="13" width="1" height="2" /><rect x="22" y="14" width="2" height="1" /><rect x="25" y="13" width="2" height="2" /><rect x="9" y="18" width="2" height="1" /><rect x="12" y="17" width="1" height="2" /><rect x="15" y="18" width="2" height="2" /><rect x="18" y="17" width="2" height="1" /><rect x="21" y="18" width="1" height="2" /><rect x="24" y="17" width="2" height="2" /><rect x="27" y="18" width="1" height="2" /><rect x="9" y="22" width="1" height="3" /><rect x="11" y="23" width="2" height="1" /><rect x="14" y="22" width="1" height="2" /><rect x="16" y="24" width="2" height="1" /><rect x="19" y="22" width="2" height="2" /><rect x="23" y="23" width="1" height="3" /><rect x="26" y="22" width="2" height="1" /></g></svg>
                </div>
                <span className="pill bg-azul-50 text-azul-600 mt-4">VERI·FACTU</span>
                <p className="text-xs text-slate-400 mt-2 font-mono">Factura 2027-A/000128</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-6">
                <h3 className="font-600 text-sm">URL de cotejo</h3>
                <div className="mt-2 p-3 rounded-xl bg-slate-900 text-azul-200 font-mono text-xs break-all leading-relaxed">https://sede.agenciatributaria.gob.es/.../cotejo?nif=B12345678&numserie=2027-A/000128&fecha=02-01-2027&importe=121.00</div>
                <p className="text-[11px] text-slate-400 font-mono mt-2">El dominio, parámetros y orden exactos se toman de «Características del QR» (verificar contra fuente oficial).</p>
                <div className="mt-5 space-y-3 text-sm">
                  <div className="flex justify-between border-b border-slate-100 pb-2"><span className="text-slate-400">NIF emisor</span><span className="font-mono">B12345678</span></div>
                  <div className="flex justify-between border-b border-slate-100 pb-2"><span className="text-slate-400">Nº factura</span><span className="font-mono">2027-A/000128</span></div>
                  <div className="flex justify-between border-b border-slate-100 pb-2"><span className="text-slate-400">Importe</span><span className="font-mono">121,00 €</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Estado cotejo</span><span className="pill bg-emerald-50 text-emerald-600">Cotejable</span></div>
                </div>
              </div>
            </div>
          </section>

          {/* EVENTOS */}
          <section data-section className={show(active, 'eventos')}>
            <h1 className="font-display font-700 text-2xl">Eventos del sistema</h1>
            <p className="text-slate-500 mt-1 text-sm">Registro de eventos del SIF exigido por el reglamento (catálogo a verificar contra la Orden HAC/1177/2024).</p>
            <div className="bg-white border border-slate-200 rounded-2xl mt-6 divide-y divide-slate-100">
              {emisorEventos.map((e) => (
                <div key={e.ts} className="flex items-center gap-4 p-4"><span className={`pill ${pillTone[e.tone]}`}>{e.tag}</span><span className="text-sm flex-1">{e.text}</span><span className="font-mono text-xs text-slate-400">{e.ts}</span></div>
              ))}
            </div>
          </section>

        </main>
      </div>
    </div>
  )
}
