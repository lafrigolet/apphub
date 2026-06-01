// MagicLoginView — landing del magic-link passwordless /magic-login?token= (4.2 · P0).
// Contrato:
//   - sin token → "Enlace no válido".
//   - con token: auth.loginWithMagicLink(token); onLoggedIn(data);
//     redirige a /consola (roles admin) o /area-socio (socios).
//   - token caducado/usado (reject) → "Enlace caducado o usado" + mensaje.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import MagicLoginView from './MagicLoginView'
import * as auth from '../lib/auth.js'

vi.mock('../lib/auth.js', () => ({ loginWithMagicLink: vi.fn() }))

function renderAt(entry, onLoggedIn = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/magic-login" element={<MagicLoginView onLoggedIn={onLoggedIn} />} />
        <Route path="/consola" element={<div>PANEL CONSOLA</div>} />
        <Route path="/area-socio" element={<div>AREA SOCIO</div>} />
      </Routes>
    </MemoryRouter>,
  )
  return { onLoggedIn }
}

beforeEach(() => vi.clearAllMocks())

describe('MagicLoginView', () => {
  it('sin token → "Enlace no válido"; no llama al backend', () => {
    renderAt('/magic-login')
    expect(screen.getByText('Enlace no válido')).toBeInTheDocument()
    expect(auth.loginWithMagicLink).not.toHaveBeenCalled()
  })

  it('token + rol admin → loginWithMagicLink + onLoggedIn + redirige a /consola', async () => {
    auth.loginWithMagicLink.mockResolvedValue({ role: 'admin', accessToken: 'a' })
    const { onLoggedIn } = renderAt('/magic-login?token=abc123')
    await waitFor(() => expect(auth.loginWithMagicLink).toHaveBeenCalledWith('abc123'))
    await waitFor(() => expect(screen.getByText('PANEL CONSOLA')).toBeInTheDocument())
    expect(onLoggedIn).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }))
  })

  it('token + rol socio (user) → redirige a /area-socio', async () => {
    auth.loginWithMagicLink.mockResolvedValue({ role: 'user' })
    renderAt('/magic-login?token=xyz')
    await waitFor(() => expect(screen.getByText('AREA SOCIO')).toBeInTheDocument())
  })

  it('token caducado/usado (reject) → "Enlace caducado o usado" + mensaje del error', async () => {
    auth.loginWithMagicLink.mockRejectedValue(new Error('token expirado'))
    renderAt('/magic-login?token=old')
    await waitFor(() => expect(screen.getByText('Enlace caducado o usado')).toBeInTheDocument())
    expect(screen.getByText('token expirado')).toBeInTheDocument()
  })
})
