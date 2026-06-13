import { useState } from 'react'
import { navLinks, contacto } from '../data/content.js'
import { Menu, Close, Leaf } from './icons.jsx'

const VARIANTES = [
  ['strip', 'Tira'],
  ['bento', 'Bento'],
  ['card', 'Tarjeta'],
]

// Control segmentado para alternar la variante del hero (demo de elección).
function LayoutSwitch({ variant, onVariant, className = '' }) {
  return (
    <div className={`inline-flex items-center gap-0.5 rounded-full border border-tinta/15 bg-crema/60 p-0.5 ${className}`} role="group" aria-label="Layout del hero">
      {VARIANTES.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onVariant(v)}
          aria-pressed={variant === v}
          className={`seg-btn px-3 py-1 rounded-full text-[12px] font-semibold ${
            variant === v ? 'bg-teal-600 text-crema' : 'text-tinta/60 hover:text-teal-600'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export default function Header({ variant, onVariant }) {
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
          {/* Control de layout (elige entre las 3 variantes) */}
          <div className="hidden lg:flex items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-widest text-tinta/40 font-semibold">Layout</span>
            <LayoutSwitch variant={variant} onVariant={onVariant} />
          </div>
          <a href={contacto.whatsappMsg} target="_blank" rel="noopener noreferrer"
            className="btn-zen btn-fill text-[14px] py-2.5 px-5">
            Reserva una clase
          </a>
        </div>

        <button className="md:hidden text-tinta p-2" onClick={() => setOpen(true)} aria-label="Abrir menú">
          <Menu className="w-6 h-6" />
        </button>
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

            <div className="mt-8">
              <span className="block text-[11px] uppercase tracking-widest text-tinta/40 font-semibold mb-2">Layout del hero</span>
              <LayoutSwitch variant={variant} onVariant={onVariant} />
            </div>

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
