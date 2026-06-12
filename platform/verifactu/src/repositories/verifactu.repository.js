const SCHEMA = 'platform_verifactu'

// ── Registros / cadena ────────────────────────────────────────────────
export async function listRegistros(client, { limit = 200 } = {}) {
  const { rows } = await client.query(
    `SELECT numero, num_serie, cliente_nombre, cliente_nif, fecha_expedicion,
            total_display, estado_remision, huella, huella_anterior
       FROM ${SCHEMA}.registros
      ORDER BY numero DESC NULLS LAST, created_at DESC
      LIMIT $1`,
    [limit],
  )
  return rows
}

export async function maxNumero(client) {
  const { rows } = await client.query(`SELECT COALESCE(MAX(numero), 0) AS max FROM ${SCHEMA}.registros`)
  return rows[0].max
}

const REGISTRO_COLS = `numero, num_serie, tipo, cliente_nombre, cliente_nif, fecha_expedicion,
  importe_total, total_display, estado_remision, huella, huella_anterior, qr_url`

// Cuenta registros de un num_serie por tipo — para reglas de anulación
// (impedir anular algo que no existe o que ya está anulado).
export async function contarPorNumSerie(client, numSerie) {
  const { rows } = await client.query(
    `SELECT tipo, COUNT(*)::int AS n FROM ${SCHEMA}.registros
      WHERE num_serie = $1 GROUP BY tipo`,
    [numSerie],
  )
  const out = { alta: 0, anulacion: 0 }
  for (const r of rows) out[r.tipo] = r.n
  return out
}

export async function findByNumSerie(client, numSerie) {
  const { rows } = await client.query(
    `SELECT ${REGISTRO_COLS} FROM ${SCHEMA}.registros WHERE num_serie = $1 LIMIT 1`,
    [numSerie],
  )
  return rows[0] ?? null
}

export async function latestRegistro(client) {
  const { rows } = await client.query(
    `SELECT ${REGISTRO_COLS} FROM ${SCHEMA}.registros
      ORDER BY numero DESC NULLS LAST, created_at DESC LIMIT 1`,
  )
  return rows[0] ?? null
}

export async function lastHuella(client) {
  const { rows } = await client.query(
    `SELECT huella FROM ${SCHEMA}.registros ORDER BY numero DESC NULLS LAST, created_at DESC LIMIT 1`,
  )
  return rows[0]?.huella ?? null
}

export async function insertRegistro(client, r) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.registros
       (app_id, tenant_id, sub_tenant_id, numero, num_serie, tipo, tipo_factura,
        cliente_nombre, cliente_nif, fecha_expedicion, importe_total, cuota_total, total_display,
        estado_remision, huella, huella_anterior, qr_url, id_emisor, gen_registro,
        origen, order_id, donation_id, bill_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     RETURNING id, numero, num_serie, cliente_nombre, cliente_nif, fecha_expedicion,
               total_display, estado_remision, huella, huella_anterior, qr_url`,
    [
      r.appId, r.tenantId, r.subTenantId ?? null, r.numero, r.numSerie, r.tipo ?? 'alta',
      r.tipoFactura ?? 'F1', r.clienteNombre ?? null, r.clienteNif ?? null,
      r.fechaExpedicion ?? null, r.importeTotal ?? null, r.cuotaTotal ?? null, r.totalDisplay ?? null,
      r.estadoRemision ?? 'pendiente', r.huella ?? null, r.huellaAnterior ?? null, r.qrUrl ?? null,
      r.idEmisor ?? null, r.genRegistro ?? null,
      r.origen ?? null, r.orderId ?? null, r.donationId ?? null, r.billId ?? null,
    ],
  )
  return rows[0]
}

// Dedupe de integración por eventos: ¿ya existe un registro para este documento
// de origen? (los índices únicos parciales lo garantizan a nivel de motor, pero
// comprobarlo antes evita la excepción y es idempotente ante reentrega).
export async function existeRegistroPorRef(client, campo, valor) {
  if (!['order_id', 'donation_id', 'bill_id'].includes(campo)) {
    throw new Error(`campo de dedupe no permitido: ${campo}`)
  }
  const { rows } = await client.query(
    `SELECT 1 FROM ${SCHEMA}.registros WHERE ${campo} = $1 LIMIT 1`, [valor],
  )
  return rows.length > 0
}

// Registros con TODOS los campos canónicos de la huella, ascendente por número,
// para el recálculo completo de la cadena (full re-hash, auditoría).
export async function listRegistrosParaRehash(client, { limit = 1000 } = {}) {
  const { rows } = await client.query(
    `SELECT numero, num_serie, tipo, tipo_factura, id_emisor, fecha_expedicion,
            cuota_total, importe_total, gen_registro, huella, huella_anterior
       FROM ${SCHEMA}.registros
      ORDER BY numero ASC NULLS LAST, created_at ASC
      LIMIT $1`,
    [limit],
  )
  return rows
}

// ── Eventos ───────────────────────────────────────────────────────────
export async function listEventos(client) {
  const { rows } = await client.query(
    `SELECT tag, tone, descripcion, ts_display
       FROM ${SCHEMA}.eventos ORDER BY ocurrido_en ASC, created_at ASC`,
  )
  return rows
}

export async function lastHuellaEvento(client) {
  const { rows } = await client.query(
    `SELECT huella FROM ${SCHEMA}.eventos WHERE huella IS NOT NULL
      ORDER BY ocurrido_en DESC, created_at DESC LIMIT 1`,
  )
  return rows[0]?.huella ?? null
}

export async function insertEvento(client, e) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.eventos
       (app_id, tenant_id, sub_tenant_id, tag, tone, descripcion, ts_display, huella, huella_anterior)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING tag, tone, descripcion, ts_display, huella`,
    [e.appId, e.tenantId, e.subTenantId ?? null, e.tag, e.tone, e.descripcion, e.tsDisplay ?? null, e.huella, e.huellaAnterior ?? null],
  )
  return rows[0]
}

