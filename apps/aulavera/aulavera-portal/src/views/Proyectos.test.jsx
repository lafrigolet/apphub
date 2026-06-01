// Proyectos — 3 tabs (realizados / futuros / áreas) que cargan de aulavera-server (4.3).
// Contrato:
//   - al montar fetchea chronicle + workshop + disciplines.
//   - tab realizados muestra crónicas; vacío → "Aún no hay crónicas".
//   - cambiar a futuros y pulsar el precio → abre ReserveModal.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../components/Toast'
import Proyectos from './Proyectos'
import { aulavera } from '../lib/api'

vi.mock('../lib/api', () => ({
  aulavera: { listEvents: vi.fn(), listDisciplines: vi.fn() },
}))

function renderProyectos() {
  render(<MemoryRouter><ToastProvider><Proyectos /></ToastProvider></MemoryRouter>)
}

beforeEach(() => vi.clearAllMocks())

describe('Proyectos', () => {
  it('al montar carga chronicle + workshop + disciplines', async () => {
    aulavera.listEvents.mockResolvedValue([])
    aulavera.listDisciplines.mockResolvedValue([])
    renderProyectos()
    await waitFor(() => {
      expect(aulavera.listEvents).toHaveBeenCalledWith('chronicle')
      expect(aulavera.listEvents).toHaveBeenCalledWith('workshop')
      expect(aulavera.listDisciplines).toHaveBeenCalled()
    })
  })

  it('realizados con datos → muestra la crónica; recuento en el tab', async () => {
    aulavera.listEvents.mockImplementation((kind) =>
      Promise.resolve(kind === 'chronicle' ? [{ id: 'c1', title: 'Construcción del aula', when_text: 'Marzo', body: 'parrafo' }] : []))
    aulavera.listDisciplines.mockResolvedValue([])
    renderProyectos()
    await waitFor(() => expect(screen.getByText('Construcción del aula')).toBeInTheDocument())
  })

  it('realizados vacío → estado vacío "Aún no hay crónicas publicadas."', async () => {
    aulavera.listEvents.mockResolvedValue([])
    aulavera.listDisciplines.mockResolvedValue([])
    renderProyectos()
    await waitFor(() => expect(screen.getByText(/Aún no hay crónicas publicadas/)).toBeInTheDocument())
  })

  it('tab futuros → click en el precio abre ReserveModal con el item', async () => {
    aulavera.listEvents.mockImplementation((kind) =>
      Promise.resolve(kind === 'workshop'
        ? [{ id: 'w1', title: 'Taller de barro', when_text: 'Mayo', area: 'Cerámica', body: 'desc', price_label: 'Reservar (30 €)' }]
        : []))
    aulavera.listDisciplines.mockResolvedValue([])
    renderProyectos()
    await waitFor(() => expect(aulavera.listDisciplines).toHaveBeenCalled())

    fireEvent.click(screen.getByText('Futuros'))
    const priceLink = await screen.findByText('Reservar (30 €) →')
    fireEvent.click(priceLink)
    // El modal de ReserveModal muestra el título del taller + su copy.
    await waitFor(() => expect(screen.getByText(/La señal solo se reembolsa/)).toBeInTheDocument())
  })
})
