import { createContext, useContext, useEffect, useState } from 'react'
import { getIdentity, logout as libLogout } from '../lib/auth'
import { api } from '../lib/api'

const AppContext = createContext()

function roleFromIdentity(identity) {
  if (!identity) return null
  if (identity.role === 'super_admin' || identity.role === 'staff') return 'staff'
  if (identity.role === 'owner')  return 'owner'
  if (identity.role === 'admin')  return 'admin'
  return 'admin'
}

export function AppProvider({ children }) {
  const [identity, setIdentity] = useState(() => getIdentity())
  const role = roleFromIdentity(identity)

  const [view, setView] = useState(role === 'staff' ? 'dashboard' : 'overview')
  // Generic per-view state — caller passes `extra` to navigate() and the view
  // can read it via `viewState`. Used today by the template editor to know
  // which template to load.
  const [viewState, setViewState] = useState(null)
  const [selectedTenant, setSelectedTenant] = useState(null)
  const [tenantTab, setTenantTab] = useState('identity')
  const [filters, setFilters] = useState({ query: '', status: 'ALL', plan: 'ALL', country: 'ALL' })
  const [sort, setSort] = useState({ key: 'created', dir: 'desc' })
  const [toasts, setToasts] = useState([])
  const [modal, setModal] = useState(null)
  const [myTenant, setMyTenant] = useState(null)

  useEffect(() => {
    const handler = () => setIdentity(null)
    window.addEventListener('apphub:unauthorized', handler)
    return () => window.removeEventListener('apphub:unauthorized', handler)
  }, [])

  // Load the caller's own tenant when they're a non-staff user
  useEffect(() => {
    if (!identity) { setMyTenant(null); return }
    if (role === 'staff') { setMyTenant(null); return }
    api.get(`/api/tenants/tenants/${identity.tenantId}`)
      .then(setMyTenant)
      .catch(() => setMyTenant(null))
  }, [identity, role])

  function navigate(v, extra) {
    setView(v)
    setViewState(extra ?? null)
    if (extra?.tenant) { setSelectedTenant(extra.tenant); setTenantTab('identity') }
    window.scrollTo({ top: 0 })
  }

  function onLogin() {
    const id = getIdentity()
    setIdentity(id)
    const r = roleFromIdentity(id)
    setView(r === 'staff' ? 'dashboard' : 'overview')
    setSelectedTenant(null)
  }

  function logout() {
    libLogout()
    setIdentity(null)
  }

  function addToast(msg, variant = 'ok') {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, msg, variant }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3600)
  }

  function openModal(content, opts = {}) {
    setModal({ content, size: opts.size || 'md' })
  }

  function closeModal() { setModal(null) }

  return (
    <AppContext.Provider value={{
      identity, role, myTenant,
      view, setView, viewState,
      selectedTenant, setSelectedTenant,
      tenantTab, setTenantTab,
      filters, setFilters,
      sort, setSort,
      toasts, modal,
      navigate,
      onLogin, logout,
      toast: addToast,
      openModal, closeModal,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() { return useContext(AppContext) }
