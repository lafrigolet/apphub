// App — rutas + guards de auth (4.2 · P1). Se mockean los componentes pesados
// (landing, AdminShell/MemberHome, etc.) a placeholders para aislar la lógica
// de routing/gating, que es lo propio de App.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('./hooks/useScrollReveal.js', () => ({ default: () => {} }))
vi.mock('./components/Cursor.jsx', () => ({ default: () => <div>CURSOR</div> }))
vi.mock('./components/Nav.jsx', () => ({ default: () => <div>NAV</div> }))
vi.mock('./components/Hero.jsx', () => ({ default: () => <div>HERO</div> }))
vi.mock('./components/PullQuote.jsx', () => ({ default: () => <div>PQ</div> }))
vi.mock('./components/Masters.jsx', () => ({ default: () => <div>MASTERS</div> }))
vi.mock('./components/Videos.jsx', () => ({ default: () => <div>VIDEOS</div> }))
vi.mock('./components/About.jsx', () => ({ default: () => <div>ABOUT</div> }))
vi.mock('./components/Dojos.jsx', () => ({ default: () => <div>DOJOS</div> }))
vi.mock('./components/Events.jsx', () => ({ default: () => <div>EVENTS</div> }))
vi.mock('./components/Recognition.jsx', () => ({ default: () => <div>RECOG</div> }))
vi.mock('./components/Contact.jsx', () => ({ default: () => <div>CONTACT</div> }))
vi.mock('./components/Footer.jsx', () => ({ default: () => <div>FOOTER</div> }))
vi.mock('./components/Login.jsx', () => ({ default: () => <div>LOGIN</div> }))
vi.mock('./components/MemberHome.jsx', () => ({ default: () => <div>MEMBER HOME</div> }))
vi.mock('./components/AdminShell.jsx', () => ({ default: () => <div>ADMIN SHELL</div> }))
vi.mock('./components/admin/ConsoleLayout.jsx', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('./components/admin/UsersAdmin.jsx', () => ({ default: () => <div>USERS ADMIN</div> }))
vi.mock('./components/admin/BillingAdmin.jsx', () => ({ default: () => <div>BILLING</div> }))
vi.mock('./components/ActivateView.jsx', () => ({ default: () => <div>ACTIVATE</div> }))
vi.mock('./components/ResetPasswordView.jsx', () => ({ default: () => <div>RESET</div> }))
vi.mock('./components/MagicLoginView.jsx', () => ({ default: () => <div>MAGIC</div> }))

vi.mock('./lib/auth.js', () => ({
  getIdentity: vi.fn(),
  clearSession: vi.fn(),
  isAdminRole: (role) => ['owner', 'admin', 'staff', 'super_admin'].includes(role),
}))

import App from './App'
import { getIdentity } from './lib/auth.js'

const renderAt = (path) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)

beforeEach(() => vi.clearAllMocks())

describe('App — guards de ruta', () => {
  it('/consola con admin → AdminShell', () => {
    getIdentity.mockReturnValue({ role: 'admin', tenantId: 't1' })
    renderAt('/consola')
    expect(screen.getByText('ADMIN SHELL')).toBeInTheDocument()
  })

  it('/consola sin admin (socio) → redirige a / (no AdminShell)', () => {
    getIdentity.mockReturnValue({ role: 'user', tenantId: 't1' })
    renderAt('/consola')
    expect(screen.queryByText('ADMIN SHELL')).toBeNull()
    expect(screen.getByText('HERO')).toBeInTheDocument() // landing
  })

  it('/consola/usuarios con admin → UsersAdmin dentro de ConsoleLayout', () => {
    getIdentity.mockReturnValue({ role: 'owner', tenantId: 't1' })
    renderAt('/consola/usuarios')
    expect(screen.getByText('USERS ADMIN')).toBeInTheDocument()
  })

  it('/area-socio con socio → MemberHome', () => {
    getIdentity.mockReturnValue({ role: 'user', tenantId: 't1' })
    renderAt('/area-socio')
    expect(screen.getByText('MEMBER HOME')).toBeInTheDocument()
  })

  it('/area-socio con admin → redirige (RequireMember rechaza admins)', () => {
    getIdentity.mockReturnValue({ role: 'admin', tenantId: 't1' })
    renderAt('/area-socio')
    expect(screen.queryByText('MEMBER HOME')).toBeNull()
  })

  it('ruta desconocida → redirige a / (landing)', () => {
    getIdentity.mockReturnValue(null)
    renderAt('/no-existe')
    expect(screen.getByText('HERO')).toBeInTheDocument()
  })
})
