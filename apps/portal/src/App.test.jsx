// portal (admin landing) — smoke + routing (4.4 · P1). Verifica que el router
// monta la LandingView en "/" y que cualquier ruta desconocida redirige a "/".
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('./views/LandingView', () => ({ default: () => <div>LANDING VIEW</div> }))

import App from './App'

const renderAt = (path) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)

describe('portal App — routing smoke', () => {
  it('/ monta LandingView', () => {
    renderAt('/')
    expect(screen.getByText('LANDING VIEW')).toBeInTheDocument()
  })

  it('ruta desconocida → redirige a / (LandingView)', () => {
    renderAt('/no-existe')
    expect(screen.getByText('LANDING VIEW')).toBeInTheDocument()
  })
})
