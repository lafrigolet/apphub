// SplitpayConfig — credenciales Stripe Connect con dos juegos (test/live),
// account id por modo y switch de modo persistido (stripe_mode).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SplitpayConfig from '../SplitpayConfig'
import { api } from '../../../../lib/api'

const toast = vi.fn()
vi.mock('../../../../context/AppContext', () => ({ useApp: () => ({ toast }) }))
vi.mock('../../../../lib/api', () => ({ api: { get: vi.fn(), patch: vi.fn() } }))
vi.mock('../../../../components/SecretInput', () => ({
  default: ({ label, value, onChange }) => (
    <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({
    data: [
      { key: 'stripe_mode', value: 'test' },
      { key: 'platform_account_id_test', value: 'acct_test1' },
      { key: 'stripe_test_publishable_key', value: 'pk_test_loaded' },
    ],
  })
  api.patch.mockResolvedValue({})
})

describe('SplitpayConfig', () => {
  it('al montar carga la config, precarga los plains por modo y marca activo el test', async () => {
    render(<SplitpayConfig />)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/splitpay/admin/config'))
    await waitFor(() => expect(screen.getByText('Guardar')).toBeInTheDocument())
    expect(screen.getByText('Claves test')).toBeInTheDocument()
    expect(screen.getByText('Claves live')).toBeInTheDocument()
    expect(screen.getByDisplayValue('acct_test1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('pk_test_loaded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Test/ })).toHaveTextContent('activo')
  })

  it('Guardar manda solo los campos rellenos, namespaced por modo', async () => {
    render(<SplitpayConfig />)
    await waitFor(() => expect(screen.getByText('Guardar')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Secret key \(sk_live_/), { target: { value: 'sk_live_abc' } })
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/splitpay/admin/config', {
      // Los plains test precargados viajan (vienen rellenos del GET)…
      platform_account_id_test: 'acct_test1',
      stripe_test_publishable_key: 'pk_test_loaded',
      // …y la nueva secret live.
      stripe_live_secret_key: 'sk_live_abc',
    }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Split Pay configurado'))
  })

  it('cambiar a Live + Guardar → PATCH incluye stripe_mode: live', async () => {
    render(<SplitpayConfig />)
    await waitFor(() => expect(screen.getByText('Guardar')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Live/ }))
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/splitpay/admin/config',
      expect.objectContaining({ stripe_mode: 'live' })))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Modo Stripe: live'))
  })

  it('error al cargar → toast danger', async () => {
    api.get.mockRejectedValue(new Error('boom'))
    render(<SplitpayConfig />)
    await waitFor(() => expect(toast).toHaveBeenCalledWith('boom', 'danger'))
  })
})
