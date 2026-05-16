export default function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-slate-500 sm:flex-row">
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-indigo-600" />
          <span>© {year} Hulkstein</span>
        </div>
        <nav className="flex items-center gap-6">
          <a href="#" className="transition hover:text-slate-900">Privacidad</a>
          <a href="#" className="transition hover:text-slate-900">Términos</a>
          <a href="mailto:hola@hulkstein.com" className="transition hover:text-slate-900">Contacto</a>
        </nav>
      </div>
    </footer>
  )
}
