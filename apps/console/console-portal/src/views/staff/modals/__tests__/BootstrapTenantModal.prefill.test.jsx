// BootstrapTenantModal — pre-relleno desde `initial` (Fase 5: provisión de
// tenant desde un lead). Verifica que tenant.displayName, su subdomain
// derivado y el owner.email se siembran desde `initial`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import BootstrapTenantModal from '../BootstrapTenantModal'
import { api } from '../../../../lib/api'

vi.mock('../../../../context/AppContext', () => ({
  useApp: () => ({ closeModal: vi.fn(), toast: vi.fn() }),
}))
vi.mock('../../../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue([])
})

describe('BootstrapTenantModal prefill', () => {
  it('siembra tenant/owner desde initial y deriva el subdomain', async () => {
    render(
      <BootstrapTenantModal
        initial={{
          tenant: { displayName: 'Tienda Ana', contactEmail: 'ana@x.com' },
          owner:  { email: 'ana@x.com', displayName: 'Ana García' },
        }}
      />,
    )
    await waitFor(() => expect(screen.getByDisplayValue('Tienda Ana')).toBeInTheDocument())
    // subdomain derivado por slugify('Tienda Ana')
    expect(screen.getByDisplayValue('tienda-ana')).toBeInTheDocument()
    // owner
    expect(screen.getByDisplayValue('Ana García')).toBeInTheDocument()
    // email aparece en owner + contacto de tenant (2 inputs)
    expect(screen.getAllByDisplayValue('ana@x.com').length).toBeGreaterThanOrEqual(2)
  })

  it('sin initial arranca vacío (no rompe)', async () => {
    render(<BootstrapTenantModal />)
    await waitFor(() => expect(screen.getByText('Bootstrap nueva cuenta')).toBeInTheDocument())
  })
})
