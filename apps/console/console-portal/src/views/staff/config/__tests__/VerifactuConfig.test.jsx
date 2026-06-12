import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import VerifactuConfig from '../VerifactuConfig'
import { api } from '../../../../lib/api'

const toast = vi.fn()
vi.mock('../../../../context/AppContext', () => ({ useApp: () => ({ toast }) }))
vi.mock('../../../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }))

const CONFIG = { nifObligado: 'B12345678', nombreObligado: 'ACME SL', entorno: 'test', tiempoEsperaEnvio: 60, maxRegistrosLote: 1000, reintentos: 3, dlqEnabled: true }

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation((path) => {
    if (path.startsWith('/api/tenants/tenants')) return Promise.resolve({ data: [{ id: 't1', app_id: 'shop', display_name: 'ACME', cif: 'B12345678' }] })
    if (path.startsWith('/api/verifactu/config')) return Promise.resolve({ data: { ...CONFIG } })
    if (path.startsWith('/api/verifactu/certificados')) return Promise.resolve({ data: [{ id: 'c1', cn: 'ACME SL', emisor: 'FNMT', uso: 'firma', caducaEn: '2028-09-14', activo: true }] })
    if (path.startsWith('/api/verifactu/cola')) return Promise.resolve({ data: { resumen: { pendiente: 2, ok: 5, dlq: 0 } } })
    return Promise.resolve({ data: [] })
  })
  api.patch.mockResolvedValue({})
  api.post.mockResolvedValue({})
  api.delete.mockResolvedValue({})
})

async function selectTenant() {
  render(<VerifactuConfig />)
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/tenants/tenants'))
  await waitFor(() => screen.getByRole('option', { name: /ACME · shop/ }))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 't1' } })
  await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/\/api\/verifactu\/config\?appId=shop&tenantId=t1/)))
}

describe('VerifactuConfig', () => {
  it('carga tenants y, al elegir uno, carga su config/certs/cola con impersonación', async () => {
    await selectTenant()
    await waitFor(() => expect(screen.getByText(/Obligado tributario y entorno/)).toBeInTheDocument())
    // la cola se muestra
    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/\/api\/verifactu\/certificados\?appId=shop&tenantId=t1/))
    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/\/api\/verifactu\/cola\?appId=shop&tenantId=t1/))
  })

  it('guardar configuración → PATCH con scope de impersonación y entorno', async () => {
    await selectTenant()
    await waitFor(() => screen.getByText('Guardar configuración'))
    fireEvent.click(screen.getByText('Guardar configuración'))
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/verifactu\/config\?appId=shop&tenantId=t1/),
      expect.objectContaining({ nifObligado: 'B12345678', entorno: 'test' }),
    ))
  })

  it('eliminar certificado → DELETE con id y scope', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await selectTenant()
    await waitFor(() => screen.getByText('Eliminar'))
    fireEvent.click(screen.getByText('Eliminar'))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(expect.stringMatching(/\/api\/verifactu\/certificados\/c1\?appId=shop&tenantId=t1/)))
  })
})
