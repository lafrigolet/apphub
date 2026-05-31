import { Link } from 'react-router-dom'
import { LogoMark, Wordmark, IconBack } from './icons.jsx'

// Shared dashboard sidebar for the four back-office roles (emisor, asesoria,
// administrador, desarrollador). `items` is [{ id, label, icon }]; the active
// item gets the `.active` class. The "Cambiar de rol" link returns to the
// role selector (was <a href="index.html"> in the prototypes).
export default function Sidebar({ items, active, onSelect }) {
  return (
    <aside className="hidden lg:flex w-64 flex-col bg-white border-r border-slate-200 sticky top-0 h-screen">
      <div className="h-16 flex items-center gap-2.5 px-5 border-b border-slate-200">
        <LogoMark />
        <Wordmark />
      </div>
      <nav className="flex-1 p-3 space-y-1 text-sm font-500">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => onSelect(it.id)}
            className={`nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left${active === it.id ? ' active' : ''}`}
          >
            {it.icon}{it.label}
          </button>
        ))}
      </nav>
      <Link to="/" className="m-3 flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-slate-500 hover:bg-slate-100">
        <IconBack />Cambiar de rol
      </Link>
    </aside>
  )
}
