// Contacto — formulario de contacto (leads) + botones de donación (4.3).
// Contrato:
//   - submit del form → leads.create con source 'aulavera/contacto'.
//   - "Donar una vez" → donations.checkout one_shot 2500; redirige a sessionUrl.
//   - cancelar el prompt de email → no llama a checkout.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../components/Toast'
import Contacto from './Contacto'
import { leads, donations } from '../lib/api'

vi.mock('../lib/api', () => ({
  leads: { create: vi.fn() },
  donations: { checkout: vi.fn() },
}))

function renderContacto() {
  render(<MemoryRouter><ToastProvider><Contacto /></ToastProvider></MemoryRouter>)
}

beforeEach(() => vi.clearAllMocks())

describe('Contacto — formulario', () => {
  it('submit → leads.create con source aulavera/contacto y mensaje (asunto + cuerpo)', async () => {
    leads.create.mockResolvedValue({ id: 'l1' })
    renderContacto()
    fireEvent.change(screen.getByLabelText('Tu nombre'), { target: { value: 'Lucía' } })
    fireEvent.change(screen.getByLabelText('Tu email'), { target: { value: 'lucia@x.com' } })
    fireEvent.change(screen.getByLabelText('Tu mensaje'), { target: { value: 'Hola' } })
    fireEvent.click(screen.getByLabelText(/Acepto la/i))
    fireEvent.submit(screen.getByText('Enviar mensaje →').closest('form'))

    await waitFor(() => expect(leads.create).toHaveBeenCalled())
    expect(leads.create.mock.calls[0][0]).toMatchObject({
      contactName: 'Lucía', email: 'lucia@x.com', source: 'aulavera/contacto',
    })
    await waitFor(() => expect(screen.getByText(/Mensaje recibido/)).toBeInTheDocument())
  })
})

describe('Contacto — donaciones', () => {
  it('"Donar una vez" con email → donations.checkout one_shot 2500 + redirect a sessionUrl', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('donor@x.com')
    // jsdom no permite asignar window.location.href; lo interceptamos.
    const original = window.location
    delete window.location
    window.location = { ...original, href: '' }
    donations.checkout.mockResolvedValue({ data: { sessionUrl: 'https://stripe/session' } })

    renderContacto()
    fireEvent.click(screen.getByText('Donar una vez →'))

    await waitFor(() => expect(donations.checkout).toHaveBeenCalled())
    expect(donations.checkout.mock.calls[0][0]).toMatchObject({ amountCents: 2500, donorEmail: 'donor@x.com', kind: 'one_shot' })
    await waitFor(() => expect(window.location.href).toBe('https://stripe/session'))
    window.location = original
  })

  it('cancelar el prompt de email → NO llama a checkout', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    renderContacto()
    fireEvent.click(screen.getByText('Hacerme socio/a →'))
    await waitFor(() => expect(window.prompt).toHaveBeenCalled())
    expect(donations.checkout).not.toHaveBeenCalled()
  })
})
