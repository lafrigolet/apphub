import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { DEV_PERSONAS } from '../lib/dev-personas'
import { login } from '../lib/auth'
import { icons } from '../lib/icons'
import { Avatar } from '../lib/ui'

export default function Topbar() {
  const { identity, onLogin, logout, toast } = useApp()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    function handle(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const displayName = identity?.email ?? 'usuario'
  const roleLabel   = identity?.role ? roleLabelFor(identity) : ''

  async function switchPersona(p) {
    setMenuOpen(false)
    try {
      await login({ email: p.email, password: p.password })
      onLogin()
      toast(`Ahora viendo como ${p.label}`)
    } catch (err) {
      toast(err.message ?? 'No se pudo cambiar de persona', 'danger')
    }
  }

  return (
    <header className="header-grad sticky top-0 z-30 border-b border-line">
      <div className="h-14 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-ink flex items-center justify-center">
            <span className="font-display italic text-paper text-[15px] -translate-y-[1px]">v</span>
          </div>
          <div className="leading-tight">
            <div className="font-display text-[17px] tracking-tight">Hulkstein</div>
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
              <Avatar name={displayName} color="#14131A" />
              <div className="text-left leading-tight hidden md:block">
                <div className="text-[13px] font-medium">{displayName}</div>
                <div className="text-[11px] text-ink3">{roleLabel}</div>
              </div>
              <span className="text-ink3">{icons.chevron}</span>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-line rounded-xl shadow-pop p-2 z-40">
                {import.meta.env.DEV && (
                  <>
                    <div className="px-2 pt-2 pb-3 border-b border-line mb-2">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-ink3 mb-1">Dev · Cambiar de persona</div>
                      <div className="text-xs text-ink3">Inicia sesión como una persona seeded.</div>
                    </div>
                    {DEV_PERSONAS.map((p) => (
                      <button
                        key={p.key}
                        onClick={() => switchPersona(p)}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-paper2 text-left"
                      >
                        <Avatar name={p.name} color={p.color} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium">{p.name}</div>
                          <div className="text-[11px] text-ink3 truncate">{p.label}</div>
                        </div>
                      </button>
                    ))}
                    <div className="border-t border-line mt-2 pt-2" />
                  </>
                )}
                <button
                  onClick={() => { setMenuOpen(false); logout() }}
                  className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-paper2 text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-paper2 flex items-center justify-center text-ink3">↪</div>
                  <div className="text-[13px] font-medium">Cerrar sesión</div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

function roleLabelFor(identity) {
  switch (identity.role) {
    case 'super_admin': return 'Staff · SUPER_ADMIN'
    case 'staff':       return 'Staff'
    case 'owner':       return 'Owner'
    case 'admin':       return 'Admin'
    default:            return identity.role
  }
}
