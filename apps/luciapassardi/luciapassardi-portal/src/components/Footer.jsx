import { navLinks, contacto } from '../data/content.js'
import { Leaf, Whatsapp, Instagram, Mail } from './icons.jsx'

export default function Footer() {
  const year = 2026 // estampar al construir; evita Date.now en runtime
  return (
    <footer className="bg-tinta text-crema/80">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-16">
        <div className="grid md:grid-cols-3 gap-10">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <span className="w-9 h-9 rounded-full bg-salvia-400/25 text-salvia-400 flex items-center justify-center">
                <Leaf className="w-5 h-5" />
              </span>
              <span className="display text-2xl text-crema">Lucía Passardi</span>
            </div>
            <p className="display text-xl italic text-salvia-400">Respira… y avanza.</p>
            <p className="text-sm text-crema/55 mt-3 max-w-xs">
              Yoga y movimiento en {contacto.zona}. Clases íntimas, trato personalizado.
            </p>
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-widest text-crema/45 font-semibold mb-4">Navega</h3>
            <ul className="space-y-2.5">
              {navLinks.map((l) => (
                <li key={l.href}><a href={l.href} className="hover:text-crema transition-colors">{l.label}</a></li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-widest text-crema/45 font-semibold mb-4">Contacto</h3>
            <ul className="space-y-3">
              <li><a href={contacto.whatsappMsg} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 hover:text-crema"><Whatsapp className="w-5 h-5" /> {contacto.telefono}</a></li>
              <li><a href={contacto.emailLink} className="flex items-center gap-2.5 hover:text-crema"><Mail className="w-5 h-5" /> {contacto.email}</a></li>
              <li><a href={contacto.instagramLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 hover:text-crema"><Instagram className="w-5 h-5" /> {contacto.instagram}</a></li>
            </ul>
          </div>
        </div>

        <div className="hairline my-10 opacity-30" />
        <div className="flex flex-col sm:flex-row justify-between gap-3 text-sm text-crema/45">
          <span>© {year} Lucía Passardi. Todos los derechos reservados.</span>
          <span className="flex items-center gap-4">
            <a href="/admin" className="hover:text-crema transition-colors">Acceso</a>
            <span>Hecho con calma · yoga y movimiento</span>
          </span>
        </div>
      </div>
    </footer>
  )
}
