import { createContext, useContext, useState } from 'react'
import { PERSONAS, TENANTS } from '../data/mock'

const AppContext = createContext()

export function AppProvider({ children }) {
  const [role, setRole] = useState('staff')
  const [view, setView] = useState('dashboard')
  const [selectedTenant, setSelectedTenant] = useState(null)
  const [tenantTab, setTenantTab] = useState('identity')
  const [filters, setFilters] = useState({ query: '', status: 'ALL', plan: 'ALL', country: 'ALL' })
  const [sort, setSort] = useState({ key: 'created', dir: 'desc' })
  const [toasts, setToasts] = useState([])
  const [modal, setModal] = useState(null)

  function navigate(v, extra) {
    setView(v)
    if (extra?.tenant) { setSelectedTenant(extra.tenant); setTenantTab('identity') }
    window.scrollTo({ top: 0 })
  }

  function switchRole(r) {
    setRole(r)
    setSelectedTenant(null)
    setView(r === 'staff' ? 'dashboard' : 'overview')
    setTenantTab('identity')
    addToast(`Ahora viendo como ${PERSONAS[r].role_label}`)
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

  function currentTenant() {
    if (role === 'staff') return selectedTenant ? TENANTS.find(t => t.id === selectedTenant) : null
    return TENANTS.find(t => t.id === 't-001')
  }

  return (
    <AppContext.Provider value={{
      role, view,
      selectedTenant, setSelectedTenant,
      tenantTab, setTenantTab,
      filters, setFilters,
      sort, setSort,
      toasts, modal,
      navigate, switchRole,
      toast: addToast,
      openModal, closeModal,
      currentTenant,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() { return useContext(AppContext) }
