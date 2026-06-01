// Tenants — listado de tenants del staff console (4.1 · P1).
// Contrato:
//   - al montar carga GET /api/tenants/tenants y adapta cada fila.
//   - muestra "N de N tenants" y las filas (nombre).
//   - "Nuevo tenant" → openModal(CreateTenantModal).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Tenants from '../Tenants'
import { api } from '../../../lib/api'

const openModal = vi.fn()
const toast = vi.fn()
const useAppValue = {
  navigate: vi.fn(),
  filters: { query: '', status: 'ALL', plan: 'ALL', country: 'ALL' },
  setFilters: vi.fn(),
  sort: { key: 'name', dir: 1 },
  setSort: vi.fn(),
  openModal,
  toast,
}
vi.mock('../../../context/AppContext', () => ({ useApp: () => useAppValue }))
vi.mock('../../../lib/api', () => ({ api: { get: vi.fn() } }))
vi.mock('../../../lib/adapters', () => ({ adaptTenant: (t) => t }))
vi.mock('../modals/CreateTenantModal', () => ({ default: () => <div>CREATE TENANT MODAL</div> }))
vi.mock('../modals/BootstrapTenantModal', () => ({ default: () => null }))

const tenant = (id, name) => ({
  id, name, legal: `${name} SL`, cif: 'B1', subdomain: name.toLowerCase(), customDomain: null,
  status: 'active', plan: 'PRO', country: 'ES', created: '2026-01-01T00:00:00Z',
  volMonth: 120000, txMonth: 10, app: 'aikikan', stripe: 'VERIFIED', balance: 0,
})

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue([tenant('t1', 'Tienda Ana'), tenant('t2', 'Pedro Market')])
})

describe('Tenants', () => {
  it('carga tenants y muestra el recuento "2 de 2 tenants"', async () => {
    render(<Tenants />)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/tenants/tenants'))
    await waitFor(() => expect(screen.getByText(/2 de 2 tenants/)).toBeInTheDocument())
    expect(screen.getByText('Tienda Ana')).toBeInTheDocument()
    expect(screen.getByText('Pedro Market')).toBeInTheDocument()
  })

  it('"Nuevo tenant" → openModal(CreateTenantModal)', async () => {
    render(<Tenants />)
    await waitFor(() => expect(screen.getByText(/2 de 2 tenants/)).toBeInTheDocument())
    // El botón "Nuevo tenant" (texto exacto, distinto de "Bootstrap nuevo tenant").
    fireEvent.click(screen.getByText('Nuevo tenant'))
    expect(openModal).toHaveBeenCalled()
  })
})
