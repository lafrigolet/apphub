import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { getIdentity, login as doLogin, register as doRegister, logout as doLogout, ensureSession } from '../lib/auth.js'
import { reservarSesion, comprarBono } from '../lib/studio.js'

const Ctx = createContext(null)
export const useSession = () => useContext(Ctx)

// Sesión de alumna en la landing (login/registro reutilizando platform/auth) +
// acciones que requieren identidad (reservar clase/evento, comprar bono). Las
// acciones se encolan tras el login si el visitante aún no tiene sesión.
export function SessionProvider({ children }) {
  const [identity, setIdentity] = useState(() => getIdentity())
  const [authOpen, setAuthOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [pending, setPending] = useState(null)   // acción a ejecutar tras login
  const [toast, setToast] = useState(null)        // { type:'ok'|'err', msg }

  // Al cargar, intenta revivir la sesión con el refresh token.
  useEffect(() => {
    if (!identity) ensureSession().then((id) => { if (id) setIdentity(id) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Toast efímero.
  const notify = useCallback((type, msg) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }, [])

  async function runPending() {
    if (pending) { const p = pending; setPending(null); try { await p() } catch { /* la acción ya notifica */ } }
  }

  const login = useCallback(async (c) => {
    const id = await doLogin(c); setIdentity(id); setAuthOpen(false); await runPending(); return id
  }, [pending]) // eslint-disable-line react-hooks/exhaustive-deps
  const register = useCallback(async (c) => {
    const id = await doRegister(c); setIdentity(id); setAuthOpen(false); await runPending(); return id
  }, [pending]) // eslint-disable-line react-hooks/exhaustive-deps
  const logout = useCallback(() => { doLogout(); setIdentity(null); setAccountOpen(false) }, [])

  // Ejecuta `action` si hay sesión; si no, abre el modal y la encola.
  const requireAuth = useCallback((action) => {
    if (getIdentity()) return action()
    setPending(() => action); setAuthOpen(true)
  }, [])

  // #1/#3 — reservar una clase (kind='appointment') o inscribirse a un evento
  // (kind='event'). reservarSesion deriva el body correcto según el tipo.
  const reservar = useCallback((sessionId, kind = 'event', label = 'Reserva') => requireAuth(async () => {
    try { await reservarSesion({ sessionId, kind }); notify('ok', `¡${label} confirmada! La verás en "Mi cuenta".`) }
    catch (e) { notify('err', e.message ?? 'No se pudo reservar') }
  }), [requireAuth, notify])

  // #2 — comprar un bono (flujo real commerce + payments → Stripe).
  const comprar = useCallback(({ templateId, amountCents, nombre }) => requireAuth(async () => {
    try {
      const r = await comprarBono({ templateId, amountCents })
      if (r?.url) { window.location.href = r.url; return }
      notify('ok', `Bono "${nombre}" solicitado. Te contactaremos para completar el pago.`)
    } catch (e) { notify('err', e.message ?? 'No se pudo iniciar la compra del bono') }
  }), [requireAuth, notify])

  const value = {
    identity, authOpen, setAuthOpen, accountOpen, setAccountOpen,
    login, register, logout, requireAuth, reservar, comprar, notify, toast,
  }
  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] max-w-md px-5 py-3 rounded-2xl shadow-lift text-sm font-medium ${
          toast.type === 'ok' ? 'bg-teal-700 text-crema' : 'bg-red-700 text-crema'}`}>
          {toast.msg}
        </div>
      )}
    </Ctx.Provider>
  )
}
