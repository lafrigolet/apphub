// verifactu.repository — SQL shape de platform_verifactu.*.
// Regresión sobre tabla/columnas/params. Cubre el encadenado de huellas
// (lastHuella / lastHuellaEvento), inserts parametrizados y el upsert de config.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/verifactu.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('listRegistros', () => {
  it('SELECT FROM platform_verifactu.registros ORDER BY numero DESC, LIMIT $1', async () => {
    const c = mockClient([{ numero: 1 }])
    await repo.listRegistros(c, { limit: 3 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_verifactu\.registros/)
    expect(sql).toMatch(/ORDER BY numero DESC NULLS LAST/)
    expect(params).toEqual([3])
  })

  it('limit por defecto = 200', async () => {
    const c = mockClient([])
    await repo.listRegistros(c)
    expect(c.query.mock.calls[0][1]).toEqual([200])
  })
})

describe('maxNumero / lastHuella — encadenado', () => {
  it('maxNumero → COALESCE(MAX(numero),0)', async () => {
    const c = mockClient([{ max: 7 }])
    expect(await repo.maxNumero(c)).toBe(7)
    expect(c.query.mock.calls[0][0]).toMatch(/COALESCE\(MAX\(numero\), 0\)/)
  })

  it('lastHuella sin registros → null', async () => {
    const c = mockClient([])
    expect(await repo.lastHuella(c)).toBeNull()
  })

  it('lastHuella con registro → su huella', async () => {
    const c = mockClient([{ huella: 'H9' }])
    expect(await repo.lastHuella(c)).toBe('H9')
  })

  it('lastHuellaEvento filtra huella IS NOT NULL', async () => {
    const c = mockClient([{ huella: 'EVH' }])
    await repo.lastHuellaEvento(c)
    expect(c.query.mock.calls[0][0]).toMatch(/WHERE huella IS NOT NULL/)
  })

  it('lastHuellaEvento sin eventos → null (rama rows[0]?.huella ?? null)', async () => {
    const c = mockClient([])
    expect(await repo.lastHuellaEvento(c)).toBeNull()
  })
})

