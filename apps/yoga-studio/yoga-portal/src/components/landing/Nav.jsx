import { useState, useEffect } from 'react'
import Button from '../ui/Button.jsx'

export default function Nav({ onLogin, onRegister }) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handler)
    return () => window.removeEventListener('scroll', handler)
  }, [])

  return (
    <nav className={`fixed top-0 inset-x-0 z-40 transition-all duration-300 ${scrolled ? 'bg-white/95 backdrop-blur shadow-sm' : 'bg-transparent'}`}>
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <a href="#" className="font-serif text-xl font-bold text-sage-800">
          Serenity<span className="text-warm-500">Yoga</span>
        </a>
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-sage-700">
          <a href="#clases" className="hover:text-sage-900 transition-colors">Clases</a>
          <a href="#instructores" className="hover:text-sage-900 transition-colors">Instructores</a>
          <a href="#precios" className="hover:text-sage-900 transition-colors">Precios</a>
          <a href="#contacto" className="hover:text-sage-900 transition-colors">Contacto</a>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onLogin}>Iniciar sesión</Button>
          <Button size="sm" onClick={onRegister}>Únete ahora</Button>
        </div>
      </div>
    </nav>
  )
}
