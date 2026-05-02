// Top-level context for the tenant-console shell. Holds:
//   identity   — { userId, appId, tenantId, role, email } from the JWT
//   app        — full row from GET /v1/apps/:appId (incl. enabled_modules)
//   tenant     — full row from GET /v1/tenants/tenants/:id
//   manifests  — array of { id, capability, dashboardCards, sidebar, routes }
//   view       — current navigation key (e.g. 'home', 'notifications-emails')
//   navigate(view, extra?)  — sets view + scrolls to top
//   toast(msg, variant?)    — fire-and-forget toast
//   onLogin / onLogout      — auth lifecycle hooks
//
// The shell renders a login screen when identity is null. On login, it loads
// app + tenant + manifests in parallel and only then mounts MainContent.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { getIdentity, logout as libLogout } from './auth'
import { loadManifests } from '../ManifestLoader'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

export function AppProvider({ children }) {
  const [identity, setIdentity] = useState(() => getIdentity())
  const [app,       setApp]       = useState(null)
  const [tenant,    setTenant]    = useState(null)
  const [manifests, setManifests] = useState([])
  const [bootError, setBootError] = useState(null)
  const [booting,   setBooting]   = useState(false)
  const [view, setView] = useState('home')
  const [viewState, setViewState] = useState(null)
  const [toasts, setToasts] = useState([])

  // 1. Logout on 401 anywhere in the app.
  useEffect(() => {
    const handler = () => { setIdentity(null); setApp(null); setTenant(null); setManifests([]) }
    window.addEventListener('apphub:unauthorized', handler)
    return () => window.removeEventListener('apphub:unauthorized', handler)
  }, [])

  // 2. After login (or initial mount with stored token), load app + tenant +
  //    manifests in parallel. The manifests array drives sidebar + routes;
  //    the shell renders a "Cargando…" splash while this is in flight.
  useEffect(() => {
    if (!identity) { setApp(null); setTenant(null); setManifests([]); setBootError(null); return }
    let cancelled = false
    setBooting(true)
    Promise.all([
      api.get(`/api/apps/${encodeURIComponent(identity.appId)}`),
      api.get(`/api/tenants/tenants/${encodeURIComponent(identity.tenantId)}`).catch(() => null),
    ])
      .then(async ([appRow, tenantRow]) => {
        if (cancelled) return
        setApp(appRow)
        setTenant(tenantRow)
        const ms = await loadManifests(appRow?.enabled_modules ?? [])
        if (cancelled) return
        setManifests(ms)
        setBootError(null)
      })
      .catch((err) => { if (!cancelled) setBootError(err.message ?? String(err)) })
      .finally(() => { if (!cancelled) setBooting(false) })
    return () => { cancelled = true }
  }, [identity])

  const navigate = useCallback((v, extra) => {
    setView(v)
    setViewState(extra ?? null)
    window.scrollTo({ top: 0 })
  }, [])

  const toast = useCallback((msg, variant = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, msg, variant }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3600)
  }, [])

  const onLogin = useCallback(() => { setIdentity(getIdentity()); setView('home') }, [])
  const onLogout = useCallback(() => { libLogout(); setIdentity(null); setView('home') }, [])

  // The route map is built from every manifest's `routes` object. Each route
  // is a (lazy or sync) function returning a JSX element; the shell calls it
  // when the matching `view` key is active.
  const routes = useMemo(() => {
    const out = {}
    for (const m of manifests) for (const [k, v] of Object.entries(m.routes ?? {})) out[k] = v
    return out
  }, [manifests])

  const value = useMemo(() => ({
    identity, app, tenant, manifests, routes,
    view, viewState, booting, bootError, toasts,
    navigate, toast, onLogin, onLogout,
  }), [identity, app, tenant, manifests, routes, view, viewState, booting, bootError, toasts, navigate, toast, onLogin, onLogout])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