describe('insertRegistro', () => {
  it('INSERT con 23 params en orden; defaults aplicados (id_emisor/gen_registro de 0007 + refs cruzadas de 0008)', async () => {
    const c = mockClient([{ num_serie: 'A/1' }])
    await repo.insertRegistro(c, {
      appId: 'aikikan', tenantId: 't1', numero: 6, numSerie: '2027-A/000006',
      huella: 'H6', huellaAnterior: 'H5', qrUrl: 'http://q',
      importeTotal: 121, cuotaTotal: 21,
      idEmisor: 'B12345678', genRegistro: '2027-01-02T10:15:30+01:00',
      origen: 'orders', orderId: 'o9',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_verifactu\.registros/)
    expect(sql).toMatch(/VALUES \(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11,\$12,\$13,\$14,\$15,\$16,\$17,\$18,\$19,\$20,\$21,\$22,\$23\)/)
    expect(params[19]).toBe('orders')   // origen
    expect(params[20]).toBe('o9')       // order_id
    expect(params[21]).toBeNull()       // donation_id
    expect(params[22]).toBeNull()       // bill_id
    expect(params[0]).toBe('aikikan')
    expect(params[3]).toBe(6)            // numero
    expect(params[5]).toBe('alta')       // tipo default
    expect(params[6]).toBe('F1')         // tipo_factura default
    expect(params[13]).toBe('pendiente') // estado_remision default
    expect(params[14]).toBe('H6')        // huella
    expect(params[15]).toBe('H5')        // huella_anterior
    expect(params[16]).toBe('http://q')  // qr_url
    expect(params[17]).toBe('B12345678') // id_emisor (campo canónico de la huella)
    expect(params[18]).toBe('2027-01-02T10:15:30+01:00') // gen_registro (FechaHoraHusoGenRegistro)
  })

  it('id_emisor / gen_registro ausentes → null (filas sin campos canónicos)', async () => {
    const c = mockClient([{ num_serie: 'A/1' }])
    await repo.insertRegistro(c, { appId: 'a', tenantId: 't', numero: 1, numSerie: 'A/1' })
    const params = c.query.mock.calls[0][1]
    expect(params[17]).toBeNull() // id_emisor
    expect(params[18]).toBeNull() // gen_registro
  })
})

describe('insertRegistro — valores explícitos (rama no-default)', () => {
  it('tipo/tipoFactura/estadoRemision/subTenantId explícitos + opcionales nulos', async () => {
    const c = mockClient([{ num_serie: 'A/2' }])
    await repo.insertRegistro(c, {
      appId: 'a', tenantId: 't', subTenantId: 's', numero: 9, numSerie: 'A/9',
      tipo: 'anulacion', tipoFactura: 'F2', clienteNombre: 'Ana', clienteNif: 'X1',
      fechaExpedicion: '02-01-2027', estadoRemision: 'aceptada',
      // huella, huellaAnterior, qrUrl, importeTotal, cuotaTotal, totalDisplay ausentes → null
    })
    const params = c.query.mock.calls[0][1]
    expect(params[2]).toBe('s')          // sub_tenant_id explícito
    expect(params[5]).toBe('anulacion')  // tipo explícito
    expect(params[6]).toBe('F2')         // tipo_factura explícito
    expect(params[10]).toBeNull()        // importe_total ausente
    expect(params[11]).toBeNull()        // cuota_total ausente
    expect(params[12]).toBeNull()        // total_display ausente
    expect(params[13]).toBe('aceptada')  // estado_remision explícito
    expect(params[14]).toBeNull()        // huella ausente
    expect(params[16]).toBeNull()        // qr_url ausente
  })
})

describe('insertEvento', () => {
  it('campos opcionales ausentes → null (subTenantId/tsDisplay/huellaAnterior)', async () => {
    const c = mockClient([{ tag: 'X' }])
    await repo.insertEvento(c, { appId: 'a', tenantId: 't', tag: 'X', tone: 'ok', descripcion: 'd', huella: 'H' })
    const params = c.query.mock.calls[0][1]
    expect(params[2]).toBeNull() // sub_tenant_id
    expect(params[6]).toBeNull() // ts_display
    expect(params[8]).toBeNull() // huella_anterior
  })

  it('INSERT en eventos con huella + huella_anterior', async () => {
    const c = mockClient([{ tag: 'ALTA' }])
    await repo.insertEvento(c, {
      appId: 'a', tenantId: 't', tag: 'ALTA', tone: 'ok', descripcion: 'd',
      tsDisplay: 'ahora', huella: 'EVH', huellaAnterior: 'EPREV',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_verifactu\.eventos/)
    expect(params).toEqual(['a', 't', null, 'ALTA', 'ok', 'd', 'ahora', 'EVH', 'EPREV'])
  })
})

describe('findByNumSerie / latestRegistro', () => {
  it('findByNumSerie WHERE num_serie = $1; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findByNumSerie(c, 'A/1')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE num_serie = \$1/)
    expect(params).toEqual(['A/1'])
  })

  it('latestRegistro ORDER BY numero DESC LIMIT 1', async () => {
    const c = mockClient([{ num_serie: 'LAST' }])
    const out = await repo.latestRegistro(c)
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY numero DESC NULLS LAST/)
    expect(out).toEqual({ num_serie: 'LAST' })
  })

  it('latestRegistro sin registros → null (rama rows[0] ?? null)', async () => {
    const c = mockClient([])
    expect(await repo.latestRegistro(c)).toBeNull()
  })
})

