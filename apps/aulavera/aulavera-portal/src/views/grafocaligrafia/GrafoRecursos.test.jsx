// GrafoRecursos — vídeos (facade YouTube), descargables y artículos externos.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../components/Toast'
import GrafoRecursos from './GrafoRecursos'
import { videos } from '../../data/grafocaligrafia/videos'

vi.mock('../../lib/api', () => ({
  leads: { create: vi.fn() },
  DEFAULT_TENANT_ID: '70000000-0000-0000-0000-000000000001',
}))

function renderRecursos() {
  return render(<MemoryRouter><ToastProvider><GrafoRecursos /></ToastProvider></MemoryRouter>)
}

describe('GrafoRecursos', () => {
  it('vídeos: facade con thumbnail; el iframe solo se monta tras el click', () => {
    const { container } = renderRecursos()
    expect(container.querySelectorAll('iframe')).toHaveLength(0)
    const primero = videos[0]
    const facade = screen.getByLabelText(`Reproducir: ${primero.title}`)
    expect(facade.querySelector('img').src).toContain(`/vi/${primero.id}/`)
    fireEvent.click(facade)
    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe.src).toContain(`youtube-nocookie.com/embed/${primero.id}`)
  })

  it('descargables: ligeros desde public/, pesados vía /api/storage/public/:id', () => {
    renderRecursos()
    const plantillas = screen.getByText('Plantillas orientadas')
    expect(plantillas.getAttribute('href')).toBe('/grafocaligrafia/descargables/plantillas-orientadas.pdf')
    expect(plantillas).toHaveAttribute('download')

    const pesado = screen.getByText('Los dibujos en la arena de Vanuatu')
    expect(pesado.getAttribute('href')).toContain('/api/storage/public/3a0f0000-0000-4000-8000-000000000001')
    expect(pesado.getAttribute('href')).toContain('appId=aulavera')
    expect(pesado.getAttribute('href')).toContain('tenantId=70000000-0000-0000-0000-000000000001')
  })

  it('artículos: enlaces externos en pestaña nueva, sin rehospedar', () => {
    renderRecursos()
    const articulo = screen.getByText(/no descuides su escritura manual/)
    expect(articulo.getAttribute('href')).toContain('abc.es')
    expect(articulo).toHaveAttribute('target', '_blank')
    expect(articulo.getAttribute('rel')).toContain('noopener')
  })
})
