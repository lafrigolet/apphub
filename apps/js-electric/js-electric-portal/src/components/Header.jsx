import { useEffect, useState } from 'react'
import { Arrow, Phone } from './icons.jsx'
import { navLinks, contactInfo } from '../data/mock.js'

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    const onKey    = (e) => { if (e.key === 'Escape' && menuOpen) setMenuOpen(false) }
    const onResize = ()  => { if (window.innerWidth >= 1024) setMenuOpen(false) }
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [menuOpen])

  return (
    <header id="site-header" className="fixed top-0 inset-x-0 z-50 header-blur bg-bone/70 border-b border-ink-900/5">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <a href="#inicio" className="flex items-center gap-2.5 group">
          <span className="relative inline-flex items-center justify-center w-10 h-10 rounded-xl bg-electric-500 text-white shadow-electric">
            <span className="font-display font-bold text-sm tracking-tight">JS</span>
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-spark-400 spark-dot"></span>
          </span>
          <span className="font-display text-xl font-semibold tracking-tight">JS Electric<span className="text-electric-500">.</span></span>
        </a>

        <nav className="hidden lg:flex items-center gap-8 text-sm font-medium text-ink-700">
          {navLinks.map((l) => (
            <a key={l.href} href={l.href} className="hover:text-ink-900 transition">{l.label}</a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a href={contactInfo.phoneHref} className="hidden sm:flex items-center gap-2 text-sm font-medium text-ink-800 hover:text-electric-600 transition">
            <Phone />{contactInfo.phone}
          </a>
          <a href="#contacto" className="btn-primary inline-flex items-center gap-2 bg-electric-500 text-white px-4 py-2.5 rounded-full text-sm font-medium shadow-electric hover:bg-electric-600">
            Presupuesto gratis<Arrow />
          </a>
          <button type="button" onClick={() => setMenuOpen((v) => !v)}
            className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-ink-900/10 hover:border-ink-900/30 transition"
            aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menuOpen} aria-controls="mobile-nav">
            {menuOpen
              ? <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" /></svg>
              : <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" /></svg>}
          </button>
        </div>
      </div>

      <div id="mobile-nav" className={`mobile-nav ${menuOpen ? 'open' : ''} lg:hidden absolute left-0 right-0 top-full border-t border-ink-900/5 bg-bone shadow-soft`}>
        <nav className="px-6 py-4 flex flex-col gap-1 text-ink-800 font-medium">
          {navLinks.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)} className="py-3 border-b border-ink-900/5 hover:text-electric-600 transition">{l.label}</a>
          ))}
          <a href={contactInfo.phoneHref} className="py-3 text-electric-600 font-semibold">📞 {contactInfo.phone}</a>
        </nav>
      </div>
    </header>
  )
}
