// ReserveModal — formulario de reserva que envía un lead (4.3).
// Contrato:
//   - item null → no renderiza nada.
//   - submit → leads.create con source 'aulavera/reserva' + message compuesto.
//   - éxito → onClose() + toast.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ToastProvider } from './Toast'
import ReserveModal from './ReserveModal'
import { leads } from '../lib/api'

vi.mock('../lib/api', () => ({ leads: { create: vi.fn() } }))

const item = { id: 'w1', title: 'Taller de barro', when_text: 'Mayo 2026', price_label: 'Reservar (30 €)' }

function renderModal(props = {}) {
  const onClose = vi.fn()
  const utils = render(<ToastProvider><ReserveModal item={item} onClose={onClose} {...props} /></ToastProvider>)
  // Los labels Nombre/Email no usan htmlFor → los seleccionamos por name.
  const byName = (n) => utils.container.querySelector(`input[name="${n}"]`)
  return { onClose, byName, ...utils }
}

beforeEach(() => vi.clearAllMocks())

describe('ReserveModal', () => {
  it('item null → no renderiza (return null)', () => {
    const { container } = render(<ToastProvider><ReserveModal item={null} onClose={() => {}} /></ToastProvider>)
    expect(container.querySelector('.modal')).toBeNull()
  })

  it('renderiza título y señal de reserva del item', () => {
    renderModal()
    expect(screen.getByText('Taller de barro')).toBeInTheDocument()
    expect(screen.getByText('30 €')).toBeInTheDocument() // price_label sin "Reservar (...)"
  })

  it('submit → leads.create con source aulavera/reserva + message compuesto; luego onClose + toast', async () => {
    leads.create.mockResolvedValue({ id: 'lead-1' })
    const { onClose, byName } = renderModal()
    fireEvent.change(byName('name'), { target: { value: 'Ana' } })
    fireEvent.change(byName('email'), { target: { value: 'ana@x.com' } })
    fireEvent.click(screen.getByLabelText(/Acepto la política/i))
    fireEvent.submit(screen.getByText('Reservar →').closest('form'))

    await waitFor(() => expect(leads.create).toHaveBeenCalled())
    const payload = leads.create.mock.calls[0][0]
    expect(payload).toMatchObject({ contactName: 'Ana', email: 'ana@x.com', source: 'aulavera/reserva' })
    expect(payload.message).toMatch(/Reserva: Taller de barro/)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.getByText(/Reserva enviada/)).toBeInTheDocument()
  })

  it('error de leads.create → muestra toast de error, NO cierra', async () => {
    leads.create.mockRejectedValue(new Error('500'))
    const { onClose, byName } = renderModal()
    fireEvent.change(byName('name'), { target: { value: 'Ana' } })
    fireEvent.change(byName('email'), { target: { value: 'ana@x.com' } })
    fireEvent.click(screen.getByLabelText(/Acepto la política/i))
    fireEvent.submit(screen.getByText('Reservar →').closest('form'))
    await waitFor(() => expect(screen.getByText(/No se pudo enviar la reserva/)).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
  })
})
