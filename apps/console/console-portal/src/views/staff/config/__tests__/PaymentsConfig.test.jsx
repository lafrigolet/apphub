// PaymentsConfig — formulario de credenciales Stripe del módulo payments (4.1 · P1).
// Contrato:
//   - al montar carga GET /api/payments/admin/config.
//   - Guardar SOLO envía los campos rellenos (PATCH parcial) + toast de éxito.
//   - "Nada que guardar" si no se tocó ningún campo (no llama PATCH).
//   - error en load/save → toast danger.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PaymentsConfig from '../PaymentsConfig'
import { api } from '../../../../lib/api'

const toast = vi.fn()
vi.mock('../../../../context/AppContext', () => ({ useApp: () => ({ toast }) }))
vi.mock('../../../../lib/api', () => ({ api: { get: vi.fn(), patch: vi.fn() } }))
// SecretInput → input simple controlado para poder escribir en el test.
vi.mock('../../../../components/SecretInput', () => ({
  default: ({ label, value, onChange }) => (
    <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ data: [] })
  api.patch.mockResolvedValue({})
})

describe('PaymentsConfig', () => {
  it('al montar carga la config (GET /api/payments/admin/config)', async () => {
    render(<PaymentsConfig />)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/payments/admin/config'))
    await waitFor(() => expect(screen.getByText('Guardar')).toBeInTheDocument())
  })

  it('Guardar con un secret → PATCH parcial (solo el campo relleno) + toast éxito', async () => {
    render(<PaymentsConfig />)
    await waitFor(() => expect(screen.getByText('Guardar')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Secret key/), { target: { value: 'sk_test_abc' } })
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/payments/admin/config', { stripe_secret_key: 'sk_test_abc' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Stripe configurado'))
  })

  it('Guardar sin tocar nada → "Nada que guardar", no llama PATCH', async () => {
    render(<PaymentsConfig />)
    await waitFor(() => expect(screen.getByText('Guardar')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Nada que guardar', 'warning'))
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('error al cargar → toast danger', async () => {
    api.get.mockRejectedValue(new Error('boom'))
    render(<PaymentsConfig />)
    await waitFor(() => expect(toast).toHaveBeenCalledWith('boom', 'danger'))
  })
})