describe('upsertConfig', () => {
  it('ON CONFLICT (app_id, tenant_id) DO UPDATE con COALESCE (patch parcial)', async () => {
    const c = mockClient([{ reintentos: 5 }])
    await repo.upsertConfig(c, 'a', 't', { reintentos: 5 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_verifactu\.config/)
    expect(sql).toMatch(/ON CONFLICT \(app_id, tenant_id\) DO UPDATE/)
    expect(sql).toMatch(/COALESCE/)
    // campos no provistos → null (el SQL aplica COALESCE al default)
    expect(params).toEqual(['a', 't', null, null, 5, null, null, null, null])
  })
})

describe('insertCotejo', () => {
  it('INSERT en cotejos con resultado/label/tone', async () => {
    const c = mockClient([{ resultado: 'verificada' }])
    await repo.insertCotejo(c, {
      appId: 'a', tenantId: 't', nifEmisor: 'B1', numSerie: 'A/1',
      resultado: 'verificada', label: 'Verificada', tone: 'ok', tsDisplay: 'ahora',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_verifactu\.cotejos/)
    expect(params).toEqual(['a', 't', null, 'B1', 'A/1', 'verificada', 'Verificada', 'ok', 'ahora'])
  })

  it('opcionales ausentes → null + tsDisplay default "ahora"', async () => {
    const c = mockClient([{}])
    await repo.insertCotejo(c, { appId: 'a', tenantId: 't', resultado: 'no_consta', label: 'No consta', tone: 'rose' })
    const params = c.query.mock.calls[0][1]
    expect(params[2]).toBeNull()    // sub_tenant_id
    expect(params[3]).toBeNull()    // nif_emisor
    expect(params[4]).toBeNull()    // num_serie
    expect(params[8]).toBe('ahora') // ts_display default
  })

  it('listCotejos ORDER BY created_at DESC LIMIT 50', async () => {
    const c = mockClient([])
    await repo.listCotejos(c)
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY created_at DESC LIMIT 50/)
  })
})

describe('upsertConfig — patch completo (rama valores presentes)', () => {
  it('todos los campos provistos → params no-null', async () => {
    const c = mockClient([{ reintentos: 7 }])
    await repo.upsertConfig(c, 'a', 't', {
      tiempoEsperaEnvio: 30, maxRegistrosLote: 500, reintentos: 7, dlqEnabled: false,
      nifObligado: 'B12345678', nombreObligado: 'ACME SL', entorno: 'prod',
    })
    expect(c.query.mock.calls[0][1]).toEqual(['a', 't', 30, 500, 7, false, 'B12345678', 'ACME SL', 'prod'])
  })
})

// ── list helpers + inserts/config no cubiertos antes ──────────────────

describe('listEventos', () => {
  it('SELECT eventos ORDER BY ocurrido_en ASC', async () => {
    const c = mockClient([{ tag: 'x' }])
    const r = await repo.listEventos(c)
    expect(c.query.mock.calls[0][0]).toMatch(/FROM platform_verifactu\.eventos/)
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY ocurrido_en ASC/)
    expect(r).toEqual([{ tag: 'x' }])
  })
})

describe('listLotes', () => {
  it('SELECT lotes ORDER BY created_at DESC', async () => {
    const c = mockClient([{ codigo: 'L1' }])
    await repo.listLotes(c)
    expect(c.query.mock.calls[0][0]).toMatch(/FROM platform_verifactu\.lotes/)
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY created_at DESC/)
  })
})

describe('listClientes / listRepresentacion', () => {
  it('listClientes ORDER BY created_at ASC', async () => {
    const c = mockClient([{ nombre: 'Ana' }])
    await repo.listClientes(c)
    expect(c.query.mock.calls[0][0]).toMatch(/FROM platform_verifactu\.clientes/)
  })
  it('listRepresentacion filtra repr_estado NOT NULL', async () => {
    const c = mockClient([{ nombre: 'Ana' }])
    await repo.listRepresentacion(c)
    expect(c.query.mock.calls[0][0]).toMatch(/WHERE repr_estado IS NOT NULL/)
  })
})

describe('insertCliente', () => {
  it('INSERT con defaults facturas_mes=0 / estado=ok', async () => {
    const c = mockClient([{ nombre: 'Ana' }])
    await repo.insertCliente(c, { appId: 'a', tenantId: 't', nombre: 'Ana', nif: 'X1' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_verifactu\.clientes/)
    expect(params).toEqual(['a', 't', null, 'Ana', 'X1', 0, 'ok'])
  })
  it('respeta valores explícitos', async () => {
    const c = mockClient([{}])
    await repo.insertCliente(c, { appId: 'a', tenantId: 't', subTenantId: 's', nombre: 'B', nif: 'Y', facturasMes: 5, estado: 'alerta' })
    expect(c.query.mock.calls[0][1]).toEqual(['a', 't', 's', 'B', 'Y', 5, 'alerta'])
  })
})

describe('listCertificados', () => {
  it('SELECT certificados ORDER BY created_at ASC', async () => {
    const c = mockClient([{ nombre: 'cert' }])
    await repo.listCertificados(c)
    expect(c.query.mock.calls[0][0]).toMatch(/FROM platform_verifactu\.certificados/)
  })
})

describe('getConfig', () => {
  it('SELECT config LIMIT 1 → row', async () => {
    const c = mockClient([{ reintentos: 3 }])
    expect(await repo.getConfig(c)).toEqual({ reintentos: 3 })
  })
  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.getConfig(c)).toBeNull()
  })
})
