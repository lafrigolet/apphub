import { useState } from 'react'
import { navLinks, contacto } from '../data/content.js'
import { Menu, Close, Leaf, Bag } from './icons.jsx'
import { useCart } from '../context/CartContext.jsx'
import { useSession } from '../context/SessionContext.jsx'
import { isAdmin } from '../lib/auth.js'

// Botón de cuenta ÚNICO ("Acceder"): sin sesión abre el login; con sesión muestra
// la inicial y va al backoffice (admin) o abre Mi cuenta (alumna).
function AccountButton({ className = '' }) {
  const { identity, setAuthOpen, setAccountOpen } = useSession()
  if (!identity) {
    return (
      <button onClick={() => setAuthOpen(true)}
        className={`text-sm font-semibold px-3 py-1.5 rounded-full text-tinta/70 hover:text-teal-600 transition-colors ${className}`}>
        Acceder
      </button>
    )
  }
  const admin = isAdmin(identity.role)
  const inicial = (identity.email?.[0] || 'A').toUpperCase()
  return (
    <button onClick={() => admin ? (window.location.href = '/admin') : setAccountOpen(true)}
      title={admin ? 'Ir al backoffice' : 'Mi cuenta'}
      aria-label={admin ? 'Backoffice' : 'Mi cuenta'}
      className={`w-9 h-9 rounded-full bg-teal-600 text-crema font-bold flex items-center justify-center hover:bg-teal-700 transition-colors ${className}`}>
      {inicial}
    </button>
  )
}

// Botón de cesta con badge de unidades.
function CartButton({ className = '' }) {
  const { count, setOpen } = useCart()
  return (
    <button onClick={() => setOpen(true)} aria-label="Abrir cesta"
      className={`relative p-2 text-tinta/70 hover:text-teal-600 transition-colors ${className}`}>
      <Bag className="w-6 h-6" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-teal-600 text-crema text-[11px] font-bold flex items-center justify-center">
          {count}
        </span>
      )}
    </button>
  )
}

export default function Header() {
  const [open, setOpen] = useState(false)

  return (
    <header id="site-header" className="site-header fixed top-0 inset-x-0 z-50">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-[72px] flex items-center justify-between gap-4">
        <a href="#inicio" className="flex items-center gap-2.5 group shrink-0">
          <span className="w-9 h-9 rounded-full bg-salvia-400/30 text-teal-600 flex items-center justify-center">
            <Leaf className="w-5 h-5" />
          </span>
          <span className="display text-2xl tracking-tight">Lucía Passardi</span>
        </a>

        <nav className="hidden lg:flex items-center gap-7 text-[15px] text-tinta/80">
          {navLinks.map((l) => (
            <a key={l.href} href={l.href} className="hover:text-teal-600 transition-colors">{l.label}</a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-3 shrink-0">
          <AccountButton />
          <CartButton />
          <a href={contacto.whatsappMsg} target="_blank" rel="noopener noreferrer"
            className="btn-zen btn-fill text-[14px] py-2.5 px-5">
            Reserva una clase
          </a>
        </div>

        <div className="md:hidden flex items-center gap-1">
          <AccountButton />
          <CartButton />
          <button className="text-tinta p-2" onClick={() => setOpen(true)} aria-label="Abrir menú">
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Drawer móvil */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-tinta/30" onClick={() => setOpen(false)} />
          <div className="absolute top-0 right-0 h-full w-[80%] max-w-xs bg-crema shadow-lift p-7 flex flex-col">
            <div className="flex justify-end">
              <button onClick={() => setOpen(false)} aria-label="Cerrar menú" className="p-2 text-tinta">
                <Close className="w-6 h-6" />
              </button>
            </div>
            <nav className="mt-6 flex flex-col gap-5 text-xl display">
              {navLinks.map((l) => (
                <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="hover:text-teal-600">{l.label}</a>
              ))}
            </nav>

            <a href={contacto.whatsappMsg} target="_blank" rel="noopener noreferrer"
              onClick={() => setOpen(false)} className="btn-zen btn-fill justify-center mt-auto">
              Reserva una clase
            </a>
          </div>
        </div>
      )}
    </header>
  )
}