// ── Lotes ─────────────────────────────────────────────────────────────
export async function listLotes(client) {
  const { rows } = await client.query(
    `SELECT codigo, info, label, tone, pulse
       FROM ${SCHEMA}.lotes ORDER BY created_at DESC`,
  )
  return rows
}

// ── Clientes / representación ─────────────────────────────────────────
export async function listClientes(client) {
  const { rows } = await client.query(
    `SELECT nombre, nif, facturas_mes, estado
       FROM ${SCHEMA}.clientes ORDER BY created_at ASC`,
  )
  return rows
}

export async function listRepresentacion(client) {
  const { rows } = await client.query(
    `SELECT nombre, nif, apoderamiento_doc, apoderamiento_vigencia, repr_estado, repr_tone
       FROM ${SCHEMA}.clientes WHERE repr_estado IS NOT NULL ORDER BY created_at ASC`,
  )
  return rows
}

export async function insertCliente(client, c) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.clientes
       (app_id, tenant_id, sub_tenant_id, nombre, nif, facturas_mes, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING nombre, nif, facturas_mes, estado`,
    [c.appId, c.tenantId, c.subTenantId ?? null, c.nombre, c.nif, c.facturasMes ?? 0, c.estado ?? 'ok'],
  )
  return rows[0]
}

// ── Certificados ──────────────────────────────────────────────────────
export async function listCertificados(client) {
  const { rows } = await client.query(
    `SELECT nombre, meta, estado, tone, icon_tone
       FROM ${SCHEMA}.certificados ORDER BY created_at ASC`,
  )
  return rows
}

// ── Config (control de flujo) ─────────────────────────────────────────
export async function getConfig(client) {
  const { rows } = await client.query(
    `SELECT tiempo_espera_envio, max_registros_lote, reintentos, dlq_enabled,
            nif_obligado, nombre_obligado, entorno
       FROM ${SCHEMA}.config LIMIT 1`,
  )
  return rows[0] ?? null
}

export async function upsertConfig(client, appId, tenantId, patch) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.config
       (app_id, tenant_id, tiempo_espera_envio, max_registros_lote, reintentos, dlq_enabled,
        nif_obligado, nombre_obligado, entorno)
     VALUES ($1,$2,COALESCE($3,60),COALESCE($4,1000),COALESCE($5,3),COALESCE($6,true),
             $7,$8,COALESCE($9,'test'))
     ON CONFLICT (app_id, tenant_id) DO UPDATE SET
       tiempo_espera_envio = COALESCE($3, ${SCHEMA}.config.tiempo_espera_envio),
       max_registros_lote  = COALESCE($4, ${SCHEMA}.config.max_registros_lote),
       reintentos          = COALESCE($5, ${SCHEMA}.config.reintentos),
       dlq_enabled         = COALESCE($6, ${SCHEMA}.config.dlq_enabled),
       nif_obligado        = COALESCE($7, ${SCHEMA}.config.nif_obligado),
       nombre_obligado     = COALESCE($8, ${SCHEMA}.config.nombre_obligado),
       entorno             = COALESCE($9, ${SCHEMA}.config.entorno)
     RETURNING tiempo_espera_envio, max_registros_lote, reintentos, dlq_enabled,
               nif_obligado, nombre_obligado, entorno`,
    [appId, tenantId, patch.tiempoEsperaEnvio ?? null, patch.maxRegistrosLote ?? null,
     patch.reintentos ?? null, patch.dlqEnabled ?? null,
     patch.nifObligado ?? null, patch.nombreObligado ?? null, patch.entorno ?? null],
  )
  return rows[0]
}

