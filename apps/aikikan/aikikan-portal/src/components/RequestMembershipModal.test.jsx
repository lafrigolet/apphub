// RequestMembershipModal ("Solicitar alta") — Ruta 1 del flujo de approval (4.2 · P1).
// El visitante envía email (+nombre/notas); backend crea el user en
// pending_approval. NO abre sesión: el copy lo deja claro y se invoca
// onSubmitted (el padre muestra "recibirás un email cuando se apruebe").
// Contrato:
//   - botón submit deshabilitado sin email.
//   - submit → auth.requestMembership({email, displayName?, notes?}) + onSubmitted().
//   - error del backend → muestra el mensaje, NO llama onSubmitted.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RequestMembershipModal from './RequestMembershipModal'
import * as auth from '../lib/auth.js'

vi.mock('../lib/auth.js', () => ({ requestMembership: vi.fn() }))

function renderModal() {
  const onClose = vi.fn(); const onSubmitted = vi.fn()
  render(<RequestMembershipModal onClose={onClose} onSubmitted={onSubmitted} />)
  return { onClose, onSubmitted }
}

beforeEach(() => vi.clearAllMocks())

describe('RequestMembershipModal — solicitar alta (pending_approval)', () => {
  it('explica que un admin revisará y que NO abre sesión todavía', () => {
    renderModal()
    expect(screen.getByText(/un administrador revisará tu solicitud/i)).toBeInTheDocument()
  })

  it('submit deshabilitado sin email', () => {
    renderModal()
    expect(screen.getByText('Enviar solicitud').closest('button')).toBeDisabled()
  })

  it('submit con email → requestMembership + onSubmitted', async () => {
    auth.requestMembership.mockResolvedValue({})
    const { onSubmitted } = renderModal()
    fireEvent.change(screen.getByPlaceholderText('nombre@ejemplo.com'), { target: { value: 'nuevo@dojo.com' } })
    fireEvent.change(screen.getByPlaceholderText('Nombre y apellidos'), { target: { value: 'Kenji Ueshiba' } })
    fireEvent.click(screen.getByText('Enviar solicitud'))
    await waitFor(() => expect(auth.requestMembership).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'nuevo@dojo.com', displayName: 'Kenji Ueshiba' }),
    ))
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled())
  })

  it('error del backend → muestra el mensaje y NO llama onSubmitted', async () => {
    auth.requestMembership.mockRejectedValue(new Error('email ya registrado'))
    const { onSubmitted } = renderModal()
    fireEvent.change(screen.getByPlaceholderText('nombre@ejemplo.com'), { target: { value: 'dup@dojo.com' } })
    fireEvent.click(screen.getByText('Enviar solicitud'))
    await waitFor(() => expect(screen.getByText('email ya registrado')).toBeInTheDocument())
    expect(onSubmitted).not.toHaveBeenCalled()
  })
})
