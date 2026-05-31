import { withTenantTransaction } from '../lib/db.js'
import { calcularHuella } from '../lib/huella.js'
import * as repo from '../repositories/verifactu.repository.js'

// Etiqueta de las "remisiones recientes" del resumen (distinta de la tabla).
const REMISION_LABEL = { ok: 'Aceptada', warn: 'Con advertencia', err: 'Rechazada' }

const tx = (scope, fn) =>
  withTenantTransaction(scope.appId, scope.tenantId, scope.subTenantId ?? null, fn)

// ── Emisor ────────────────────────────────────────────────────────────
export function listFacturas(scope) {
  return tx(scope, async (c) => {
    const rows = await repo.listRegistros(c, {})
    return rows.map((r) => ({
      serie: r.num_serie,
      cliente: r.cliente_nombre,
      fecha: r.fecha_expedicion,
      total: r.total_display,
      estado: r.estado_remision,
      huella: r.huella,
    }))
  })
}

export function listRemisiones(scope) {
  return tx(scope, async (c) => {
    const rows = await repo.listRegistros(c, { limit: 3 })
    return rows.map((r) => ({
      serie: r.num_serie,
      cliente: r.cliente_nombre,
      label: REMISION_LABEL[r.estado_remision] ?? r.estado_remision,
      tone: r.estado_remision,
    }))
  })
}

export function listCadena(scope) {
  return tx(scope, async (c) => {
    const rows = await repo.listRegistros(c, { limit: 3 })
    return rows.map((r, i) => ({
      n: r.numero,
      serie: r.num_serie,
      huella: r.huella,
      anterior: r.huella_anterior ?? undefined,
      current: i === 0,
    }))
  })
}

export function listEventos(scope) {
  return tx(scope, async (c) => {
    const rows = await repo.listEventos(c)
    return rows.map((e) => ({ tag: e.tag, tone: e.tone, text: e.descripcion, ts: e.ts_display }))
  })
}

// POST nueva factura — calcula la huella encadenada (STUB, ver lib/huella.js).
export function crearRegistro(scope, input) {
  return tx(scope, async (c) => {
    const numero = (await repo.maxNumero(c)) + 1
    const huellaAnterior = await repo.lastHuella(c)
    const numSerie = input.numSerie ?? `2027-A/${String(numero).padStart(6, '0')}`
    const huella = calcularHuella(
      { ...input, numSerie, generadoEn: new Date().toISOString() },
      huellaAnterior,
    )
    const row = await repo.insertRegistro(c, {
      ...scope, ...input, numero, numSerie, huella, huellaAnterior,
    })
    return {
      serie: row.num_serie, cliente: row.cliente_nombre, fecha: row.fecha_expedicion,
      total: row.total_display, estado: row.estado_remision, huella: row.huella,
    }
  })
}

// ── Asesoría ──────────────────────────────────────────────────────────
export function listClientes(scope) {
  return tx(scope, async (c) => {
    const rows = await repo.listClientes(c)
    return rows.map((r) => ({ nombre: r.nombre, nif: r.nif, facturasMes: r.facturas_mes, estado: r.estado }))
  })
}

export function listLotes(scope) {
  return tx(scope, async (c) => {
    const rows = await repo.listLotes(c)
    return rows.map((l) => ({ id: l.codigo, info: l.info, label: l.label, tone: l.tone, pulse: l.pulse }))
  })
}

export function listRepresentacion(scope) {
  return tx(scope, async (c) => {
    const rows = await repo.listRepresentacion(c)
    return rows.map((r) => ({
      representado: r.nombre, nif: r.nif, doc: r.apoderamiento_doc,
      vigencia: r.apoderamiento_vigencia, estado: r.repr_estado, tone: r.repr_tone,
    }))
  })
}

export function crearCliente(scope, input) {
  return tx(scope, async (c) => {
    const row = await repo.insertCliente(c, { ...scope, ...input })
    return { nombre: row.nombre, nif: row.nif, facturasMes: row.facturas_mes, estado: row.estado }
  })
}

// ── Administrador ─────────────────────────────────────────────────────
export function listCertificados(scope) {
  return tx(scope, async (c) => {
    const rows = await repo.listCertificados(c)
    return rows.map((r) => ({ nombre: r.nombre, meta: r.meta, estado: r.estado, tone: r.tone, iconTone: r.icon_tone }))
  })
}

export function getConfig(scope) {
  return tx(scope, async (c) => {
    const row = (await repo.getConfig(c)) ?? { tiempo_espera_envio: 60, max_registros_lote: 1000, reintentos: 3, dlq_enabled: true }
    return {
      tiempoEsperaEnvio: row.tiempo_espera_envio,
      maxRegistrosLote: row.max_registros_lote,
      reintentos: row.reintentos,
      dlqEnabled: row.dlq_enabled,
    }
  })
}

export function patchConfig(scope, patch) {
  return tx(scope, async (c) => {
    const row = await repo.upsertConfig(c, scope.appId, scope.tenantId, patch)
    return {
      tiempoEsperaEnvio: row.tiempo_espera_envio,
      maxRegistrosLote: row.max_registros_lote,
      reintentos: row.reintentos,
      dlqEnabled: row.dlq_enabled,
    }
  })
}

// ── Receptor ──────────────────────────────────────────────────────────
export function listCotejos(scope) {
  return tx(scope, async (c) => {
    const rows = await repo.listCotejos(c)
    return rows.map((r) => ({
      label: r.label, tone: r.tone, resultado: r.resultado,
      ref: `${r.nif_emisor} · ${r.num_serie}`, ts: r.ts_display,
    }))
  })
}

// POST cotejar — STUB: la verificación real consulta la Sede AEAT.
// TODO(fuente-oficial): llamar al servicio de cotejo de la AEAT con los
// parámetros del QR. Aquí registramos un cotejo "verificada" determinista.
export function cotejar(scope, input) {
  return tx(scope, async (c) => {
    const row = await repo.insertCotejo(c, {
      ...scope,
      nifEmisor: input.nifEmisor, numSerie: input.numSerie,
      resultado: 'verificada', label: 'Verificada', tone: 'ok', tsDisplay: 'ahora',
    })
    return {
      verificada: true,
      emisor: { nombre: 'Ejemplo S.L.', nif: row.nif_emisor },
      numSerie: row.num_serie,
    }
  })
}

// ── Desarrollador ─────────────────────────────────────────────────────
// POST validar — STUB: validación real contra el XSD oficial (libxmljs2).
// TODO(fuente-oficial): cargar el XSD vigente de la AEAT y validar.
export function validar() {
  return {
    ok: true,
    checks: [
      { level: 'ok', text: '✓ Estructura conforme al esquema' },
      { level: 'warn', text: '⚠ Recordatorio: la huella debe calcularse con el orden de campos oficial' },
    ],
  }
}
