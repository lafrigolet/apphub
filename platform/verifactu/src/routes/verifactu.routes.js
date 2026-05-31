import { z } from 'zod'
import * as service from '../services/verifactu.service.js'

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

  fastify.get('/eventos', { config: { public: true }, schema: { tags: T, summary: 'Eventos del SIF / auditoría', querystring: scopeQuery } },
    async (req) => service.listEventos(scope(req.query)))

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
  fastify.post('/validar', { config: { public: true }, schema: { tags: T, summary: 'Validar XML contra XSD (STUB)' } },
    async () => service.validar())
}
