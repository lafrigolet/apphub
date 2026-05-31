import { Link } from 'react-router-dom'
import { roles } from '../data/roles.js'
import { LogoMark, Wordmark, IconArrowRight } from '../components/icons.jsx'

// Per-role card icon, keyed by role id (kept out of the data layer).
const roleIcons = {
  emisor: (
    <svg className="w-5.5 h-5.5" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h6" /></svg>
  ),
  asesoria: (
    <svg className="w-5.5 h-5.5" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>
  ),
  desarrollador: (
    <svg className="w-5.5 h-5.5" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6" /></svg>
  ),
  administrador: (
    <svg className="w-5.5 h-5.5" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1l9 4v6c0 5-3.8 9.4-9 11-5.2-1.6-9-6-9-11V5z" /><path d="M9 12l2 2 4-4" /></svg>
  ),
  receptor: (
    <svg className="w-5.5 h-5.5" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM21 14v7M17 21h4" /></svg>
  ),
}

// Prototype role hub (index.html): hero + selector grid of the 5 role SPAs.
export default function RoleSelector() {
  return (
    <div className="font-sans text-tinta min-h-screen antialiased">
      {/* top radial glow layered over the body's dotted grid */}
      <div className="fixed inset-0 -z-10 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% -10%, rgba(37,99,235,.12), transparent 55%)' }} />

      {/* NAV */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-white/70 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <Wordmark className="font-display font-700 tracking-tight text-[17px]" />
            <span className="ml-2 text-[11px] font-mono px-2 py-0.5 rounded-full bg-azul-50 text-azul-600 border border-azul-100">portal</span>
          </div>
          <div className="hidden sm:flex items-center gap-6 text-sm text-slate-500">
            <span className="font-mono text-xs">v1.0</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />Servicios AEAT · operativo</span>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 grid-line opacity-60 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="relative max-w-7xl mx-auto px-6 pt-16 pb-10">
          <div className="reveal" style={{ animationDelay: '.05s' }}>
            <span className="inline-flex items-center gap-2 text-xs font-mono px-3 py-1 rounded-full bg-white border border-slate-200 text-slate-600 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-azul-500" />Sistema de facturación verificable · AEAT
            </span>
          </div>
          <h1 className="reveal font-display font-800 tracking-tight text-4xl sm:text-5xl lg:text-[56px] leading-[1.05] mt-5 max-w-3xl" style={{ animationDelay: '.12s' }}>
            Gestiona tus <span className="text-azul-500">VeriFactu</span><br />desde un único panel.
          </h1>
          <p className="reveal mt-5 text-slate-600 text-lg max-w-2xl leading-relaxed" style={{ animationDelay: '.2s' }}>
            Emisión, encadenamiento por huella, firma, remisión a la Sede Electrónica y cotejo. Elige tu rol para acceder al espacio de trabajo correspondiente.
          </p>
          <div className="reveal mt-7 flex flex-wrap gap-x-7 gap-y-2 text-sm text-slate-500" style={{ animationDelay: '.28s' }}>
            <span className="flex items-center gap-2 font-mono text-xs"><svg className="w-4 h-4 text-azul-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>SHA-256 encadenado</span>
            <span className="flex items-center gap-2 font-mono text-xs"><svg className="w-4 h-4 text-azul-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h7v7h-7z" /></svg>QR de cotejo</span>
          </div>
        </div>
      </section>

      {/* ROLES */}
      <main className="max-w-7xl mx-auto px-6 pb-24">
        <div className="flex items-end justify-between mb-6 reveal" style={{ animationDelay: '.3s' }}>
          <h2 className="font-display font-700 text-lg">Selecciona tu rol</h2>
          <span className="text-xs font-mono text-slate-400">5 espacios de trabajo</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {roles.map((r, i) => (
            <Link key={r.id} to={r.to} className="card-role reveal group bg-white border border-slate-200 rounded-2xl p-6 flex flex-col" style={{ animationDelay: `${0.34 + i * 0.06}s` }}>
              <div className="flex items-start justify-between">
                <div className="h-11 w-11 rounded-xl bg-azul-50 border border-azul-100 grid place-items-center text-azul-600">
                  {roleIcons[r.id]}
                </div>
                <span className={r.badge.primary
                  ? 'text-[10px] font-mono uppercase tracking-wider text-azul-600 bg-azul-50 px-2 py-1 rounded-md'
                  : 'text-[10px] font-mono uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-1 rounded-md'}>
                  {r.badge.label}
                </span>
              </div>
              <h3 className="font-display font-700 text-lg mt-4">{r.title}</h3>
              <p className="text-sm text-slate-500 mt-1.5 leading-relaxed flex-1">{r.desc}</p>
              <ul className="mt-4 space-y-1.5 text-xs text-slate-500 font-mono">
                {r.bullets.map((b) => (
                  <li key={b} className="flex gap-2"><span className="text-azul-500">›</span>{b}</li>
                ))}
              </ul>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-600 text-azul-600">Entrar <IconArrowRight /></span>
            </Link>
          ))}

          {/* INFO CARD */}
          <div className="reveal rounded-2xl p-6 flex flex-col justify-between bg-azul-600 text-white relative overflow-hidden" style={{ animationDelay: '.64s' }}>
            <div className="absolute inset-0 grid-line opacity-30" />
            <div className="relative">
              <span className="text-[10px] font-mono uppercase tracking-wider bg-white/15 px-2 py-1 rounded-md">Nota</span>
              <h3 className="font-display font-700 text-lg mt-4 leading-snug">VeriFactu no se homologa.</h3>
              <p className="text-sm text-azul-100 mt-2 leading-relaxed">La conformidad se acredita mediante <b className="text-white">declaración responsable</b> del fabricante. La validación técnica se realiza en el portal de pruebas externas de la AEAT.</p>
            </div>
            <div className="relative mt-5 font-mono text-xs text-azul-100 border-t border-white/15 pt-4">
              preportal.aeat.es
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white/60">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400 font-mono">
          <span>VERI·FACTU · interfaz de demostración · datos simulados</span>
          <span>RD 1007/2023 · RD 254/2025 · Orden HAC/1177/2024</span>
        </div>
      </footer>
    </div>
  )
}
