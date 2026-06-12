import { withTenantTransaction } from '../lib/db.js'
import { construirEnvelope, registroAltaXml, parseRespuesta } from '../lib/soap-envelope.js'
import { remitir } from '../lib/remision.js'
import { firmarRegistro as firmarXml } from '../lib/xades.js'
import { parsePkcs12 } from '../lib/pkcs12.js'
import * as repo from '../repositories/verifactu.repository.js'
import * as remRepo from '../repositories/remision.repository.js'
import * as certRepo from '../repositories/certificados.repository.js'
import { ReglaNegocioError } from './verifactu.service.js'
import { logger } from '../lib/logger.js'

const tx = (scope, fn) =>
  withTenantTransaction(scope.appId, scope.tenantId, scope.subTenantId ?? null, fn)

// Fila de registros (BD) → forma que espera construirEnvelope/registroAltaXml.
function aRegistroEnvelope(row, obligadoNombre) {
  return {
    tipo: row.tipo,
    idEmisor: row.id_emisor,
    numSerie: row.num_serie,
    fechaExpedicion: row.fecha_expedicion,
    tipoFactura: row.tipo_factura,
    nombreEmisor: obligadoNombre ?? row.id_emisor,
    cuotaTotal: row.cuota_total,
    importeTotal: row.importe_total,
    huella: row.huella,
    huellaAnterior: row.huella_anterior,
    generadoEn: row.gen_registro,
  }
}

// EstadoRegistro de la AEAT → estado interno de la cola.
function mapEstado(estadoAeat, estadoEnvio) {
  const v = estadoAeat ?? estadoEnvio
  if (v === 'Correcto') return 'ok'
  if (v === 'AceptadoConErrores') return 'warn'
  if (v == null) return estadoEnvio === 'Correcto' ? 'ok' : 'err'
  return 'err'
}

// Encola los registros aún sin entrada de cola (idempotente). No remite.
export function encolar(scope) {
  return tx(scope, async (c) => {
    const cfg = await repo.getConfig(c)
    const n = await remRepo.encolarPendientes(c, { maxIntentos: cfg?.reintentos ?? 3, entorno: cfg?.entorno ?? 'test' })
    return { encolados: n }
  })
}

// Drena la cola del tenant: reclama los vencidos, construye el envelope, remite a
// la AEAT (mTLS con el cert activo) y persiste el resultado por línea + el lote.
// `transport` es inyectable (tests). Reutilizable desde el endpoint POST /remitir
// y desde el subscriber verifactu.remision.due (worker del scheduler).
export async function drenar(scope, { transport } = {}) {
  // ── Fase 1 (tx): encolar + reclamar + reunir datos + material del cert ──
  const prep = await tx(scope, async (c) => {
    const cfg = await repo.getConfig(c)
    await remRepo.encolarPendientes(c, { maxIntentos: cfg?.reintentos ?? 3, entorno: cfg?.entorno ?? 'test' })
    const claimed = await remRepo.reclamarVencidos(c, { limit: cfg?.max_registros_lote ?? 1000 })
    if (!claimed.length) return null
    const registros = await remRepo.registrosCanonicos(c, claimed.map((r) => r.registro_id))
    const material = await certRepo.getCertificadoActivoMaterial(c, { uso: 'firma' })
    return { cfg, claimed, registros, material }
  })
  if (!prep) return { remitidos: 0 }

  const { cfg, claimed, registros, material } = prep
  const entorno = claimed[0]?.entorno ?? 'test'
  const obligado = { nif: cfg?.nif_obligado, nombre: cfg?.nombre_obligado }

  // Sin certificado no hay mTLS posible → devolvemos las filas reclamadas a err.
  if (!material?.pkcs12) {
    await tx(scope, (c) => remRepo.marcarErrorTransporte(c, claimed.map((r) => r.id), 'sin certificado activo (mTLS)'))
    throw new ReglaNegocioError('SIN_CERTIFICADO', 'no hay certificado activo para remitir a la AEAT')
  }

  // ── Fase 2 (red, fuera de transacción): envelope + POST SOAP mTLS ──
  const payload = registros.map((r) => aRegistroEnvelope(r, obligado.nombre))
  let respuesta, errorTransporte
  try {
    const envelopeXml = construirEnvelope({ obligado, registros: payload })
    const res = await remitir(
      { envelopeXml, pfx: material.pkcs12, passphrase: material.passphrase, entorno },
      transport ? { transport } : {},
    )
    respuesta = res.respuesta
  } catch (err) {
    errorTransporte = err.message
    logger.error({ err }, 'remisión: fallo de transporte')
  }

  // ── Fase 3 (tx): persistir resultado por línea + lote ──
  return tx(scope, async (c) => {
    if (errorTransporte) {
      await remRepo.marcarErrorTransporte(c, claimed.map((r) => r.id), errorTransporte)
      return { remitidos: 0, error: errorTransporte }
    }
    const codigo = await remRepo.siguienteCodigoLote(c)
    const porSerie = new Map((respuesta.lineas ?? []).map((l) => [l.numSerie, l]))
    let ok = 0, err = 0, warn = 0
    for (const q of claimed) {
      const l = porSerie.get(q.num_serie)
      const estado = mapEstado(l?.estado, respuesta.estadoEnvio)
      await remRepo.marcarResultado(c, q.id, {
        estado, estadoAeat: l?.estado ?? null, csv: l?.csv ?? respuesta.csv,
        codigoError: l?.codigoError ?? null, ultimoError: l?.descripcion ?? null, loteCodigo: codigo,
      })
      if (estado === 'ok') ok++; else if (estado === 'warn') warn++; else err++
    }
    await remRepo.insertLote(c, {
      ...scope, codigo, info: `${claimed.length} registros`,
      label: respuesta.estadoEnvio ?? 'Remitido', estadoEnvio: respuesta.estadoEnvio,
      csv: respuesta.csv, numRegistros: claimed.length, entorno,
    })
    return { remitidos: claimed.length, ok, warn, err, lote: codigo, estadoEnvio: respuesta.estadoEnvio }
  })
}

