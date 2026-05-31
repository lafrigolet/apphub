import { useState } from 'react'
import Sidebar from '../../components/Sidebar.jsx'
import { Wordmark } from '../../components/icons.jsx'
import { useSection } from '../../hooks/index.js'
import { api } from '../../lib/api.js'
import { pillTone, devTests, devEsquemas, devDeclaracion } from '../../data/mock.js'

const navItems = [
  { id: 'pruebas', label: 'Entorno de pruebas', icon: <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 2v6l-5 9a2 2 0 002 3h12a2 2 0 002-3l-5-9V2" /><path d="M7 2h10" /></svg> },
  { id: 'esquemas', label: 'Esquemas & WSDL', icon: <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6" /></svg> },
  { id: 'validador', label: 'Validador', icon: <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg> },
  { id: 'declaracion', label: 'Declaración resp.', icon: <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M9 15l2 2 4-4" /></svg> },
]

const show = (active, id) => `${active === id ? '' : 'hidden'}`

function EsquemaIcon({ e }) {
  if (e.kind === 'text') {
    return <div className={`h-11 w-11 rounded-xl bg-azul-50 grid place-items-center text-azul-600 font-mono font-700 ${e.badge === 'WSDL' ? 'text-[10px]' : 'text-xs'}`}>{e.badge}</div>
  }
  if (e.kind === 'chain') {
    return <div className="h-11 w-11 rounded-xl bg-azul-50 grid place-items-center text-azul-600"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1" /></svg></div>
  }
  return <div className="h-11 w-11 rounded-xl bg-azul-50 grid place-items-center text-azul-600"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg></div>
}

const REGISTRO_MUESTRA = JSON.stringify({
  idEmisor: 'B12345678',
  numSerie: '2027-A/000128',
  fechaExpedicion: '02-01-2027',
  tipoFactura: 'F1',
  cuotaTotal: '21.00',
  importeTotal: '121.00',
}, null, 2)

const CHECK_COLOR = { ok: 'text-emerald-700', warn: 'text-amber-600', error: 'text-rose-600' }

export default function Desarrollador() {
  const [active, go] = useSection('pruebas')
  const [vres, setVres] = useState('idle') // idle | validating | done | parse-error
  const [vinput, setVinput] = useState(REGISTRO_MUESTRA)
  const [vchecks, setVchecks] = useState([])

  const validar = async () => {
    let registro
    try {
      registro = JSON.parse(vinput)
    } catch {
      setVres('parse-error')
      return
    }
    setVres('validating')
    try {
      const r = await api.post('/api/verifactu/validar', { registro })
      setVchecks(r.checks ?? [])
    } catch {
      setVchecks([{ level: 'error', mensaje: 'No se pudo validar (error de red)' }])
    }
    setVres('done')
  }

  return (
    <div className="flex min-h-screen font-sans text-tinta antialiased">
      <Sidebar items={navItems} active={active} onSelect={go} />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white/80 backdrop-blur border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <Wordmark className="lg:hidden font-display font-700" />
            <span className="pill bg-azul-50 text-azul-600 border border-azul-100">Desarrollador / Fabricante</span>
          </div>
          <span className="hidden sm:flex pill bg-slate-900 text-azul-200 font-mono">SIF · FacturaNode v1.0</span>
        </header>

        <main className="p-6 max-w-6xl w-full mx-auto">

          {/* PRUEBAS */}
          <section data-section className={show(active, 'pruebas')}>
            <h1 className="font-display font-700 text-2xl">Entorno de pruebas externas</h1>
            <p className="text-slate-500 mt-1 text-sm">Valida tu integración sin efectos fiscales. No constituye homologación.</p>
            <div className="grid md:grid-cols-3 gap-4 mt-6">
              <div className="md:col-span-2 bg-white border border-slate-200 rounded-2xl p-5">
                <div className="flex items-center justify-between"><h3 className="font-600">Conexión sandbox</h3><span className="pill bg-emerald-50 text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Conectado</span></div>
                <div className="mt-4 code"><span className="tc"># endpoint de pruebas</span><br />POST <span className="tg">https://preportal.aeat.es</span>/...<br /><span className="tk">Content-Type</span>: application/soap+xml<br /><span className="tk">Client-Cert</span>: <span className="tg">SIF_test.p12</span> <span className="tc">(mTLS)</span></div>
                <p className="text-[11px] text-slate-400 font-mono mt-3">URL y requisitos de certificado de test: verificar en el portal de desarrolladores AEAT.</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between">
                <div><div className="text-xs font-mono text-slate-400 uppercase">Tests superados</div><div className="font-display font-800 text-4xl mt-2">47<span className="text-lg text-slate-300">/52</span></div></div>
                <div className="mt-4 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-azul-500 rounded-full" style={{ width: '90%' }} /></div>
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl mt-4 divide-y divide-slate-100">
              {devTests.map((t) => (
                <div key={t.text} className="flex items-center gap-4 p-4"><span className={`pill ${t.result === 'PASS' ? pillTone.emerald : pillTone.rose}`}>{t.result}</span><span className="text-sm flex-1">{t.text}</span><span className="font-mono text-xs text-slate-400">{t.detail}</span></div>
              ))}
            </div>
          </section>

          {/* ESQUEMAS */}
          <section data-section className={show(active, 'esquemas')}>
            <h1 className="font-display font-700 text-2xl">Esquemas &amp; WSDL</h1>
            <p className="text-slate-500 mt-1 text-sm">Artefactos técnicos publicados por la AEAT. Versión vigente a verificar contra fuente oficial.</p>
            <div className="grid sm:grid-cols-2 gap-4 mt-6">
              {devEsquemas.map((e) => (
                <div key={e.title} className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center gap-4">
                  <EsquemaIcon e={e} />
                  <div className="flex-1"><div className="font-600 text-sm">{e.title}</div><div className="text-xs text-slate-400 font-mono">{e.meta}</div></div>
                  <span className="pill bg-slate-100 text-slate-500">{e.action}</span>
                </div>
              ))}
            </div>
          </section>

          {/* VALIDADOR */}
          <section data-section className={show(active, 'validador')}>
            <h1 className="font-display font-700 text-2xl">Validador de registros</h1>
            <p className="text-slate-500 mt-1 text-sm">Validación estructural + integridad de huella del registro (no es la validación XSD oficial — verificar fuente AEAT).</p>
            <div className="grid lg:grid-cols-2 gap-4 mt-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3"><h3 className="font-600 text-sm">Registro (JSON)</h3><button onClick={validar} className="text-xs bg-azul-500 text-white px-3 py-1.5 rounded-lg font-600">Validar</button></div>
                <textarea value={vinput} onChange={(e) => setVinput(e.target.value)} spellCheck={false} rows={9} className="code w-full resize-y" style={{ width: '100%' }} />
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <h3 className="font-600 text-sm mb-3">Resultado</h3>
                {vres === 'idle' && <div className="text-sm text-slate-400 font-mono">Pulsa «Validar» para comprobar el registro.</div>}
                {vres === 'parse-error' && <div className="text-sm font-mono text-rose-600">JSON inválido — revisa la sintaxis.</div>}
                {vres === 'validating' && <div className="text-sm font-mono text-slate-400">Validando…</div>}
                {vres === 'done' && (
                  <div className="text-sm font-mono space-y-2">
                    <div className={`pill ${vchecks.some((c) => c.level === 'error') ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                      {vchecks.some((c) => c.level === 'error') ? 'NO conforme' : 'Conforme'}
                    </div>
                    {vchecks.map((c, i) => (
                      <div key={i} className={CHECK_COLOR[c.level] ?? 'text-slate-500'}>
                        {c.level === 'ok' ? '✓' : c.level === 'warn' ? '⚠' : '✕'} {c.mensaje}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* DECLARACION */}
          <section data-section className={show(active, 'declaracion')}>
            <h1 className="font-display font-700 text-2xl">Declaración responsable</h1>
            <p className="text-slate-500 mt-1 text-sm">VeriFactu no se homologa: el fabricante declara la conformidad del SIF con el RRSIF.</p>
            <div className="bg-white border border-slate-200 rounded-2xl p-6 mt-6 max-w-2xl">
              <div className="space-y-3 text-sm">
                {devDeclaracion.map((d) => (
                  <div key={d.label} className="flex justify-between border-b border-slate-100 pb-2"><span className="text-slate-400">{d.label}</span><span className={d.mono ? 'font-mono' : 'font-600'}>{d.value}</span></div>
                ))}
                <div className="flex justify-between"><span className="text-slate-400">Conformidad RD 1007/2023</span><span className="pill bg-emerald-50 text-emerald-600">Declarada</span></div>
              </div>
              <div className="mt-5 p-4 rounded-xl bg-azul-50 border border-azul-100 text-xs text-azul-800 font-mono">Contenido exacto: verificar contra la Orden HAC/1177/2024 y los ejemplos oficiales de declaración responsable.</div>
            </div>
          </section>

        </main>
      </div>
    </div>
  )
}