// ── Cotejos (receptor) ────────────────────────────────────────────────
export async function listCotejos(client) {
  const { rows } = await client.query(
    `SELECT nif_emisor, num_serie, resultado, label, tone, ts_display
       FROM ${SCHEMA}.cotejos ORDER BY created_at DESC LIMIT 50`,
  )
  return rows
}

export async function insertCotejo(client, c) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.cotejos
       (app_id, tenant_id, sub_tenant_id, nif_emisor, num_serie, resultado, label, tone, ts_display)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING nif_emisor, num_serie, resultado, label, tone, ts_display`,
    [c.appId, c.tenantId, c.subTenantId ?? null, c.nifEmisor ?? null, c.numSerie ?? null,
     c.resultado, c.label, c.tone, c.tsDisplay ?? 'ahora'],
  )
  return rows[0]
}

// ── Series de facturación ─────────────────────────────────────────────
export async function listSeries(client) {
  const { rows } = await client.query(
    `SELECT codigo, descripcion, ejercicio, siguiente, activa
       FROM ${SCHEMA}.series ORDER BY created_at ASC`,
  )
  return rows
}

export async function insertSerie(client, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.series (app_id, tenant_id, sub_tenant_id, codigo, descripcion, ejercicio, siguiente, activa)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,1),COALESCE($8,true))
     RETURNING codigo, descripcion, ejercicio, siguiente, activa`,
    [s.appId, s.tenantId, s.subTenantId ?? null, s.codigo, s.descripcion ?? null,
     s.ejercicio ?? null, s.siguiente ?? null, s.activa ?? null],
  )
  return rows[0]
}

// Reserva el siguiente correlativo de una serie ACTIVA de forma atómica
// (FOR UPDATE bloquea la fila durante la transacción → sin huecos ni colisiones).
// Devuelve null si la serie no existe o está cerrada.
export async function reservarNumeroSerie(client, codigo) {
  const { rows } = await client.query(
    `SELECT codigo, ejercicio, siguiente, activa FROM ${SCHEMA}.series
      WHERE codigo = $1 FOR UPDATE`,
    [codigo],
  )
  const serie = rows[0]
  if (!serie || !serie.activa) return null
  await client.query(
    `UPDATE ${SCHEMA}.series SET siguiente = siguiente + 1 WHERE codigo = $1`,
    [codigo],
  )
  return { codigo: serie.codigo, ejercicio: serie.ejercicio, numero: serie.siguiente }
}

export async function cerrarSerie(client, codigo) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.series SET activa = false WHERE codigo = $1
     RETURNING codigo, descripcion, ejercicio, siguiente, activa`,
    [codigo],
  )
  return rows[0] ?? null
}

// ── Exportación legal ─────────────────────────────────────────────────
export async function exportRegistros(client) {
  const { rows } = await client.query(
    `SELECT numero, num_serie, tipo, tipo_factura, id_emisor, cliente_nombre, cliente_nif,
            fecha_expedicion, importe_total, cuota_total, gen_registro, huella, huella_anterior,
            estado_remision, created_at
       FROM ${SCHEMA}.registros ORDER BY numero ASC NULLS LAST, created_at ASC`,
  )
  return rows
}

export async function exportEventos(client) {
  const { rows } = await client.query(
    `SELECT tag, tone, descripcion, ts_display, huella, huella_anterior, ocurrido_en, created_at
       FROM ${SCHEMA}.eventos ORDER BY ocurrido_en ASC, created_at ASC`,
  )
  return rows
}
