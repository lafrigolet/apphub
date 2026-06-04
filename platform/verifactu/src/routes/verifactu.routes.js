import { z } from 'zod'
import * as service from '../services/verifactu.service.js'
import { EVENTOS_CATALOGO } from '../lib/sif.js'

// Scope público: el portal aún no tiene login, así que (appId, tenantId)
// viajan en query (GET) o body (POST/PATCH), igual que el POST público de
// inquiries. RLS se setea con esos valores en withTenantTransaction.
const scopeQuery = z.object({
  appId:       z.string().min(1).max(64),
  tenantId:    z.string().uuid(),
  subTenantId: z.string().uuid().optional().nullable(),
})

const scope = (q) => {
  const s = scopeQuery.parse(q ?? {})
  return { appId: s.appId, tenantId: s.tenantId, subTenantId: s.subTenantId ?? null }
}

const T = ['verifactu']

export async function publicRoutes(fastify) {
  // ── Emisor ──────────────────────────────────────────────────────────
  fastify.get('/registros', { config: { public: true }, schema: { tags: T, summary: 'Lista de facturas/registros', querystring: scopeQuery } },
    async (req) => service.listFacturas(scope(req.query)))

  fastify.get('/remisiones', { config: { public: true }, schema: { tags: T, summary: 'Remisiones recientes (resumen)', querystring: scopeQuery } },
    async (req) => service.listRemisiones(scope(req.query)))

  fastify.get('/cadena', { config: { public: true }, schema: { tags: T, summary: 'Cadena de huellas (últimos registros)', querystring: scopeQuery } },
    async (req) => service.listCadena(scope(req.query)))

  fastify.get('/cadena/verificar', { config: { public: true }, schema: { tags: T, summary: 'Verifica el enlace de la cadena de huellas', querystring: scopeQuery } },
    async (req) => service.verificarCadena(scope(req.query)))

  // Re-hash auditable: recalcula la huella de cada registro desde sus campos
  // canónicos y la compara con la persistida (detecta manipulaciones e
  // interpolaciones, no solo roturas de enlace). Recomendación #9 / TODO A1.
  fastify.get('/cadena/recalcular', { config: { public: true }, schema: { tags: T, summary: 'Recálculo completo de la cadena (full re-hash auditable)', querystring: scopeQuery } },
    async (req) => service.recalcularCadenaCompleta(scope(req.query)))

  fastify.get('/eventos', { config: { public: true }, schema: { tags: T, summary: 'Eventos del SIF / auditoría', querystring: scopeQuery } },
    async (req) => service.listEventos(scope(req.query)))

  const eventoBody = scopeQuery.extend({
    tipoEvento:  z.enum([...EVENTOS_CATALOGO.map((e) => e.tipo)]),
    descripcion: z.string().max(256).optional(),
  })
  fastify.post('/eventos', { config: { public: true }, schema: { tags: T, summary: 'Registrar evento del SIF (huella encadenada)', body: eventoBody } },
    async (req, reply) => {
      const b = eventoBody.parse(req.body ?? {})
      reply.code(201)
      return service.crearEvento(scope(b), b)
    })

  const qrQuery = scopeQuery.extend({ numSerie: z.string().max(64).optional() })
  fastify.get('/qr', { config: { public: true }, schema: { tags: T, summary: 'QR + URL de cotejo de un registro', querystring: qrQuery } },
    async (req, reply) => {
      const q = qrQuery.parse(req.query ?? {})
      const out = await service.getQr(scope(q), q.numSerie)
      if (!out) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Sin registros' } })
      return out
    })

  const registroBody = scopeQuery.extend({
    numSerie:       z.string().max(64).optional(),
    clienteNombre:  z.string().max(256).optional(),
    clienteNif:     z.string().max(32).optional(),
    fechaExpedicion: z.string().max(32).optional(),
    importeTotal:   z.number().optional(),
    cuotaTotal:     z.number().optional(),
    totalDisplay:   z.string().max(32).optional(),
    tipoFactura:    z.string().max(8).optional(),
  })
  fastify.post('/registros', { config: { public: true }, schema: { tags: T, summary: 'Crear factura (huella encadenada · STUB)', body: registroBody } },
    async (req, reply) => {
      const b = registroBody.parse(req.body ?? {})
      reply.code(201)
      return service.crearRegistro(scope(b), b)
    })

  // ── Asesoría ────────────────────────────────────────────────────────
  fastify.get('/clientes', { config: { public: true }, schema: { tags: T, summary: 'Cartera de clientes', querystring: scopeQuery } },
    async (req) => service.listClientes(scope(req.query)))

  fastify.get('/lotes', { config: { public: true }, schema: { tags: T, summary: 'Lotes de remisión', querystring: scopeQuery } },
    async (req) => service.listLotes(scope(req.query)))

  fastify.get('/representacion', { config: { public: true }, schema: { tags: T, summary: 'Apoderamientos / representación', querystring: scopeQuery } },
    async (req) => service.listRepresentacion(scope(req.query)))

  const clienteBody = scopeQuery.extend({
    nombre:      z.string().min(1).max(256),
    nif:         z.string().min(1).max(32),
    facturasMes: z.number().int().min(0).optional(),
    estado:      z.enum(['ok', 'warn', 'err']).optional(),
  })
  fastify.post('/clientes', { config: { public: true }, schema: { tags: T, summary: 'Añadir cliente a la cartera', body: clienteBody } },
    async (req, reply) => {
      const b = clienteBody.parse(req.body ?? {})
      reply.code(201)
      return service.crearCliente(scope(b), b)
    })

  // ── Administrador ───────────────────────────────────────────────────
  fastify.get('/certificados', { config: { public: true }, schema: { tags: T, summary: 'Certificados', querystring: scopeQuery } },
    async (req) => service.listCertificados(scope(req.query)))

  fastify.get('/config', { config: { public: true }, schema: { tags: T, summary: 'Control de flujo (parámetros)', querystring: scopeQuery } },
    async (req) => service.getConfig(scope(req.query)))

  const configBody = scopeQuery.extend({
    tiempoEsperaEnvio: z.number().int().min(0).optional(),
    maxRegistrosLote:  z.number().int().min(1).optional(),
    reintentos:        z.number().int().min(0).optional(),
    dlqEnabled:        z.boolean().optional(),
  })
  fastify.patch('/config', { config: { public: true }, schema: { tags: T, summary: 'Actualizar control de flujo', body: configBody } },
    async (req) => {
      const b = configBody.parse(req.body ?? {})
      return service.patchConfig(scope(b), b)
    })

  // ── Receptor ────────────────────────────────────────────────────────
  fastify.get('/cotejos', { config: { public: true }, schema: { tags: T, summary: 'Historial de cotejos', querystring: scopeQuery } },
    async (req) => service.listCotejos(scope(req.query)))

  const cotejoBody = scopeQuery.extend({
    nifEmisor: z.string().max(32).optional(),
    numSerie:  z.string().max(64).optional(),
    url:       z.string().max(512).optional(),
  })
  fastify.post('/cotejo', { config: { public: true }, schema: { tags: T, summary: 'Cotejar factura (verificación · STUB)', body: cotejoBody } },
    async (req) => {
      const b = cotejoBody.parse(req.body ?? {})
      return service.cotejar(scope(b), b)
    })

  // ── Desarrollador ───────────────────────────────────────────────────
  fastify.post('/validar', { config: { public: true }, schema: { tags: T, summary: 'Validar registro (estructural + integridad de huella)' } },
    async (req) => service.validar(req.body ?? {}))

  // ── Series de facturación (§14) ─────────────────────────────────────
  fastify.get('/series', { config: { public: true }, schema: { tags: T, summary: 'Series de facturación del obligado', querystring: scopeQuery } },
    async (req) => service.listSeries(scope(req.query)))

  const serieBody = scopeQuery.extend({
    codigo:      z.string().min(1).max(64),
    descripcion: z.string().max(256).optional(),
    ejercicio:   z.number().int().optional(),
    siguiente:   z.number().int().min(1).optional(),
    activa:      z.boolean().optional(),
  })
  fastify.post('/series', { config: { public: true }, schema: { tags: T, summary: 'Crear serie de facturación', body: serieBody } },
    async (req, reply) => {
      const b = serieBody.parse(req.body ?? {})
      reply.code(201)
      return service.crearSerie(scope(b), b)
    })

  const cerrarSerieParams = z.object({ codigo: z.string().min(1).max(64) })
  fastify.post('/series/:codigo/cerrar', { config: { public: true }, schema: { tags: T, summary: 'Cerrar serie (bloquea nuevos registros)', params: cerrarSerieParams, body: scopeQuery } },
    async (req) => {
      const b = scopeQuery.parse(req.body ?? {})
      const { codigo } = cerrarSerieParams.parse(req.params ?? {})
      return service.cerrarSerie(scope(b), codigo)
    })

  // ── Exportación legal (§16) ─────────────────────────────────────────
  // Vuelca registros + eventos + identidad del SIF y registra el evento
  // EXPORTACION encadenado en la cadena de eventos.
  fastify.get('/exportar', { config: { public: true }, schema: { tags: T, summary: 'Exportación legal del SIF (registros + eventos) + evento EXPORTACION', querystring: scopeQuery } },
    async (req) => service.exportar(scope(req.query)))
}
