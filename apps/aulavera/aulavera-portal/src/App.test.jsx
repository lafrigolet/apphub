// App — montaje con react-router-dom y conmutación de rutas (4.3).
// Mockea la capa api para que las vistas que fetchean al montar no toquen red.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

vi.mock('./lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  aulavera: { listEvents: vi.fn().mockResolvedValue([]), listDisciplines: vi.fn().mockResolvedValue([]), listResources: vi.fn().mockResolvedValue([]) },
  leads: { create: vi.fn() },
  donations: { checkout: vi.fn() },
  DEFAULT_TENANT_ID: 't',
}))

const renderAt = (path) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)

beforeEach(() => vi.clearAllMocks())

describe('App — routing', () => {
  it('/proyectos monta la vista Proyectos', async () => {
    renderAt('/proyectos')
    await waitFor(() => expect(screen.getByText(/Proyectos & actividades/)).toBeInTheDocument())
  })

  it('/contacto monta la vista Contacto (sección donar)', async () => {
    renderAt('/contacto')
    await waitFor(() => expect(screen.getByText('Donar al proyecto')).toBeInTheDocument())
  })

  it('/grafocaligrafia monta GrafoHome con la marca propia', async () => {
    renderAt('/grafocaligrafia')
    await waitFor(() => expect(screen.getByText('Grafocaligrafía Racional')).toBeInTheDocument())
  })

  it('/grafocaligrafia/metodo monta la vista del método', async () => {
    renderAt('/grafocaligrafia/metodo')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'El análisis grafológico' })).toBeInTheDocument())
  })

  it('ruta desconocida → catch-all a Home (no crashea)', async () => {
    const { container } = renderAt('/ruta-que-no-existe')
    // El layout (nav/footer) se monta; no lanza.
    await waitFor(() => expect(container.querySelector('main')).toBeInTheDocument())
  })
})
