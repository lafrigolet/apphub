// Leads — CRM de leads del staff console (Fase 4).
// Contrato:
//   - al montar carga GET /api/leads/admin/ y renderiza las filas.
//   - cambiar de bandeja refetchea con la querystring correcta.
//   - "Analítica" navega a la vista leads-analytics.
//   - click en una fila abre el modal de detalle.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Leads from '../Leads'
import { api } from '../../../lib/api'

const navigate = vi.fn()
const openModal = vi.fn()
const toast = vi.fn()
vi.mock('../../../context/AppContext', () => ({
  useApp: () => ({ navigate, openModal, toast, identity: { userId: 'me-1' } }),
}))
vi.mock('../../../lib/api', () => ({ api: { get: vi.fn() } }))
// LeadDetail importa cosas pesadas; lo stubbeamos para el smoke test.
vi.mock('../leads/LeadDetail', () => ({ default: () => <div>LEAD DETAIL</div> }))

const lead = (id, name, status = 'new') => ({
  id, contact_name: name, email: `${name}@x.com`, business_name: `${name} SL`,
  status, source: 'landing', assigned_to: null, score: null, tags: [],
  next_follow_up_at: null, created_at: '2026-06-01T00:00:00Z',
})

beforeEach(() => {
  vi.clearAllMocks()
  // primer get: staff map (users). siguientes: leads list.
  api.get.mockImplementation((path) => {
    if (path.startsWith('/api/users/')) return Promise.resolve([])
    return Promise.resolve({ data: [lead('l1', 'Ana'), lead('l2', 'Pedro', 'won')] })
  })
})

describe('Leads', () => {
  it('carga y muestra las filas', async () => {
    render(<Leads />)
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument())
    expect(screen.getByText('Pedro')).toBeInTheDocument()
    // se pidió el listado admin
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/api/leads/admin/?'))
  })

  it('cambiar a "Mis leads" refetchea con assignedTo=me', async () => {
    render(<Leads />)
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Mis leads'))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('assignedTo=me')),
    )
  })

  it('"Analítica" navega a leads-analytics', async () => {
    render(<Leads />)
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Analítica'))
    expect(navigate).toHaveBeenCalledWith('leads-analytics')
  })

  it('click en una fila abre el modal de detalle', async () => {
    render(<Leads />)
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Ana'))
    expect(openModal).toHaveBeenCalled()
  })
})
