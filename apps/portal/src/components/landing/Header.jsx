// Top navigation for the public Hulkstein landing.
//
// Two CTAs:
//   - Primary "Solicita una demo" → opens the LeadModal (lead capture)
//   - Secondary "Iniciar sesión"  → navigates staff/admins to the auth flow
//
// On scroll the header gets a thin bottom border + subtle backdrop blur so it
// stays readable when overlapping page content.

import { useEffect, useState } from 'react'

const LOGIN_URL =
  import.meta.env.VITE_LOGIN_URL ?? 'https://voragine-console.hulkstein.com/'

export default function Header({ onOpenDemo }) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={
        'sticky top-0 z-40 transition-colors ' +
        (scrolled
          ? 'bg-white/85 backdrop-blur border-b border-slate-200'
          : 'bg-white')
      }
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <a href="/" className="flex items-center gap-2 font-semibold tracking-tight text-slate-900">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full bg-indigo-600"
          />
          <span>Hulkstein</span>
        </a>

        <nav className="flex items-center gap-2 sm:gap-4">
          <button
            type="button"
            onClick={onOpenDemo}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            Solicita una demo
          </button>
          <a
            href={LOGIN_URL}
            className="hidden text-sm font-medium text-slate-600 transition hover:text-slate-900 sm:inline-block"
          >
            Iniciar sesión →
          </a>
        </nav>
      </div>
    </header>
  )
}
