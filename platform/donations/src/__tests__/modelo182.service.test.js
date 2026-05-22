import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub client cuya .query es un dispatcher por SQL.
const queries = []
const stubClient = {
  query: vi.fn(async (sql, params) => {
    queries.push({ sql, params })
    if (/FROM platform_tenants\.tenants/i.test(sql)) {
      return {
        rows: [{
          legal_name:   'Fundación AulaVera',
          display_name: 'AulaVera',
          cif:          'G-12345678',
          address:      'Calle Olivo 1, Losar de la Vera',
        }],
      }
    }
    if (/FROM platform_donations\.donations/i.test(sql)) {
      // 2 donantes con NIF distintos.
      return {
        rows: [
          {
            donor_nif:         'X1234567L',
            donor_name:        'Juan Pérez',
            donor_address:     null,
            donor_postal_code: null,
            donor_country:     'ES',
            total_cents:       '12500',
            count_donations:   '2',
          },
          {
            donor_nif:         '12345678Z',
            donor_name:        'María García',
            donor_address:     null,
            donor_postal_code: null,
            donor_country:     'ES',
            total_cents:       '5000',
            count_donations:   '1',
          },
        ],
      }
    }
    return { rows: [] }
  }),
}

vi.mock('../lib/db.js', () => ({
  withTenantTransaction: vi.fn(async (_a, _t, _s, fn) => fn(stubClient)),
}))

import { exportModelo182 } from '../services/modelo182.service.js'

beforeEach(() => { queries.length = 0; vi.clearAllMocks() })

const admin = { userId: 'a1', role: 'admin', appId: 'aulavera', tenantId: 't1' }
const donor = { userId: 'u1', role: 'user',  appId: 'aulavera', tenantId: 't1' }

describe('exportModelo182 — autorización + validación', () => {
  it('rechaza si el caller no es admin', async () => {
    await expect(exportModelo182(donor, { year: 2026 })).rejects.toMatchObject({ statusCode: 403 })
  })
  it('rechaza si year no es entero', async () => {
    await expect(exportModelo182(admin, { year: '2026' })).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('exportModelo182 — formato AEAT', () => {
  it('genera 1 cabecera (tipo 1) + N detalles (tipo 2) — 600 chars cada línea, CRLF terminators', async () => {
    const out = await exportModelo182(admin, { year: 2026 })

    expect(out.filename).toBe('MODELO_182_2026_G-12345678.txt')
    expect(out.year).toBe(2026)
    expect(out.count).toBe(2)
    expect(out.totalCents).toBe(17500)

    // El buffer es latin1, conversión transparente con toString('latin1').
    const txt = out.buffer.toString('latin1')
    const lines = txt.split('\r\n').filter(l => l.length > 0)

    expect(lines).toHaveLength(3)              // 1 header + 2 detalles
    for (const line of lines) {
      expect(line.length).toBe(600)            // ancho fijo AEAT
    }

    // Header empieza por '1' + '182' + year
    expect(lines[0].slice(0, 8)).toBe('1182' + '2026')
    // Detalle empieza por '2' + '182' + year
    expect(lines[1].slice(0, 8)).toBe('2182' + '2026')
    expect(lines[2].slice(0, 8)).toBe('2182' + '2026')
  })

  it('codifica en ISO-8859-1, NO en UTF-8 (caracteres latinos ocupan 1 byte)', async () => {
    const out = await exportModelo182(admin, { year: 2026 })
    // En latin1, "Pérez" = 5 bytes (P, é=1 byte, r, e, z). En UTF-8 sería 6.
    // El nombre del donante "Juan Pérez" aparece en uppercase en el campo de 40 chars.
    // Buscamos los bytes esperados para 'Á' (NIF declarante "JUAN PÉREZ" en uppercase).
    const txt = out.buffer.toString('latin1')
    // La "É" en latin1 es el byte 0xC9; verificamos que el detalle contiene el byte.
    const detalle = txt.split('\r\n')[1]
    expect(detalle).toContain('JUAN PÉREZ')  // É = 0xC9 = U+00C9 en latin1
  })

  it('importes en céntimos (15 chars padded zeros en cabecera, 13 chars en detalle)', async () => {
    const out = await exportModelo182(admin, { year: 2026 })
    const txt    = out.buffer.toString('latin1')
    const header = txt.split('\r\n')[0]

    // Posiciones 138-152 (1-based) = índices 137-152 (0-based exclusive end):
    const totalField = header.slice(137, 152)
    expect(totalField).toBe(String(17500).padStart(15, '0'))

    // Detalle: importe en céntimos, 13 chars, ubicado tras (NIF declarado +
    // representante + nombre + provincia + país):
    // 1 + 3 + 4 + 9 + 9 + 9 + 40 + 2 + 2 = idx 79 (0-based)
    const det1    = txt.split('\r\n')[1]
    const importe = det1.slice(79, 79 + 13)
    expect(importe).toBe(String(12500).padStart(13, '0'))
  })

  it('rechaza con TENANT_MISSING_CIF si el tenant no tiene CIF', async () => {
    stubClient.query.mockImplementationOnce(async () => ({
      rows: [{ legal_name: 'X', display_name: 'X', cif: null, address: null }],
    }))
    await expect(exportModelo182(admin, { year: 2026 })).rejects.toMatchObject({
      code: 'TENANT_MISSING_CIF',
      statusCode: 412,
    })
  })
})
