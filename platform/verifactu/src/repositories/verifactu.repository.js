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

const REGISTRO_COLS = `numero, num_serie, cliente_nombre, cliente_nif, fecha_expedicion,
  importe_total, total_display, estado_remision, huella, huella_anterior, qr_url`

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
        estado_remision, huella, huella_anterior, qr_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING numero, num_serie, cliente_nombre, cliente_nif, fecha_expedicion,
               total_display, estado_remision, huella, huella_anterior`,
    [
      r.appId, r.tenantId, r.subTenantId ?? null, r.numero, r.numSerie, r.tipo ?? 'alta',
      r.tipoFactura ?? 'F1', r.clienteNombre ?? null, r.clienteNif ?? null,
      r.fechaExpedicion ?? null, r.importeTotal ?? null, r.cuotaTotal ?? null, r.totalDisplay ?? null,
      r.estadoRemision ?? 'pendiente', r.huella ?? null, r.huellaAnterior ?? null, r.qrUrl ?? null,
    ],
  )
  return rows[0]
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
            nif_obligado, nombre_obligado
       FROM ${SCHEMA}.config LIMIT 1`,
  )
  return rows[0] ?? null
}

export async function upsertConfig(client, appId, tenantId, patch) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.config
       (app_id, tenant_id, tiempo_espera_envio, max_registros_lote, reintentos, dlq_enabled)
     VALUES ($1,$2,COALESCE($3,60),COALESCE($4,1000),COALESCE($5,3),COALESCE($6,true))
     ON CONFLICT (app_id, tenant_id) DO UPDATE SET
       tiempo_espera_envio = COALESCE($3, ${SCHEMA}.config.tiempo_espera_envio),
       max_registros_lote  = COALESCE($4, ${SCHEMA}.config.max_registros_lote),
       reintentos          = COALESCE($5, ${SCHEMA}.config.reintentos),
       dlq_enabled         = COALESCE($6, ${SCHEMA}.config.dlq_enabled)
     RETURNING tiempo_espera_envio, max_registros_lote, reintentos, dlq_enabled`,
    [appId, tenantId, patch.tiempoEsperaEnvio ?? null, patch.maxRegistrosLote ?? null, patch.reintentos ?? null, patch.dlqEnabled ?? null],
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
