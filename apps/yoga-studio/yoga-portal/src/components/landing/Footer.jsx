export default function Footer() {
  return (
    <footer className="bg-sage-900 text-sage-300 py-12 px-6">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between gap-8">
        <div>
          <p className="font-serif text-xl font-bold text-white mb-2">Serenity<span className="text-warm-400">Yoga</span></p>
          <p className="text-sm max-w-xs leading-relaxed">Tu espacio de bienestar en el corazón de Madrid.</p>
        </div>
        <div className="grid grid-cols-2 gap-8 text-sm">
          <div>
            <p className="text-white font-semibold mb-3">Estudio</p>
            <ul className="space-y-1.5">
              <li><a href="#clases" className="hover:text-white transition-colors">Clases</a></li>
              <li><a href="#instructores" className="hover:text-white transition-colors">Instructores</a></li>
              <li><a href="#precios" className="hover:text-white transition-colors">Precios</a></li>
            </ul>
          </div>
          <div>
            <p className="text-white font-semibold mb-3">Legal</p>
            <ul className="space-y-1.5">
              <li><a href="#" className="hover:text-white transition-colors">Privacidad</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Términos</a></li>
              <li><a href="#contacto" className="hover:text-white transition-colors">Contacto</a></li>
            </ul>
          </div>
        </div>
      </div>
      <div className="max-w-6xl mx-auto mt-8 pt-6 border-t border-sage-700 text-xs text-center">
        © {new Date().getFullYear()} Serenity Yoga. Todos los derechos reservados.
      </div>
    </footer>
  )
}
