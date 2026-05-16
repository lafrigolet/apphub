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

// Derive the tenant subdomain from the current host. Returns null when we're
// on the platform "tenant-console" subdomain itself (which is generic and
// doesn't bind to a specific tenant) or when the hostname has no subdomain
// component (e.g. the user hits localhost directly).
function detectSubdomain() {
  if (typeof window === 'undefined') return null
  const host = window.location.hostname
  // Strip the platform suffix and inspect what's left. The platform suffix
  // is the trailing two labels (hulkstein.local / hulkstein.com / …); anything
  // before it is the tenant subdomain.
  const parts = host.split('.')
  if (parts.length < 3) return null               // no subdomain
  const sub = parts[0]
  if (sub === 'tenant-console') return null       // generic console
  return sub
}

export function AppProvider({ children, detectHostTenant = true }) {
  const [identity, setIdentity] = useState(() => getIdentity())
  const [app,       setApp]       = useState(null)
  const [tenant,    setTenant]    = useState(null)
  const [manifests, setManifests] = useState([])
  const [bootError, setBootError] = useState(null)
  const [booting,   setBooting]   = useState(false)
  // Host-derived tenant context, resolved before login so the LoginView
  // can render "Sign in to <Tenant>" with the right name. Stays null for
  // the generic tenant-console.* host.
  const [hostTenant, setHostTenant] = useState(null)
  const [hostMismatch, setHostMismatch] = useState(false)
  const [view, setView] = useState('home')
  const [viewState, setViewState] = useState(null)
  const [toasts, setToasts] = useState([])
  const [modal, setModal] = useState(null)

  // 1. Logout on 401 anywhere in the app.
  useEffect(() => {
    const handler = () => { setIdentity(null); setApp(null); setTenant(null); setManifests([]) }
    window.addEventListener('apphub:unauthorized', handler)
    return () => window.removeEventListener('apphub:unauthorized', handler)
  }, [])

  // 1b. On first mount, resolve the subdomain → tenant binding via the
  //     public endpoint. We don't fail the boot on errors — the user can
  //     still log in from the generic tenant-console.* host.
  //     Hosts that embed the shell (e.g. aikikan-portal mounting the
  //     console for an admin login) pass `detectHostTenant={false}` so
  //     the host's own subdomain is not misread as a tenant subdomain.
  useEffect(() => {
    if (!detectHostTenant) return
    const sub = detectSubdomain()
    if (!sub) return
    // Note the double /tenants/tenants/: nginx strips the first segment
    // when proxying /api/tenants/* → platform-core/v1/* so the public
    // endpoint mounted at /v1/tenants/by-subdomain/:subdomain is reached
    // via /api/tenants/tenants/by-subdomain/:subdomain. Same convention
    // every other tenant-config caller uses.
    api.get(`/api/tenants/tenants/by-subdomain/${encodeURIComponent(sub)}`)
      .then((row) => setHostTenant(row))
      .catch(() => setHostTenant({ notFound: true, subdomain: sub }))
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
        // Surface "you logged in from acme.hulkstein.local but your JWT is
        // for bastardo" as a soft warning so the user can re-route.
        if (hostTenant?.tenantId && tenantRow?.id && hostTenant.tenantId !== tenantRow.id) {
          setHostMismatch(true)
        }
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

  const openModal  = useCallback((content, opts = {}) => setModal({ content, size: opts.size ?? 'md' }), [])
  const closeModal = useCallback(() => setModal(null), [])

  // Some ported console views read `myTenant`, `logout` and `role`
  // directly off the context. Aliased here so we don't touch the views' code.
  const myTenant = tenant
  const logout   = onLogout
  const role     = identity?.role ?? null

  // The route map is built from every manifest's `routes` object. Each route
  // is a (lazy or sync) function returning a JSX element; the shell calls it
  // when the matching `view` key is active.
  const routes = useMemo(() => {
    const out = {}
    for (const m of manifests) for (const [k, v] of Object.entries(m.routes ?? {})) out[k] = v
    return out
  }, [manifests])

  const value = useMemo(() => ({
    identity, app, tenant, myTenant, role, manifests, routes,
    view, viewState, booting, bootError, toasts, modal,
    hostTenant, hostMismatch,
    navigate, toast, openModal, closeModal,
    onLogin, onLogout, logout,
  }), [identity, app, tenant, myTenant, role, manifests, routes, view, viewState, booting, bootError, toasts, modal, hostTenant, hostMismatch, navigate, toast, openModal, closeModal, onLogin, onLogout, logout])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
