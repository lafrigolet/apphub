// GrafoMetodo — los 12 trazos + Gran Test (V1 estático).
// Contrato: renderiza los 12 nombres de trazo y las 3 facultades del test.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../components/Toast'
import GrafoMetodo from './GrafoMetodo'
import { trazos } from '../../data/grafocaligrafia/trazos'

vi.mock('../../lib/api', () => ({
  leads: { create: vi.fn() },
  DEFAULT_TENANT_ID: 't',
}))

function renderMetodo() {
  render(<MemoryRouter><ToastProvider><GrafoMetodo /></ToastProvider></MemoryRouter>)
}

describe('GrafoMetodo', () => {
  it('los datos definen exactamente 12 trazos, 4 por facultad', () => {
    expect(trazos).toHaveLength(12)
    for (const grupo of ['inteligencia', 'sentimiento', 'voluntad']) {
      expect(trazos.filter((t) => t.grupo === grupo)).toHaveLength(4)
    }
  })

  it('renderiza los 12 trazos con su dirección', () => {
    renderMetodo()
    for (const t of trazos) {
      expect(screen.getByText(t.nombre)).toBeInTheDocument()
    }
    expect(screen.getByText('Sube regresando')).toBeInTheDocument()
    expect(screen.getByText('Avanza subiendo')).toBeInTheDocument()
  })

  it('renderiza el Gran Test con las tres grandes facultades', () => {
    renderMetodo()
    expect(screen.getByText('La Inteligencia')).toBeInTheDocument()
    expect(screen.getByText('El Sentimiento')).toBeInTheDocument()
    expect(screen.getByText('La Voluntad')).toBeInTheDocument()
    expect(screen.getByText('ABCD / 1, 4, 7, 10')).toBeInTheDocument()
  })
})
