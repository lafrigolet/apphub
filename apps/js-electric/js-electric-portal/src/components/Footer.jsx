import { footerCols } from '../data/mock.js'

const socialLinks = [
  {
    name: 'Instagram',
    icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c2.717 0 3.056.01 4.122.06 1.065.05 1.79.217 2.428.465.66.254 1.216.598 1.772 1.153a4.908 4.908 0 011.153 1.772c.247.637.415 1.363.465 2.428.047 1.066.06 1.405.06 4.122 0 2.717-.01 3.056-.06 4.122-.05 1.065-.218 1.79-.465 2.428a4.883 4.883 0 01-1.153 1.772 4.915 4.915 0 01-1.772 1.153c-.637.247-1.363.415-2.428.465-1.066.047-1.405.06-4.122.06-2.717 0-3.056-.01-4.122-.06-1.065-.05-1.79-.218-2.428-.465a4.89 4.89 0 01-1.772-1.153 4.904 4.904 0 01-1.153-1.772c-.248-.637-.415-1.363-.465-2.428C2.013 15.056 2 14.717 2 12c0-2.717.01-3.056.06-4.122.05-1.066.217-1.79.465-2.428a4.88 4.88 0 011.153-1.772A4.897 4.897 0 015.45 2.525c.638-.248 1.362-.415 2.428-.465C8.944 2.013 9.283 2 12 2zm0 5a5 5 0 100 10 5 5 0 000-10zm6.5-.25a1.25 1.25 0 10-2.5 0 1.25 1.25 0 002.5 0zM12 9a3 3 0 110 6 3 3 0 010-6z" /></svg>,
  },
  {
    name: 'LinkedIn',
    icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h14zM8 17v-7H5.5v7H8zM6.75 8.75A1.5 1.5 0 108.5 7.25a1.5 1.5 0 00-1.75 1.5zM18.5 17v-4.4c0-2.1-1.13-3.1-2.65-3.1a2.3 2.3 0 00-2.1 1.15V10H11.4v7h2.4v-3.7c0-1.04.2-2.05 1.5-2.05 1.27 0 1.27 1.2 1.27 2.12V17h1.93z" /></svg>,
  },
  {
    name: 'Facebook',
    icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12a12 12 0 10-13.875 11.85V15.47H7.078V12h3.047V9.36c0-3.007 1.79-4.668 4.532-4.668 1.312 0 2.686.234 2.686.234v2.953H15.83c-1.491 0-1.956.925-1.956 1.875V12h3.328l-.532 3.47h-2.796v8.38A12 12 0 0024 12z" /></svg>,
  },
]

export default function Footer() {
  return (
    <footer className="bg-ink-900 text-white/70 border-t border-white/5">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-14">
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-10 mb-12">
          <div className="lg:col-span-2">
            <a href="#inicio" className="flex items-center gap-2.5 mb-5">
              <span className="relative inline-flex items-center justify-center w-10 h-10 rounded-xl bg-electric-500 text-white">
                <span className="font-display font-bold text-sm tracking-tight">JS</span>
              </span>
              <span className="font-display text-xl font-semibold tracking-tight text-white">JS Electric<span className="text-electric-400">.</span></span>
            </a>
            <p className="text-sm leading-relaxed max-w-xs mb-5">
              Electricistas, climatización y energía solar. Tu transición energética, llave en mano.
            </p>
            <div className="flex gap-2">
              {socialLinks.map((s) => (
                <a key={s.name} href="#" className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition" aria-label={s.name}>{s.icon}</a>
              ))}
            </div>
          </div>

          {footerCols.map((col) => (
            <FooterCol key={col.title} title={col.title} items={col.items} />
          ))}
        </div>

        <div className="pt-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs text-white/50 border-t border-white/10">
          <div>© 2026 JS Electric S.L. · CIF B12345678 · Todos los derechos reservados.</div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 spark-dot"></span>
            <span>Aceptando proyectos · Próxima cita en 3 días</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

function FooterCol({ title, items }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-white/50 mb-4">{title}</div>
      <ul className="space-y-2.5 text-sm">
        {items.map((item) => (
          <li key={item.label}><a href={item.href} className="hover:text-white transition">{item.label}</a></li>
        ))}
      </ul>
    </div>
  )
}
