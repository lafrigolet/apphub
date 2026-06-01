// MemberHome — área de socio: saludo + logout + retorno de Stripe (4.2 · P1).
// Contrato:
//   - saluda con el nombre derivado del email de identity.
//   - botón "Cerrar sesión" → onLogout().
//   - ?fees_status=success → aterriza en la vista de cuotas con aviso.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MemberHome from './MemberHome'

// Las subvistas hacen fetch al montar; las stubbeamos a placeholders.
vi.mock('./MemberProfile.jsx', () => ({ default: () => <div>PERFIL</div> }))
vi.mock('./MemberFees.jsx', () => ({ default: () => <div>CUOTAS</div> }))
vi.mock('./MemberEvents.jsx', () => ({ default: () => <div>EVENTOS</div> }))
vi.mock('./MemberCertificates.jsx', () => ({ default: () => <div>CERTIFICADOS</div> }))

const identity = { email: 'kenji@dojo.com', role: 'user' }

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/area-socio')
})

describe('MemberHome', () => {
  it('saluda con el nombre derivado del email (parte local)', () => {
    render(<MemberHome identity={identity} onLogout={vi.fn()} />)
    expect(screen.getByText('kenji')).toBeInTheDocument()
  })

  it('"Cerrar sesión" → onLogout()', () => {
    const onLogout = vi.fn()
    render(<MemberHome identity={identity} onLogout={onLogout} />)
    fireEvent.click(screen.getByText('Cerrar sesión'))
    expect(onLogout).toHaveBeenCalled()
  })

  it('?fees_status=success → abre la vista de cuotas con aviso de pago', () => {
    window.history.replaceState(null, '', '/area-socio?fees_status=success')
    render(<MemberHome identity={identity} onLogout={vi.fn()} />)
    expect(screen.getByText('CUOTAS')).toBeInTheDocument()
    expect(screen.getByText(/Pago completado/)).toBeInTheDocument()
  })
})
