// Repositorio de la cola de remisión (estado MUTABLE de cada registro frente a la
// AEAT). Los `registros` son append-only, así que todo el ciclo de vida del envío
// vive aquí: encolar → reclamar (enviando) → resultado (ok/warn/err/dlq).

const SCHEMA = 'platform_verifactu'

// Crea una entrada de cola para cada registro que aún no la tenga (idempotente).
// max_intentos/entorno se snapshotean al encolar.
export async function encolarPendientes(client, { maxIntentos = 3, entorno = 'test' } = {}) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.remision_queue
        (app_id, tenant_id, sub_tenant_id, registro_id, num_serie, max_intentos, entorno)
     SELECT r.app_id, r.tenant_id, r.sub_tenant_id, r.id, r.num_serie, $1, $2
       FROM ${SCHEMA}.registros r
      WHERE NOT EXISTS (
        SELECT 1 FROM ${SCHEMA}.remision_queue q WHERE q.registro_id = r.id
      )
     ON CONFLICT (app_id, tenant_id, registro_id) DO NOTHING
     RETURNING id`,
    [maxIntentos, entorno],
  )
  return rows.length
}

// Reclama hasta `limit` filas vencidas (pendiente o err con back-off cumplido),
// marcándolas 'enviando' atómicamente. FOR UPDATE SKIP LOCKED evita que dos
// drenados concurrentes reclamen la misma fila (doble envío).
export async function reclamarVencidos(client, { limit = 1000 } = {}) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.remision_queue q
        SET estado = 'enviando', updated_at = now()
      WHERE q.id IN (
        SELECT id FROM ${SCHEMA}.remision_queue
         WHERE estado IN ('pendiente','err')
           AND proximo_intento <= now()
         ORDER BY created_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING q.id, q.registro_id, q.num_serie, q.intentos, q.max_intentos, q.entorno`,
    [limit],
  )
  return rows
}

// Campos canónicos de los registros para construir el envelope.
export async function registrosCanonicos(client, ids) {
  if (!ids.length) return []
  const { rows } = await client.query(
    `SELECT id, num_serie, tipo, tipo_factura, id_emisor, cliente_nombre, cliente_nif,
            fecha_expedicion, importe_total, cuota_total, gen_registro, huella, huella_anterior
       FROM ${SCHEMA}.registros WHERE id = ANY($1::uuid[])`,
    [ids],
  )
  return rows
}

export async function registroCanonicoPorNumSerie(client, numSerie) {
  const { rows } = await client.query(
    `SELECT id, num_serie, tipo, tipo_factura, id_emisor, cliente_nombre, cliente_nif,
            fecha_expedicion, importe_total, cuota_total, gen_registro, huella, huella_anterior
       FROM ${SCHEMA}.registros WHERE num_serie = $1 LIMIT 1`,
    [numSerie],
  )
  return rows[0] ?? null
}