// Remite (encola+drena) un único registro por num_serie.
export async function remitirUno(scope, numSerie, { transport } = {}) {
  const existe = await tx(scope, (c) => remRepo.registroCanonicoPorNumSerie(c, numSerie))
  if (!existe) throw new ReglaNegocioError('REGISTRO_NO_ENCONTRADO', `registro '${numSerie}' no encontrado`)
  return drenar(scope, { transport })
}

export function estadoCola(scope) {
  return tx(scope, async (c) => ({
    resumen: await remRepo.resumenCola(c),
    cola: await remRepo.listCola(c, { limit: 100 }),
  }))
}

export function reintentarDlq(scope, id) {
  return tx(scope, async (c) => {
    const row = await remRepo.reintentarDlq(c, id)
    if (!row) throw new ReglaNegocioError('DLQ_NO_ENCONTRADO', `entrada de cola '${id}' no está en DLQ/err`)
    return row
  })
}

export function loteDetalle(scope, codigo) {
  return tx(scope, async (c) => {
    const lote = await remRepo.loteDetalle(c, codigo)
    if (!lote) throw new ReglaNegocioError('LOTE_NO_ENCONTRADO', `lote '${codigo}' no encontrado`)
    return lote
  })
}

// Construye el envelope de los pendientes (o de un registro) SIN enviar — para
// inspección/validación previa. No persiste ni cambia estados.
export function dryRun(scope, { numSerie } = {}) {
  return tx(scope, async (c) => {
    const cfg = await repo.getConfig(c)
    const obligado = { nif: cfg?.nif_obligado, nombre: cfg?.nombre_obligado }
    let registros
    if (numSerie) {
      const r = await remRepo.registroCanonicoPorNumSerie(c, numSerie)
      if (!r) throw new ReglaNegocioError('REGISTRO_NO_ENCONTRADO', `registro '${numSerie}' no encontrado`)
      registros = [r]
    } else {
      registros = await repo.listRegistrosParaRehash(c, { limit: cfg?.max_registros_lote ?? 1000 })
    }
    if (!registros.length) throw new ReglaNegocioError('SIN_REGISTROS', 'no hay registros para remitir')
    const envelopeXml = construirEnvelope({ obligado, registros: registros.map((r) => aRegistroEnvelope(r, obligado.nombre)) })
    return { entorno: 'test', numRegistros: registros.length, envelopeXml }
  })
}

// Firma XAdES on-demand de un registro (debug/inspección). Devuelve el XML firmado.
export function firmarRegistro(scope, numSerie) {
  return tx(scope, async (c) => {
    const r = await remRepo.registroCanonicoPorNumSerie(c, numSerie)
    if (!r) throw new ReglaNegocioError('REGISTRO_NO_ENCONTRADO', `registro '${numSerie}' no encontrado`)
    const material = await certRepo.getCertificadoActivoMaterial(c, { uso: 'firma' })
    if (!material?.pkcs12) throw new ReglaNegocioError('SIN_CERTIFICADO', 'no hay certificado activo para firmar')
    const cfg = await repo.getConfig(c)
    const xml = registroAltaXml(aRegistroEnvelope(r, cfg?.nombre_obligado))
    const { certPem, keyPem } = parsePkcs12(material.pkcs12, material.passphrase)
    const firmado = firmarXml(xml, { certPem, keyPem, elemento: 'RegistroAlta' })
    return { numSerie, firmado }
  })
}
