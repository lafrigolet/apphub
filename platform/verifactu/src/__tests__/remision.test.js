import { describe, it, expect } from 'vitest'
import { remitir } from '../lib/remision.js'
import { ENDPOINTS } from '../lib/soap-envelope.js'

const RESP = `<Envelope><Body><RespuestaRegFactuSistemaFacturacion>
  <EstadoEnvio>Correcto</EstadoEnvio><CSV>CSV-OK</CSV>
</RespuestaRegFactuSistemaFacturacion></Body></Envelope>`

describe('remitir (gated)', () => {
  it('sin certificado (pfx) lanza error claro — inerte', async () => {
    await expect(remitir({ envelopeXml: '<x/>' })).rejects.toThrow(/certificado no configurado/)
  })

  it('con pfx pero sin envelope lanza', async () => {
    await expect(remitir({ pfx: Buffer.from('x') })).rejects.toThrow(/envelopeXml/)
  })

  it('con pfx + transport inyectado: resuelve endpoint y parsea respuesta', async () => {
    const calls = []
    const transport = async (url, body, opts) => {
      calls.push({ url, body, opts })
      return { status: 200, body: RESP }
    }
    const out = await remitir(
      { envelopeXml: '<soap/>', pfx: Buffer.from('p12'), passphrase: 'pw' },
      { transport },
    )
    expect(out.endpoint).toBe(ENDPOINTS.verifactu.test)
    expect(out.status).toBe(200)
    expect(out.respuesta.estadoEnvio).toBe('Correcto')
    expect(out.respuesta.csv).toBe('CSV-OK')
    expect(calls[0].url).toBe(ENDPOINTS.verifactu.test)
    expect(calls[0].opts).toMatchObject({ passphrase: 'pw' })
  })

  it('usa el endpoint de producción/sello según opciones', async () => {
    const transport = async () => ({ status: 200, body: RESP })
    const out = await remitir(
      { envelopeXml: '<x/>', pfx: Buffer.from('p'), entorno: 'prod', sello: true },
      { transport },
    )
    expect(out.endpoint).toBe(ENDPOINTS.verifactu.prod_sello)
  })
})
