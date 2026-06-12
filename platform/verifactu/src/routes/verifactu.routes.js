import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as service from '../services/verifactu.service.js'
import * as certs from '../services/certificados.service.js'
import * as remision from '../services/remision.service.js'
import { EVENTOS_CATALOGO } from '../lib/sif.js'

// Autenticación (uso §18): los endpoints ya NO son públicos — appGuard
// (platform-core) exige JWT y decora req.identity. El scope (appId, tenantId)
// sale del TOKEN, no de query/body. staff/super_admin pueden operar sobre otro
// tenant pasándolo por query (?appId=&tenantId=) — impersonación de consola,
// igual que platform/payments. Las MUTACIONES van protegidas con
// requireRole('super_admin','staff'). La salud sigue pública (en index.js).

const STAFF = new Set(['staff', 'super_admin'])
const onlyStaff = requireRole('super_admin', 'staff')

function authedScope(req) {
  const id = req.identity
  if (!id) {
    const e = new Error('No autenticado'); e.statusCode = 401; e.code = 'UNAUTHORIZED'; throw e
  }
  const imp = STAFF.has(id.role)
  const q = req.query ?? {}
  return {
    appId: imp && q.appId ? q.appId : id.appId,
    tenantId: imp && q.tenantId ? q.tenantId : id.tenantId,
    subTenantId: id.subTenantId ?? null,
  }
}

const T = ['verifactu']
// Para staff: querystring de impersonación opcional (documental).
const impQuery = z.object({ appId: z.string().optional(), tenantId: z.string().uuid().optional() }).partial()

