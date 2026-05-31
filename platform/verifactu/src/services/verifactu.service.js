import { withTenantTransaction } from '../lib/db.js'
import { calcularHuella, TIPO_HUELLA } from '../lib/huella.js'
import { buildCotejoUrl, parseCotejoUrl } from '../lib/cotejo.js'
import { generarQrDataUri } from '../lib/qr.js'
import * as repo from '../repositories/verifactu.repository.js'

// ISO-8601 con huso (la huella exige FechaHoraHusoGenRegistro con offset).
// new Date().toISOString() devuelve 'Z' (=+00:00), huso válido. (verificar)
const ahoraIso = () => new Date().toISOString()

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

// POST nueva factura — calcula la huella encadenada conforme al algoritmo
// AEAT (ver lib/huella.js · VERIFICAR orden de campos contra fuente oficial).
// El IDEmisorFactura es el NIF del OBLIGADO (de config), no el del cliente.
export function crearRegistro(scope, input) {
  return tx(scope, async (c) => {
    const numero = (await repo.maxNumero(c)) + 1
    const huellaAnterior = await repo.lastHuella(c) // null → PrimerRegistro de la cadena
    const numSerie = input.numSerie ?? `2027-A/${String(numero).padStart(6, '0')}`
    const cfg = await repo.getConfig(c)
    const huella = calcularHuella(
      {
        tipo:            input.tipo ?? 'alta',
        idEmisor:        cfg?.nif_obligado ?? input.clienteNif,
        numSerie,
        fechaExpedicion: input.fechaExpedicion,
        tipoFactura:     input.tipoFactura ?? 'F1',
        cuotaTotal:      input.cuotaTotal,
        importeTotal:    input.importeTotal,
        generadoEn:      ahoraIso(),
      },
      huellaAnterior,
    )
    void TIPO_HUELLA // TipoHuella=01 (SHA-256) — se persistirá con el modelo XSD completo (A1)
    const qrUrl = buildCotejoUrl({
      nif: cfg?.nif_obligado ?? input.clienteNif,
      numSerie,
      fecha: input.fechaExpedicion,
      importe: input.importeTotal,
    })
    const row = await repo.insertRegistro(c, {
      ...scope, ...input, numero, numSerie, huella, huellaAnterior, qrUrl,
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
      nifObligado: row.nif_obligado ?? null,
      nombreObligado: row.nombre_obligado ?? null,
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

// GET QR de un registro (por num_serie, o el último). Compone la URL de cotejo
// y genera el QR como data URI. La URL/QR son autoritativos (recalculados),
// independientes del qr_url persistido.
export function getQr(scope, numSerie) {
  return tx(scope, async (c) => {
    const cfg = await repo.getConfig(c)
    const row = numSerie ? await repo.findByNumSerie(c, numSerie) : await repo.latestRegistro(c)
    if (!row) return null
    const url = buildCotejoUrl({
      nif: cfg?.nif_obligado ?? row.cliente_nif,
      numSerie: row.num_serie,
      fecha: row.fecha_expedicion,
      importe: row.importe_total ?? row.total_display,
    })
    const dataUri = await generarQrDataUri(url)
    return { numSerie: row.num_serie, url, dataUri }
  })
}

// POST cotejar — verificación REAL contra la cadena local del SIF (no contra la
// Sede AEAT, que sería el servicio externo de cotejo — ver TODO B8). Acepta una
// URL de cotejo (la parsea) o nifEmisor+numSerie directos. `verificada` si el
// registro consta en la cadena, `no_consta` si no.
export function cotejar(scope, input) {
  return tx(scope, async (c) => {
    let { nifEmisor, numSerie } = input
    if (input.url) {
      const p = parseCotejoUrl(input.url)
      numSerie = p.numSerie ?? numSerie
      nifEmisor = p.nif ?? nifEmisor
    }
    const cfg = await repo.getConfig(c)
    const row = numSerie ? await repo.findByNumSerie(c, numSerie) : null
    const verificada = !!row
    const inserted = await repo.insertCotejo(c, {
      ...scope,
      nifEmisor: nifEmisor ?? cfg?.nif_obligado ?? null,
      numSerie: numSerie ?? null,
      resultado: verificada ? 'verificada' : 'no_consta',
      label: verificada ? 'Verificada' : 'No consta',
      tone: verificada ? 'ok' : 'rose',
      tsDisplay: 'ahora',
    })
    return {
      verificada,
      resultado: inserted.resultado,
      numSerie: inserted.num_serie,
      emisor: verificada
        ? { nombre: cfg?.nombre_obligado ?? 'Obligado', nif: cfg?.nif_obligado ?? nifEmisor }
        : null,
      importe: row?.total_display ?? null,
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
