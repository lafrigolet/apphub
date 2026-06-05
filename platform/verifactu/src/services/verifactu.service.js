import { withTenantTransaction } from '../lib/db.js'
import { calcularHuella, TIPO_HUELLA } from '../lib/huella.js'
import { buildCotejoUrl, parseCotejoUrl } from '../lib/cotejo.js'
import { generarQrDataUri } from '../lib/qr.js'
import { validarRegistro } from '../lib/validacion.js'
import { verificarEnlace } from '../lib/cadena.js'
import { recalcularCadena } from '../lib/rehash.js'
import { construirEvento } from '../lib/sif.js'
import * as repo from '../repositories/verifactu.repository.js'

// Error de regla de negocio. Lleva `statusCode` (422) y `code` para que el
// error handler de Fastify lo traduzca a 4xx en lugar de 500.
export class ReglaNegocioError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
    this.statusCode = 422
    this.name = 'ReglaNegocioError'
  }
}

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

// Registra un evento del SIF con huella encadenada (RegistroEvento · F2).
// Los hooks automáticos (F3) son futuro.
export function crearEvento(scope, { tipoEvento, descripcion }) {
  return tx(scope, async (c) => {
    const cfg = await repo.getConfig(c)
    const huellaAnterior = await repo.lastHuellaEvento(c)
    const ev = construirEvento(
      { tipoEvento, descripcion, obligadoNif: cfg?.nif_obligado, generadoEn: ahoraIso() },
      huellaAnterior,
    )
    const row = await repo.insertEvento(c, { ...scope, ...ev, tsDisplay: 'ahora' })
    return { tag: row.tag, tone: row.tone, text: row.descripcion, ts: row.ts_display, huella: row.huella }
  })
}

