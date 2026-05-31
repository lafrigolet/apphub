import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Mock del wrapper de API (mismo módulo resuelto que importa Receptor).
vi.mock('../lib/api.js', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))
import { api } from '../lib/api.js'
import Receptor from '../views/receptor/Receptor.jsx'

const renderReceptor = () => render(<MemoryRouter><Receptor /></MemoryRouter>)

beforeEach(() => {
  api.get.mockReset()
  api.post.mockReset()
  api.get.mockResolvedValue([]) // historial de cotejos vacío
})

describe('Receptor', () => {
  it('carga el historial de cotejos al montar', async () => {
    renderReceptor()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/api/verifactu/cotejos')))
  })

  it('cotejo verificado muestra "Factura verificada" con los datos del emisor', async () => {
    api.post.mockResolvedValue({
      verificada: true, resultado: 'verificada', numSerie: '2027-A/000128',
      emisor: { nombre: 'Ejemplo S.L.', nif: 'B12345678' }, importe: '121,00 €',
    })
    renderReceptor()
    fireEvent.click(screen.getByText(/Simular escaneo y cotejar/i))
    await waitFor(() => expect(screen.getByText('Factura verificada')).toBeInTheDocument())
    expect(screen.getByText('Ejemplo S.L.')).toBeInTheDocument()
    expect(api.post).toHaveBeenCalledWith('/api/verifactu/cotejo', expect.objectContaining({ numSerie: '2027-A/000128' }))
  })

  it('cotejo no_consta muestra "No consta"', async () => {
    api.post.mockResolvedValue({ verificada: false, resultado: 'no_consta', numSerie: '2099-Z/9' })
    renderReceptor()
    fireEvent.click(screen.getByText(/Cotejar en sede AEAT/i))
    await waitFor(() => expect(screen.getAllByText('No consta').length).toBeGreaterThan(0))
  })
})
