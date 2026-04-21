import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { PERSONAS } from '../data/mock'
import { icons } from '../lib/icons'
import { Avatar } from '../lib/ui'

export default function Topbar() {
  const { role, switchRole } = useApp()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const p = PERSONAS[role]

  useEffect(() => {
    function handle(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  return (
    <header className="header-grad sticky top-0 z-30 border-b border-line">
      <div className="h-14 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-ink flex items-center justify-center">
            <span className="font-display italic text-paper text-[15px] -translate-y-[1px]">v</span>
          </div>
          <div className="leading-tight">
            <div className="font-display text-[17px] tracking-tight">Voragine</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink3 -mt-0.5">Admin Console</div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button className="text-ink3 hover:text-ink relative" title="Notificaciones">
            {icons.bell}
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent" />
          </button>
          <div className="h-5 w-px bg-line" />
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2.5 hover:bg-paper2 rounded-lg px-2 py-1 transition"
            >
              <Avatar name={p.name} color={p.avatarColor} />
              <div className="text-left leading-tight hidden md:block">
                <div className="text-[13px] font-medium">{p.name}</div>
                <div className="text-[11px] text-ink3">{p.role_label}</div>
              </div>
              <span className="text-ink3">{icons.chevron}</span>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-line rounded-xl shadow-pop p-2 z-40">
                <div className="px-2 pt-2 pb-3 border-b border-line mb-2">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-ink3 mb-1">Cambiar de persona</div>
                  <div className="text-xs text-ink3">Simula el prototipo desde diferentes roles.</div>
                </div>
                {['staff', 'owner', 'admin'].map(r => {
                  const pp = PERSONAS[r]
                  const active = role === r
                  return (
                    <button
                      key={r}
                      onClick={() => { switchRole(r); setMenuOpen(false) }}
                      className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-paper2 text-left ${active ? 'bg-paper2' : ''}`}
                    >
                      <Avatar name={pp.name} color={pp.avatarColor} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium">{pp.name}</div>
                        <div className="text-[11px] text-ink3 truncate">{pp.role_label}</div>
                      </div>
                      {active && <span className="text-ok">{icons.check}</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
