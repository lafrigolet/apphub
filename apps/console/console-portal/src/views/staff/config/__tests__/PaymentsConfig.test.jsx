// PaymentsConfig — formulario de credenciales Stripe del módulo payments con
// dos juegos de claves (test/live) y switch de modo persistido (stripe_mode).
// Contrato:
//   - al montar carga GET /api/payments/admin/config y refleja stripe_mode
//     (badge "activo" en el segmento del modo persistido).
//   - Guardar SOLO envía los campos rellenos (PATCH parcial) + stripe_mode
//     únicamente si el switch cambió respecto a lo cargado.
//   - "Nada que guardar" si no se tocó ningún campo NI el modo.
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
  api.get.mockResolvedValue({ data: [{ key: 'stripe_mode', value: 'test' }] })
  api.patch.mockResolvedValue({})
})

describe('PaymentsConfig', () => {
  it('al montar carga la config y renderiza ambos bloques con el badge activo en test', async () => {
    render(<PaymentsConfig />)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/payments/admin/config'))
    await waitFor(() => expect(screen.getByText('Guardar')).toBeInTheDocument())
    expect(screen.getByText('Claves test')).toBeInTheDocument()
    expect(screen.getByText('Claves live')).toBeInTheDocument()
    // Badge "activo" en el segmento + en el card del modo persistido (test).
    expect(screen.getAllByText('activo').length).toBeGreaterThanOrEqual(1)
    const testButton = screen.getByRole('button', { name: /Test/ })
    expect(testButton).toHaveTextContent('activo')
  })

  it('Guardar con un secret del juego test → PATCH parcial sin stripe_mode', async () => {
    render(<PaymentsConfig />)
    await waitFor(() => expect(screen.getByText('Guardar')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Secret key \(sk_test_/), { target: { value: 'sk_test_abc' } })
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/payments/admin/config', { stripe_test_secret_key: 'sk_test_abc' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Stripe configurado'))
  })

  it('Guardar con un secret del juego live → manda la clave live', async () => {
    render(<PaymentsConfig />)
    await waitFor(() => expect(screen.getByText('Guardar')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Secret key \(sk_live_/), { target: { value: 'sk_live_abc' } })
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/payments/admin/config', { stripe_live_secret_key: 'sk_live_abc' }))
  })

  it('cambiar el switch a Live + Guardar → PATCH incluye stripe_mode y toast de modo', async () => {
    render(<PaymentsConfig />)
    await waitFor(() => expect(screen.getByText('Guardar')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Live/ }))
    // El cambio aún no se ha persistido: aviso "se aplicará al guardar".
    expect(screen.getByText('se aplicará al guardar')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/payments/admin/config', { stripe_mode: 'live' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Modo Stripe: live'))
  })

  it('volver a seleccionar el modo ya activo NO manda stripe_mode → "Nada que guardar"', async () => {
    render(<PaymentsConfig />)
    await waitFor(() => expect(screen.getByText('Guardar')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Live/ }))
    fireEvent.click(screen.getByRole('button', { name: /Test/ })) // vuelta al activo
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Nada que guardar', 'warning'))
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('con stripe_mode=live cargado, el badge activo está en Live', async () => {
    api.get.mockResolvedValue({ data: [{ key: 'stripe_mode', value: 'live' }] })
    render(<PaymentsConfig />)
    await waitFor(() => expect(screen.getByText('Guardar')).toBeInTheDocument())
    const liveButton = screen.getByRole('button', { name: /Live/ })
    expect(liveButton).toHaveTextContent('activo')
  })

  it('error al cargar → toast danger', async () => {
    api.get.mockRejectedValue(new Error('boom'))
    render(<PaymentsConfig />)
    await waitFor(() => expect(toast).toHaveBeenCalledWith('boom', 'danger'))
  })
})
