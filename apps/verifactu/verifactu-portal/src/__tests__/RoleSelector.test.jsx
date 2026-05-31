import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import RoleSelector from '../views/RoleSelector.jsx'
import { roles } from '../data/roles.js'

const renderHub = () => render(<MemoryRouter><RoleSelector /></MemoryRouter>)

describe('RoleSelector', () => {
  it('renderiza una tarjeta por cada rol del catálogo', () => {
    renderHub()
    for (const r of roles) {
      expect(screen.getByText(r.title)).toBeInTheDocument()
    }
  })

  it('cada tarjeta enlaza a la ruta del rol', () => {
    renderHub()
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    for (const r of roles) {
      expect(hrefs).toContain(r.to)
    }
  })

  it('muestra la nota "VeriFactu no se homologa"', () => {
    renderHub()
    expect(screen.getByText(/no se homologa/i)).toBeInTheDocument()
  })
})