// POST nueva factura — calcula la huella encadenada conforme al algoritmo
// AEAT (ver lib/huella.js · VERIFICAR orden de campos contra fuente oficial).
// El IDEmisorFactura es el NIF del OBLIGADO (de config), no el del cliente.
export function crearRegistro(scope, input) {
  return tx(scope, async (c) => {
    const tipo = input.tipo ?? 'alta'
    const cfg = await repo.getConfig(c)
    // idEmisor explícito (p.ej. el emisor por-tenant que snapshotea
    // platform/tpv en cada recibo) > NIF del obligado en config > fallback.
    const idEmisor = input.idEmisor ?? cfg?.nif_obligado ?? input.clienteNif

    // ── num_serie: por serie (correlativo atómico) o explícito ──────────
    const numero = (await repo.maxNumero(c)) + 1 // posición en la cadena del tenant
    let numSerie = input.numSerie
    if (!numSerie && input.serie) {
      const reservado = await repo.reservarNumeroSerie(c, input.serie)
      if (!reservado) {
        throw new ReglaNegocioError('SERIE_INACTIVA', `serie '${input.serie}' inexistente o cerrada`)
      }
      numSerie = `${reservado.codigo}/${String(reservado.numero).padStart(6, '0')}`
    }
    if (!numSerie) numSerie = `2027-A/${String(numero).padStart(6, '0')}`

    // ── reglas de negocio de anulación (uso §2) ─────────────────────────
    if (tipo === 'anulacion') {
      const ref = input.numSerieAnulada ?? input.numSerie
      if (!ref) {
        throw new ReglaNegocioError('ANULACION_SIN_REF', 'una anulación debe referenciar el num_serie de la factura anulada')
      }
      const cuenta = await repo.contarPorNumSerie(c, ref)
      if (cuenta.alta === 0) {
        throw new ReglaNegocioError('ANULACION_NO_CONSTA', `la factura '${ref}' no consta en la cadena del obligado`)
      }
      if (cuenta.anulacion > 0) {
        throw new ReglaNegocioError('ANULACION_DUPLICADA', `la factura '${ref}' ya está anulada`)
      }
      numSerie = ref // el registro de anulación referencia la factura anulada
    }

    const huellaAnterior = await repo.lastHuella(c) // null → PrimerRegistro de la cadena
    const generadoEn = ahoraIso()
    const huella = calcularHuella(
      {
        tipo,
        idEmisor,
        numSerie,
        fechaExpedicion: input.fechaExpedicion,
        tipoFactura:     input.tipoFactura ?? 'F1',
        cuotaTotal:      input.cuotaTotal,
        importeTotal:    input.importeTotal,
        generadoEn,
      },
      huellaAnterior,
    )
    void TIPO_HUELLA // TipoHuella=01 (SHA-256)
    const qrUrl = buildCotejoUrl({
      nif: idEmisor,
      numSerie,
      fecha: input.fechaExpedicion,
      importe: input.importeTotal,
    })
    const row = await repo.insertRegistro(c, {
      ...scope, ...input, tipo, numero, numSerie, huella, huellaAnterior, qrUrl,
      idEmisor, genRegistro: generadoEn,
    })
    return {
      serie: row.num_serie, cliente: row.cliente_nombre, fecha: row.fecha_expedicion,
      total: row.total_display, estado: row.estado_remision, huella: row.huella,
      qrUrl: row.qr_url, numero: row.numero,
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
// Verificación de integridad de la cadena (enlace de huellas) del tenant.
export function verificarCadena(scope) {
  return tx(scope, async (c) => {
    const rows = await repo.listRegistros(c, { limit: 1000 })
    const registros = rows.map((r) => ({
      numero: r.numero, huella: r.huella, huellaAnterior: r.huella_anterior,
    }))
    return verificarEnlace(registros)
  })
}

// Recálculo COMPLETO de la cadena (full re-hash) — recomputa la huella de cada
// registro desde sus campos canónicos persistidos y la compara con la
// almacenada. Detecta manipulaciones e interpolaciones (no solo roturas de
// enlace). Las filas sin campos canónicos se reportan como `noVerificables`.
export function recalcularCadenaCompleta(scope) {
  return tx(scope, async (c) => {
    const rows = await repo.listRegistrosParaRehash(c, { limit: 1000 })
    return recalcularCadena(rows)
  })
}

// ── Series de facturación ─────────────────────────────────────────────
export function listSeries(scope) {
  return tx(scope, async (c) => {
    const rows = await repo.listSeries(c)
    return rows.map((s) => ({
      codigo: s.codigo, descripcion: s.descripcion, ejercicio: s.ejercicio,
      siguiente: s.siguiente, activa: s.activa,
    }))
  })
}

export function crearSerie(scope, input) {
  return tx(scope, async (c) => {
    const s = await repo.insertSerie(c, { ...scope, ...input })
    return { codigo: s.codigo, descripcion: s.descripcion, ejercicio: s.ejercicio, siguiente: s.siguiente, activa: s.activa }
  })
}

export function cerrarSerie(scope, codigo) {
  return tx(scope, async (c) => {
    const s = await repo.cerrarSerie(c, codigo)
    if (!s) throw new ReglaNegocioError('SERIE_NO_ENCONTRADA', `serie '${codigo}' no encontrada`)
    return { codigo: s.codigo, descripcion: s.descripcion, ejercicio: s.ejercicio, siguiente: s.siguiente, activa: s.activa }
  })
}

// ── Exportación legal (uso §16 / recomendación #10) ───────────────────
// Volcado de la cadena completa (registros + eventos + identidad del SIF) en
// formato JSON para entrega a la Administración. Registra automáticamente el
// evento EXPORTACION encadenado en la cadena de eventos del SIF.
export function exportar(scope) {
  return tx(scope, async (c) => {
    const cfg = await repo.getConfig(c)
    const registros = await repo.exportRegistros(c)
    const eventos = await repo.exportEventos(c)

    // Evento EXPORTACION encadenado (antes de capturar el snapshot de eventos
    // ya no, para no auto-incluirlo; queda registrado para la próxima auditoría).
    const huellaAnteriorEv = await repo.lastHuellaEvento(c)
    const ev = construirEvento(
      { tipoEvento: 'EXPORTACION', obligadoNif: cfg?.nif_obligado, generadoEn: ahoraIso() },
      huellaAnteriorEv,
    )
    await repo.insertEvento(c, { ...scope, ...ev, tsDisplay: 'ahora' })

    return {
      meta: {
        appId: scope.appId,
        tenantId: scope.tenantId,
        obligado: { nif: cfg?.nif_obligado ?? null, nombre: cfg?.nombre_obligado ?? null },
        generadoEn: ahoraIso(),
        totalRegistros: registros.length,
        totalEventos: eventos.length,
      },
      registros: registros.map((r) => ({
        numero: r.numero, numSerie: r.num_serie, tipo: r.tipo, tipoFactura: r.tipo_factura,
        idEmisor: r.id_emisor, clienteNombre: r.cliente_nombre, clienteNif: r.cliente_nif,
        fechaExpedicion: r.fecha_expedicion, importeTotal: r.importe_total, cuotaTotal: r.cuota_total,
        generadoEn: r.gen_registro, huella: r.huella, huellaAnterior: r.huella_anterior,
        estadoRemision: r.estado_remision,
      })),
      eventos: eventos.map((e) => ({
        tag: e.tag, descripcion: e.descripcion, huella: e.huella, huellaAnterior: e.huella_anterior,
        ocurridoEn: e.ocurrido_en,
      })),
    }
  })
}

// Registro de muestra autoconsistente (para el validador cuando no se aporta uno).
function muestraRegistro() {
  const r = {
    idEmisor: 'B12345678', numSerie: '2027-A/000128', fechaExpedicion: '02-01-2027',
    tipoFactura: 'F1', cuotaTotal: '21.00', importeTotal: '121.00',
    generadoEn: '2027-01-02T10:15:30+01:00',
  }
  r.huella = calcularHuella(r, null)
  return r
}

// POST validar — validación ESTRUCTURAL + integridad de huella (no XSD oficial,
// ver lib/validacion.js · E2 pendiente). Valida el `registro` aportado o una
// muestra autoconsistente.
export function validar(input = {}) {
  return validarRegistro(input.registro ?? muestraRegistro())
}