export async function publicRoutes(fastify) {
  // ── Emisor ──────────────────────────────────────────────────────────
  fastify.get('/registros', { schema: { tags: T, summary: 'Lista de facturas/registros', querystring: impQuery } },
    async (req) => service.listFacturas(authedScope(req)))

  fastify.get('/remisiones', { schema: { tags: T, summary: 'Remisiones recientes (resumen)', querystring: impQuery } },
    async (req) => service.listRemisiones(authedScope(req)))

  fastify.get('/cadena', { schema: { tags: T, summary: 'Cadena de huellas (últimos registros)', querystring: impQuery } },
    async (req) => service.listCadena(authedScope(req)))

  fastify.get('/cadena/verificar', { schema: { tags: T, summary: 'Verifica el enlace de la cadena de huellas', querystring: impQuery } },
    async (req) => service.verificarCadena(authedScope(req)))

  fastify.get('/cadena/recalcular', { schema: { tags: T, summary: 'Recálculo completo de la cadena (full re-hash auditable)', querystring: impQuery } },
    async (req) => service.recalcularCadenaCompleta(authedScope(req)))

  fastify.get('/eventos', { schema: { tags: T, summary: 'Eventos del SIF / auditoría', querystring: impQuery } },
    async (req) => service.listEventos(authedScope(req)))

  const eventoBody = z.object({
    tipoEvento:  z.enum([...EVENTOS_CATALOGO.map((e) => e.tipo)]),
    descripcion: z.string().max(256).optional(),
  })
  fastify.post('/eventos', { preHandler: onlyStaff, schema: { tags: T, summary: 'Registrar evento del SIF (huella encadenada)', body: eventoBody } },
    async (req, reply) => {
      const b = eventoBody.parse(req.body ?? {})
      reply.code(201)
      return service.crearEvento(authedScope(req), b)
    })

  fastify.get('/qr', { schema: { tags: T, summary: 'QR + URL de cotejo de un registro', querystring: impQuery.extend({ numSerie: z.string().max(64).optional() }) } },
    async (req, reply) => {
      const out = await service.getQr(authedScope(req), req.query?.numSerie)
      if (!out) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Sin registros' } })
      return out
    })

  const registroBody = z.object({
    numSerie:       z.string().max(64).optional(),
    clienteNombre:  z.string().max(256).optional(),
    clienteNif:     z.string().max(32).optional(),
    fechaExpedicion: z.string().max(32).optional(),
    importeTotal:   z.number().optional(),
    cuotaTotal:     z.number().optional(),
    totalDisplay:   z.string().max(32).optional(),
    tipoFactura:    z.string().max(8).optional(),
  })
  fastify.post('/registros', { preHandler: onlyStaff, schema: { tags: T, summary: 'Crear factura (huella encadenada)', body: registroBody } },
    async (req, reply) => {
      const b = registroBody.parse(req.body ?? {})
      reply.code(201)
      return service.crearRegistro(authedScope(req), b)
    })

  // ── Asesoría ────────────────────────────────────────────────────────
  fastify.get('/clientes', { schema: { tags: T, summary: 'Cartera de clientes', querystring: impQuery } },
    async (req) => service.listClientes(authedScope(req)))

  fastify.get('/lotes', { schema: { tags: T, summary: 'Lotes de remisión', querystring: impQuery } },
    async (req) => service.listLotes(authedScope(req)))

  fastify.get('/representacion', { schema: { tags: T, summary: 'Apoderamientos / representación', querystring: impQuery } },
    async (req) => service.listRepresentacion(authedScope(req)))

  const clienteBody = z.object({
    nombre:      z.string().min(1).max(256),
    nif:         z.string().min(1).max(32),
    facturasMes: z.number().int().min(0).optional(),
    estado:      z.enum(['ok', 'warn', 'err']).optional(),
  })
  fastify.post('/clientes', { preHandler: onlyStaff, schema: { tags: T, summary: 'Añadir cliente a la cartera', body: clienteBody } },
    async (req, reply) => {
      const b = clienteBody.parse(req.body ?? {})
      reply.code(201)
      return service.crearCliente(authedScope(req), b)
    })

  // ── Administrador · Certificados (§12) ──────────────────────────────
  fastify.get('/certificados', { schema: { tags: T, summary: 'Certificados', querystring: impQuery } },
    async (req) => certs.listCertificados(authedScope(req)))

  const certParams = z.object({ id: z.string().uuid() })

  fastify.get('/certificados/:id', { schema: { tags: T, summary: 'Detalle de certificado (metadatos)', params: certParams, querystring: impQuery } },
    async (req) => certs.getCertificado(authedScope(req), certParams.parse(req.params).id))

  const certBody = z.object({
    nombre:       z.string().max(256).optional(),
    pkcs12Base64: z.string().min(1),
    passphrase:   z.string().max(256).optional(),
    uso:          z.enum(['firma', 'sello']).optional(),
  })
  fastify.post('/certificados', { preHandler: onlyStaff, schema: { tags: T, summary: 'Subir certificado PKCS#12 (cifrado at-rest)', body: certBody } },
    async (req, reply) => {
      const b = certBody.parse(req.body ?? {})
      reply.code(201)
      return certs.subirCertificado(authedScope(req), b)
    })

  fastify.post('/certificados/:id/renovar', { preHandler: onlyStaff, schema: { tags: T, summary: 'Renovar certificado (sustituye el PKCS#12 sin cambiar el id)', params: certParams, body: certBody } },
    async (req) => {
      const b = certBody.parse(req.body ?? {})
      return certs.renovarCertificado(authedScope(req), certParams.parse(req.params).id, b)
    })

  fastify.delete('/certificados/:id', { preHandler: onlyStaff, schema: { tags: T, summary: 'Revocar/baja de certificado', params: certParams } },
    async (req) => certs.eliminarCertificado(authedScope(req), certParams.parse(req.params).id))

  fastify.get('/config', { schema: { tags: T, summary: 'Control de flujo (parámetros)', querystring: impQuery } },
    async (req) => service.getConfig(authedScope(req)))

  const configBody = z.object({
    nifObligado:       z.string().max(32).optional(),
    nombreObligado:    z.string().max(256).optional(),
    entorno:           z.enum(['test', 'prod']).optional(),
    tiempoEsperaEnvio: z.number().int().min(0).optional(),
    maxRegistrosLote:  z.number().int().min(1).optional(),
    reintentos:        z.number().int().min(0).optional(),
    dlqEnabled:        z.boolean().optional(),
  })
  fastify.patch('/config', { preHandler: onlyStaff, schema: { tags: T, summary: 'Actualizar control de flujo', body: configBody } },
    async (req) => service.patchConfig(authedScope(req), configBody.parse(req.body ?? {})))

  // ── Remisión a la AEAT (§5/§17) ─────────────────────────────────────
  fastify.post('/remitir', { preHandler: onlyStaff, schema: { tags: T, summary: 'Remitir registros pendientes a la AEAT (cola + envío)' } },
    async (req) => remision.drenar(authedScope(req)))

  fastify.get('/cola', { schema: { tags: T, summary: 'Estado de la cola de remisión (resumen + filas)', querystring: impQuery } },
    async (req) => remision.estadoCola(authedScope(req)))

  const numSerieParams = z.object({ numSerie: z.string().min(1).max(64) })

  fastify.post('/registros/:numSerie/remitir', { preHandler: onlyStaff, schema: { tags: T, summary: 'Remitir un registro concreto', params: numSerieParams } },
    async (req) => remision.remitirUno(authedScope(req), numSerieParams.parse(req.params).numSerie))

  fastify.post('/registros/:numSerie/firmar', { preHandler: onlyStaff, schema: { tags: T, summary: 'Firmar XAdES un registro (devuelve el XML firmado)', params: numSerieParams } },
    async (req) => remision.firmarRegistro(authedScope(req), numSerieParams.parse(req.params).numSerie))

  fastify.post('/remision/dry-run', { preHandler: onlyStaff, schema: { tags: T, summary: 'Construye el envelope SOAP sin enviar (inspección)', body: z.object({ numSerie: z.string().max(64).optional() }) } },
    async (req) => {
      const b = z.object({ numSerie: z.string().max(64).optional() }).parse(req.body ?? {})
      return remision.dryRun(authedScope(req), { numSerie: b.numSerie })
    })

  const dlqParams = z.object({ id: z.string().uuid() })
  fastify.post('/dlq/:id/reintentar', { preHandler: onlyStaff, schema: { tags: T, summary: 'Reintentar una entrada de la DLQ', params: dlqParams } },
    async (req) => remision.reintentarDlq(authedScope(req), dlqParams.parse(req.params).id))

  const loteParams = z.object({ codigo: z.string().min(1).max(64) })
  fastify.get('/lotes/:codigo', { schema: { tags: T, summary: 'Detalle de un lote (respuesta AEAT + líneas)', params: loteParams, querystring: impQuery } },
    async (req) => remision.loteDetalle(authedScope(req), loteParams.parse(req.params).codigo))

  // ── Receptor ────────────────────────────────────────────────────────
  fastify.get('/cotejos', { schema: { tags: T, summary: 'Historial de cotejos', querystring: impQuery } },
    async (req) => service.listCotejos(authedScope(req)))

  const cotejoBody = z.object({
    nifEmisor: z.string().max(32).optional(),
    numSerie:  z.string().max(64).optional(),
    url:       z.string().max(512).optional(),
  })
  fastify.post('/cotejo', { schema: { tags: T, summary: 'Cotejar factura (verificación)', body: cotejoBody } },
    async (req) => service.cotejar(authedScope(req), cotejoBody.parse(req.body ?? {})))

  // ── Desarrollador ───────────────────────────────────────────────────
  fastify.post('/validar', { schema: { tags: T, summary: 'Validar registro (estructural + integridad de huella)' } },
    async (req) => service.validar(req.body ?? {}))

  // ── Series de facturación (§14) ─────────────────────────────────────
  fastify.get('/series', { schema: { tags: T, summary: 'Series de facturación del obligado', querystring: impQuery } },
    async (req) => service.listSeries(authedScope(req)))

  const serieBody = z.object({
    codigo:      z.string().min(1).max(64),
    descripcion: z.string().max(256).optional(),
    ejercicio:   z.number().int().optional(),
    siguiente:   z.number().int().min(1).optional(),
    activa:      z.boolean().optional(),
  })
  fastify.post('/series', { preHandler: onlyStaff, schema: { tags: T, summary: 'Crear serie de facturación', body: serieBody } },
    async (req, reply) => {
      const b = serieBody.parse(req.body ?? {})
      reply.code(201)
      return service.crearSerie(authedScope(req), b)
    })

  const cerrarSerieParams = z.object({ codigo: z.string().min(1).max(64) })
  fastify.post('/series/:codigo/cerrar', { preHandler: onlyStaff, schema: { tags: T, summary: 'Cerrar serie (bloquea nuevos registros)', params: cerrarSerieParams } },
    async (req) => service.cerrarSerie(authedScope(req), cerrarSerieParams.parse(req.params).codigo))

  // ── Exportación legal (§16) — registra evento EXPORTACION (mutación) ──
  fastify.get('/exportar', { preHandler: onlyStaff, schema: { tags: T, summary: 'Exportación legal del SIF (registros + eventos) + evento EXPORTACION', querystring: impQuery } },
    async (req) => service.exportar(authedScope(req)))
}