// Aplica el resultado de la AEAT a una fila de la cola. err con reintentos
// agotados → 'dlq'; err con reintentos disponibles → 'err' + back-off exponencial
// (2^intentos minutos). 'ok'/'warn' fijan el CSV definitivo.
export async function marcarResultado(client, queueId, { estado, estadoAeat, csv, codigoError, ultimoError, loteCodigo }) {
  const final = estado === 'err'
    ? `CASE WHEN intentos + 1 >= max_intentos THEN 'dlq' ELSE 'err' END`
    : `'${estado}'`
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.remision_queue
        SET estado = ${final},
            intentos = intentos + 1,
            estado_aeat = $2,
            csv_aeat = COALESCE($3, csv_aeat),
            codigo_error = $4,
            ultimo_error = $5,
            lote_codigo = $6,
            remitido_en = now(),
            proximo_intento = CASE WHEN $1 = 'err'
              THEN now() + (power(2, LEAST(intentos + 1, 10)) || ' minutes')::interval
              ELSE proximo_intento END
      WHERE id = $7
      RETURNING id, estado`,
    [estado, estadoAeat ?? null, csv ?? null, codigoError ?? null, ultimoError ?? null, loteCodigo ?? null, queueId],
  )
  return rows[0] ?? null
}

// Fallo de transporte (no llegó respuesta por línea): devuelve las filas
// reclamadas a 'err'/'dlq' con back-off, sin CSV.
export async function marcarErrorTransporte(client, queueIds, mensaje) {
  if (!queueIds.length) return
  await client.query(
    `UPDATE ${SCHEMA}.remision_queue
        SET estado = CASE WHEN intentos + 1 >= max_intentos THEN 'dlq' ELSE 'err' END,
            intentos = intentos + 1,
            ultimo_error = $2,
            proximo_intento = now() + (power(2, LEAST(intentos + 1, 10)) || ' minutes')::interval,
            updated_at = now()
      WHERE id = ANY($1::uuid[])`,
    [queueIds, mensaje],
  )
}

export async function listCola(client, { limit = 100 } = {}) {
  const { rows } = await client.query(
    `SELECT q.num_serie, q.estado, q.intentos, q.max_intentos, q.proximo_intento,
            q.estado_aeat, q.csv_aeat, q.codigo_error, q.ultimo_error, q.lote_codigo,
            q.remitido_en, q.entorno
       FROM ${SCHEMA}.remision_queue q
      ORDER BY q.created_at DESC LIMIT $1`,
    [limit],
  )
  return rows
}

export async function resumenCola(client) {
  const { rows } = await client.query(
    `SELECT estado, COUNT(*)::int AS n FROM ${SCHEMA}.remision_queue GROUP BY estado`,
  )
  const out = { pendiente: 0, enviando: 0, ok: 0, warn: 0, err: 0, dlq: 0 }
  for (const r of rows) out[r.estado] = r.n
  return out
}

// Reactiva una entrada en DLQ (o cualquier no-ok) para reintento inmediato.
export async function reintentarDlq(client, id) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.remision_queue
        SET estado = 'pendiente', proximo_intento = now(), ultimo_error = NULL, updated_at = now()
      WHERE id = $1 AND estado IN ('dlq','err')
      RETURNING id, num_serie, estado`,
    [id],
  )
  return rows[0] ?? null
}

// ── Lotes ──────────────────────────────────────────────────────────────
export async function insertLote(client, l) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.lotes
        (app_id, tenant_id, sub_tenant_id, codigo, info, label, tone, pulse,
         estado_envio, csv, num_registros, entorno, respondido_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,$9,$10,$11,now())
     RETURNING codigo`,
    [l.appId, l.tenantId, l.subTenantId ?? null, l.codigo, l.info ?? null, l.label ?? null,
     l.tone ?? 'azul', l.estadoEnvio ?? null, l.csv ?? null, l.numRegistros ?? null, l.entorno ?? null],
  )
  return rows[0]
}

export async function loteDetalle(client, codigo) {
  const { rows: lote } = await client.query(
    `SELECT codigo, info, label, tone, estado_envio, csv, num_registros, entorno, respondido_en, created_at
       FROM ${SCHEMA}.lotes WHERE codigo = $1 LIMIT 1`,
    [codigo],
  )
  if (!lote[0]) return null
  const { rows: lineas } = await client.query(
    `SELECT num_serie, estado, estado_aeat, csv_aeat, codigo_error, ultimo_error, remitido_en
       FROM ${SCHEMA}.remision_queue WHERE lote_codigo = $1 ORDER BY num_serie`,
    [codigo],
  )
  return { ...lote[0], lineas }
}

// Siguiente código de lote del tenant (LOTE-NNNN sin huecos por tenant).
export async function siguienteCodigoLote(client) {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${SCHEMA}.lotes`)
  return `LOTE-${String(rows[0].n + 1).padStart(4, '0')}`
}
