// Login — modal passwordless: pide email → magic-link (4.2 · P0).
// Contrato:
//   - submit con email → auth.requestMagicLink(email) + mensaje de éxito.
//   - email vacío → error "Introduce tu email.", no llama al backend.
//   - error del backend → muestra el mensaje de error.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Login from './Login'
import * as auth from '../lib/auth.js'

vi.mock('../lib/auth.js', () => ({
  requestMagicLink: vi.fn(),
  loginGoogle: vi.fn(),
  loginFacebook: vi.fn(),
}))

function renderLogin() {
  const onClose = vi.fn(); const onLoggedIn = vi.fn()
  render(<Login onClose={onClose} onLoggedIn={onLoggedIn} />)
  return { onClose, onLoggedIn }
}

beforeEach(() => vi.clearAllMocks())

describe('Login — magic-link request', () => {
  it('email + submit → requestMagicLink + mensaje de éxito ("enlace de acceso")', async () => {
    auth.requestMagicLink.mockResolvedValue({})
    renderLogin()
    fireEvent.change(screen.getByPlaceholderText('nombre@ejemplo.com'), { target: { value: 'socio@x.com' } })
    fireEvent.click(screen.getByText('Enviar enlace de acceso'))
    await waitFor(() => expect(auth.requestMagicLink).toHaveBeenCalledWith('socio@x.com'))
    // mensaje de éxito (frase única, distinta del hint del formulario)
    await waitFor(() => expect(screen.getByText(/Revisa tu bandeja/)).toBeInTheDocument())
  })

  it('email vacío → error "Introduce tu email.", no llama al backend', async () => {
    renderLogin()
    // submit del form sin email (el required no bloquea fireEvent.submit del form directo)
    fireEvent.submit(screen.getByText('Enviar enlace de acceso').closest('form'))
    await waitFor(() => expect(screen.getByText('Introduce tu email.')).toBeInTheDocument())
    expect(auth.requestMagicLink).not.toHaveBeenCalled()
  })

  it('error del backend → muestra el mensaje', async () => {
    auth.requestMagicLink.mockRejectedValue(new Error('rate limited'))
    renderLogin()
    fireEvent.change(screen.getByPlaceholderText('nombre@ejemplo.com'), { target: { value: 'socio@x.com' } })
    fireEvent.click(screen.getByText('Enviar enlace de acceso'))
    await waitFor(() => expect(screen.getByText('rate limited')).toBeInTheDocument())
  })

  it('"Solicitar alta" abre el modal de solicitud de membresía', () => {
    renderLogin()
    // Antes de abrir: solo el botón del switch lleva ese texto.
    expect(screen.getAllByText('Solicitar alta')).toHaveLength(1)
    fireEvent.click(screen.getByText('Solicitar alta'))
    // Tras abrir: el modal monta su propia cabecera "Solicitar alta" → ≥2 coincidencias.
    expect(screen.getAllByText('Solicitar alta').length).toBeGreaterThanOrEqual(2)
  })
})
