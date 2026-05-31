import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { LogoMark, Wordmark, IconBack } from '../../components/icons.jsx'
import { api } from '../../lib/api.js'
import { scopeQS, APP_ID, DEMO_TENANT_ID } from '../../lib/tenant.js'
import { pillTone } from '../../data/mock.js'

const URL_DEMO = 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=2027-A/000128&fecha=02-01-2027&importe=121.00'

// Single-page verifier (receptor.html). `cotejar()` verifica contra la cadena
// local (verificada / no_consta), revela el resultado y refresca el historial.
export default function Receptor() {
  const [shown, setShown] = useState(false)
  const [cotejos, setCotejos] = useState([])
  const [url, setUrl] = useState(URL_DEMO)
  const [result, setResult] = useState(null)
  const resultRef = useRef(null)

  const loadHistorial = () =>
    api.get(`/api/verifactu/cotejos?${scopeQS()}`).then(setCotejos).catch(() => {})

  useEffect(() => { loadHistorial() }, [])

  useEffect(() => {
    if (shown) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [shown])

  const cotejar = async (payload) => {
    try {
      const res = await api.post('/api/verifactu/cotejo', { appId: APP_ID, tenantId: DEMO_TENANT_ID, ...payload })
      setResult(res)
      await loadHistorial()
    } catch { setResult(null) }
    setShown(true)
  }

  return (
    <div className="font-sans text-tinta antialiased min-h-screen">
      {/* top radial glow over the body's dotted grid */}
      <div className="fixed inset-0 -z-10 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0, rgba(37,99,235,.10), transparent 50%)' }} />

      <header className="h-16 bg-white/80 backdrop-blur border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <LogoMark />
          <Wordmark />
          <span className="pill bg-azul-50 text-azul-600 border border-azul-100 ml-2">Receptor</span>
        </div>
        <Link to="/" className="flex items-center gap-2 text-sm text-slate-500 hover:text-azul-600"><IconBack />Cambiar de rol</Link>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="text-center reveal">
          <h1 className="font-display font-800 text-3xl sm:text-4xl tracking-tight">Verifica una factura recibida</h1>
          <p className="text-slate-500 mt-3 max-w-xl mx-auto">Escanea el QR o introduce la URL de cotejo para comprobar su autenticidad en la Sede Electrónica de la AEAT.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-5 mt-10">
          {/* escaner */}
          <div className="reveal bg-white border border-slate-200 rounded-2xl p-6" style={{ animationDelay: '.08s' }}>
            <h3 className="font-600 text-sm mb-4">Escanear código QR</h3>
            <div className="relative aspect-square rounded-xl bg-slate-900 grid place-items-center overflow-hidden">
              <div className="absolute left-6 right-6 h-0.5 bg-azul-400 shadow-[0_0_12px_2px_rgba(79,125,255,.8)]" style={{ animation: 'scan 2.2s ease-in-out infinite', top: 0 }} />
              <svg width="120" height="120" viewBox="0 0 29 29" shapeRendering="crispEdges" className="opacity-90"><g fill="#4f7dff"><rect x="0" y="0" width="7" height="7" /><rect x="2" y="2" width="3" height="3" fill="#0b1220" /><rect x="22" y="0" width="7" height="7" /><rect x="24" y="2" width="3" height="3" fill="#0b1220" /><rect x="0" y="22" width="7" height="7" /><rect x="2" y="24" width="3" height="3" fill="#0b1220" /><rect x="9" y="1" width="1" height="1" /><rect x="11" y="0" width="1" height="2" /><rect x="13" y="9" width="1" height="3" /><rect x="16" y="10" width="2" height="1" /><rect x="20" y="9" width="1" height="2" /><rect x="23" y="10" width="2" height="2" /><rect x="9" y="13" width="3" height="1" /><rect x="15" y="14" width="2" height="2" /><rect x="19" y="13" width="1" height="2" /><rect x="25" y="13" width="2" height="2" /><rect x="9" y="18" width="2" height="1" /><rect x="15" y="18" width="2" height="2" /><rect x="21" y="18" width="1" height="2" /><rect x="9" y="22" width="1" height="3" /><rect x="14" y="22" width="1" height="2" /><rect x="19" y="22" width="2" height="2" /></g></svg>
              <div className="absolute inset-0 border-2 border-azul-500/30 m-4 rounded-lg pointer-events-none" />
            </div>
            <button onClick={() => cotejar({ numSerie: '2027-A/000128' })} className="mt-4 w-full bg-azul-500 hover:bg-azul-600 text-white text-sm font-600 py-3 rounded-xl shadow-lg shadow-azul-500/25">Simular escaneo y cotejar</button>
          </div>

          {/* url */}
          <div className="reveal bg-white border border-slate-200 rounded-2xl p-6 flex flex-col" style={{ animationDelay: '.16s' }}>
            <h3 className="font-600 text-sm mb-4">O introduce la URL / datos</h3>
            <label className="text-xs text-slate-400 font-mono">URL de cotejo</label>
            <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} className="mt-1.5 w-full text-xs font-mono p-3 rounded-xl bg-slate-50 border border-slate-200 focus:border-azul-400 focus:ring-2 focus:ring-azul-100 outline-none" />
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div><label className="text-xs text-slate-400 font-mono">NIF emisor</label><input defaultValue="B12345678" className="mt-1.5 w-full text-sm font-mono p-2.5 rounded-xl bg-slate-50 border border-slate-200 outline-none" /></div>
              <div><label className="text-xs text-slate-400 font-mono">Importe</label><input defaultValue="121,00" className="mt-1.5 w-full text-sm font-mono p-2.5 rounded-xl bg-slate-50 border border-slate-200 outline-none" /></div>
            </div>
            <button onClick={() => cotejar({ url })} className="mt-auto pt-4"><span className="block w-full border border-azul-200 text-azul-600 hover:bg-azul-50 text-sm font-600 py-3 rounded-xl">Cotejar en sede AEAT</span></button>
            <p className="text-[11px] text-slate-400 font-mono mt-3">Parámetros y dominio reales: verificar contra «Características del QR» (AEAT).</p>
          </div>
        </div>

        {/* resultado */}
        <div ref={resultRef} className={`mt-5 ${shown ? '' : 'hidden'}`}>
          {result?.verificada ? (
            <div className="bg-white border border-emerald-200 rounded-2xl p-6 reveal">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-xl bg-emerald-50 grid place-items-center text-emerald-600"><svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg></div>
                <div><div className="font-display font-700 text-lg">Factura verificada</div><div className="text-sm text-slate-500">Consta en los registros del SIF y los datos coinciden.</div></div>
                <span className="pill bg-emerald-50 text-emerald-600 ml-auto">VERI·FACTU</span>
              </div>
              <div className="grid sm:grid-cols-4 gap-4 mt-5 text-sm">
                <div className="border-l-2 border-slate-100 pl-3"><div className="text-xs text-slate-400">Emisor</div><div className="font-600">{result.emisor?.nombre ?? '—'}</div></div>
                <div className="border-l-2 border-slate-100 pl-3"><div className="text-xs text-slate-400">NIF</div><div className="font-mono">{result.emisor?.nif ?? '—'}</div></div>
                <div className="border-l-2 border-slate-100 pl-3"><div className="text-xs text-slate-400">Nº factura</div><div className="font-mono">{result.numSerie ?? '—'}</div></div>
                <div className="border-l-2 border-slate-100 pl-3"><div className="text-xs text-slate-400">Importe</div><div className="font-mono">{result.importe ?? '—'}</div></div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-rose-200 rounded-2xl p-6 reveal">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-xl bg-rose-50 grid place-items-center text-rose-500"><svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></svg></div>
                <div><div className="font-display font-700 text-lg">No consta</div><div className="text-sm text-slate-500">La factura {result?.numSerie ?? ''} no figura en los registros del SIF.</div></div>
                <span className="pill bg-rose-50 text-rose-600 ml-auto">No consta</span>
              </div>
            </div>
          )}
        </div>

        {/* historial */}
        <div className="mt-10 reveal" style={{ animationDelay: '.24s' }}>
          <h3 className="font-600 text-sm mb-3">Comprobaciones recientes</h3>
          <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
            {cotejos.map((c, i) => (
              <div key={`${c.ref}-${i}`} className="flex items-center gap-4 p-4"><span className={`pill ${pillTone[c.tone] ?? pillTone.ok}`}>{c.label}</span><span className="text-sm flex-1 font-mono text-slate-500">{c.ref}</span><span className="text-xs font-mono text-slate-400">{c.ts}</span></div>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white/60 mt-8"><div className="max-w-5xl mx-auto px-6 py-5 text-center text-xs text-slate-400 font-mono">El cotejo se realiza contra la Sede Electrónica de la AEAT · datos simulados en esta demo</div></footer>
    </div>
  )
}
