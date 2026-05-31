import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }))
import { api } from '../lib/api.js'

import Emisor from '../views/emisor/Emisor.jsx'
import Asesoria from '../views/asesoria/Asesoria.jsx'
import Administrador from '../views/administrador/Administrador.jsx'
import Desarrollador from '../views/desarrollador/Desarrollador.jsx'

// Mock genérico: config → objeto, qr → {url,dataUri}, el resto → array.
function mockApi() {
  api.get.mockImplementation((url) => {
    if (url.includes('/config')) return Promise.resolve({ tiempoEsperaEnvio: 60, maxRegistrosLote: 1000, reintentos: 3, dlqEnabled: true })
    if (url.includes('/qr')) return Promise.resolve({ numSerie: '2027-A/000128', url: 'https://x/ValidarQR', dataUri: 'data:image/png;base64,AAAA' })
    if (url.includes('/registros')) return Promise.resolve([{ serie: '2027-A/000128', cliente: 'C', fecha: '02-01-2027', total: '121,00 €', estado: 'ok', huella: 'H' }])
    return Promise.resolve([])
  })
  api.patch.mockResolvedValue({ dlqEnabled: false })
}

const renderView = (Comp) => render(<MemoryRouter><Comp /></MemoryRouter>)

beforeEach(() => {
  api.get.mockReset(); api.post.mockReset(); api.patch.mockReset()
  mockApi()
})

describe('vistas dashboard (smoke + consumo de API)', () => {
  it('Emisor renderiza el resumen y carga facturas', async () => {
    renderView(Emisor)
    expect(screen.getByText(/Buenas tardes/i)).toBeInTheDocument()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/api/verifactu/registros')))
  })

  it('Asesoría renderiza la cartera de clientes', async () => {
    renderView(Asesoria)
    expect(screen.getAllByText(/Cartera de clientes/i).length).toBeGreaterThan(0)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/api/verifactu/clientes')))
  })

  it('Administrador renderiza certificados y carga config', async () => {
    renderView(Administrador)
    expect(screen.getAllByText(/Certificados/i).length).toBeGreaterThan(0)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/api/verifactu/config')))
  })

  it('Desarrollador renderiza el entorno de pruebas', () => {
    renderView(Desarrollador)
    expect(screen.getByText(/Entorno de pruebas externas/i)).toBeInTheDocument()
  })
})
