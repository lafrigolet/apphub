// GrafoCurso — inscripción al curso profesional de Grafología Racional.
// Contrato: submit del form → leads.create con source
// 'aulavera/grafocaligrafia-curso' (REUSE de platform/leads, sin backend nuevo).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../components/Toast'
import GrafoCurso from './GrafoCurso'
import { leads } from '../../lib/api'

vi.mock('../../lib/api', () => ({
  leads: { create: vi.fn() },
  DEFAULT_TENANT_ID: 't',
}))

function renderCurso() {
  render(<MemoryRouter><ToastProvider><GrafoCurso /></ToastProvider></MemoryRouter>)
}

beforeEach(() => vi.clearAllMocks())

describe('GrafoCurso — inscripción', () => {
  it('muestra info del curso (plazas + destinatarios)', () => {
    renderCurso()
    expect(screen.getByText('Solo hay 10 plazas por curso.')).toBeInTheDocument()
    expect(screen.getByText('Profesores y educadores')).toBeInTheDocument()
  })

  it('submit → leads.create con source aulavera/grafocaligrafia-curso + perfil en el mensaje', async () => {
    leads.create.mockResolvedValue({ id: 'l1' })
    renderCurso()
    fireEvent.change(screen.getByLabelText('Tu nombre'), { target: { value: 'Marga' } })
    fireEvent.change(screen.getByLabelText('Tu email'), { target: { value: 'marga@x.com' } })
    fireEvent.change(screen.getByLabelText('Tu perfil'), { target: { value: 'Padre / madre' } })
    fireEvent.click(screen.getByLabelText(/Acepto el tratamiento/i))
    fireEvent.submit(screen.getByText('Solicitar plaza →').closest('form'))

    await waitFor(() => expect(leads.create).toHaveBeenCalled())
    expect(leads.create.mock.calls[0][0]).toMatchObject({
      contactName: 'Marga',
      email: 'marga@x.com',
      source: 'aulavera/grafocaligrafia-curso',
    })
    expect(leads.create.mock.calls[0][0].message).toContain('Padre / madre')
    await waitFor(() => expect(screen.getByText(/Solicitud enviada/)).toBeInTheDocument())
  })

  it('error de la API → toast de error y el form no se resetea', async () => {
    leads.create.mockRejectedValue(new Error('boom'))
    renderCurso()
    fireEvent.change(screen.getByLabelText('Tu nombre'), { target: { value: 'Marga' } })
    fireEvent.change(screen.getByLabelText('Tu email'), { target: { value: 'marga@x.com' } })
    fireEvent.click(screen.getByLabelText(/Acepto el tratamiento/i))
    fireEvent.submit(screen.getByText('Solicitar plaza →').closest('form'))

    await waitFor(() => expect(screen.getByText(/No se pudo enviar la solicitud/)).toBeInTheDocument())
    expect(screen.getByLabelText('Tu nombre').value).toBe('Marga')
  })
})
