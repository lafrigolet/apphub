// UsersAdmin — gestión de socios + solicitudes pendientes (4.2 · P1).
// Contrato:
//   - role gate: solo owner/admin; otro → "Acceso restringido".
//   - carga 4 fuentes en paralelo y muestra "Solicitudes pendientes (N)".
//   - Aprobar → POST /api/users/:id/approve y recarga.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UsersAdmin from './UsersAdmin'
import { getIdentity } from '../../lib/auth.js'
import { api } from '../../lib/api.js'

vi.mock('../../lib/auth.js', () => ({ getIdentity: vi.fn() }))
vi.mock('../../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('./InviteUserModal.jsx', () => ({ default: () => null }))
vi.mock('../ConfirmModal.jsx', () => ({ default: ({ children }) => <div>{children}</div> }))

const admin = { userId: 'a1', appId: 'aikikan', tenantId: 't1', role: 'admin' }

function mockApiByUrl(pending = []) {
  api.mockImplementation((_method, url) => {
    if (typeof url === 'string' && url.includes('pending=approval')) return Promise.resolve(pending)
    return Promise.resolve([]) // socios / admins / members
  })
}

beforeEach(() => vi.clearAllMocks())

describe('UsersAdmin — role gate', () => {
  it('rol socio (user) → render "Acceso restringido a owner/admin"', () => {
    mockApiByUrl([])
    getIdentity.mockReturnValue({ ...admin, role: 'user' })
    render(<UsersAdmin />)
    expect(screen.getByText(/Acceso restringido/)).toBeInTheDocument()
  })
})

describe('UsersAdmin — solicitudes pendientes', () => {
  beforeEach(() => getIdentity.mockReturnValue(admin))

  it('admin → carga las 4 fuentes (incluida pending=approval)', async () => {
    mockApiByUrl([])
    render(<UsersAdmin />)
    await waitFor(() => expect(api).toHaveBeenCalledTimes(4))
    expect(api.mock.calls.some(([, url]) => url.includes('pending=approval'))).toBe(true)
  })

  it('muestra "Solicitudes pendientes (N)" cuando hay pendientes', async () => {
    mockApiByUrl([{ id: 'p1', email: 'nuevo@dojo.com', display_name: 'Nuevo Socio' }])
    render(<UsersAdmin />)
    await waitFor(() => expect(screen.getByText(/Solicitudes pendientes \(1\)/)).toBeInTheDocument())
    expect(screen.getByText('nuevo@dojo.com')).toBeInTheDocument()
  })

  it('Aprobar → POST /api/users/:id/approve y recarga', async () => {
    mockApiByUrl([{ id: 'p1', email: 'nuevo@dojo.com', display_name: 'Nuevo' }])
    render(<UsersAdmin />)
    await waitFor(() => expect(screen.getByText('Aprobar')).toBeInTheDocument())
    api.mockClear()
    mockApiByUrl([]) // tras aprobar ya no hay pendientes
    fireEvent.click(screen.getByText('Aprobar'))
    await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/api/users/p1/approve'))
  })
})
