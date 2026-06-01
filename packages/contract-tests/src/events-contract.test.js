// Events contract (sección 5 · P1) — los payloads publicados en
// `platform.events` deben cumplir un schema VERSIONADO compartido por
// producer y consumer. Aquí definimos ese registro (zod) y validamos los
// shapes canónicos que emiten los producers (lead.created, inquiry.created,
// message.created). Si un producer cambia el shape sin actualizar el schema,
// su propio test de módulo cae; este test fija el contrato versionado.
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// ── Registro de eventos v1 ─────────────────────────────────────────────
const EnvelopeSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.unknown()),
})

const EVENT_SCHEMAS = {
  'lead.created': z.object({
    leadId: z.string().min(1),
    email: z.string().email(),
    contactName: z.string().min(1),
    businessName: z.string().nullable(),
    industry: z.string().nullable(),
    source: z.string().nullable(),
  }),
  'inquiry.created': z.object({
    appId: z.string().min(1),
    tenantId: z.string().min(1),
    subTenantId: z.string().nullable(),
    inquiryId: z.string().min(1),
    reference: z.string().min(1),
    contactName: z.string().min(1),
    email: z.string().email(),
    contactInboxEmail: z.string().email(),
  }).passthrough(),
  'message.created': z.object({
    messageId: z.string().min(1),
    threadId: z.string().min(1),
    appId: z.string().min(1),
    tenantId: z.string().min(1),
    senderUserId: z.string().min(1),
    recipientUserId: z.string().nullable(),
  }).passthrough(),
}

// Muestras canónicas — espejo de lo que emite cada producer.
const SAMPLES = {
  'lead.created': {
    leadId: 'lead-1', email: 'ana@x.com', contactName: 'Ana',
    businessName: 'Tienda Ana', industry: 'shop', source: 'landing/contacto',
  },
  'inquiry.created': {
    appId: 'aikikan', tenantId: 't1', subTenantId: null,
    inquiryId: 'iq1', reference: 'AB12CD', contactName: 'Ana',
    email: 'ana@x.com', contactInboxEmail: 'box@x.com',
  },
  'message.created': {
    messageId: 'm1', threadId: 'th1', appId: 'mk', tenantId: 't1',
    senderUserId: 'buyer-1', recipientUserId: 'vendor-1', orderId: 'o1',
  },
}

describe('platform.events — registro versionado', () => {
  it('todo evento conocido tiene schema y muestra', () => {
    for (const type of Object.keys(EVENT_SCHEMAS)) {
      expect(SAMPLES[type], `falta muestra para ${type}`).toBeDefined()
    }
  })

  it.each(Object.keys(EVENT_SCHEMAS))('%s — el envelope { type, payload } es válido', (type) => {
    const envelope = { type, payload: SAMPLES[type] }
    expect(EnvelopeSchema.safeParse(envelope).success).toBe(true)
  })

  it.each(Object.keys(EVENT_SCHEMAS))('%s — la muestra del producer cumple el schema', (type) => {
    const res = EVENT_SCHEMAS[type].safeParse(SAMPLES[type])
    expect(res.success, JSON.stringify(res.error?.issues)).toBe(true)
  })

  it('lead.created sin email válido → rechazado (guardrail del contrato)', () => {
    const bad = { ...SAMPLES['lead.created'], email: 'no-es-email' }
    expect(EVENT_SCHEMAS['lead.created'].safeParse(bad).success).toBe(false)
  })

  it('message.created sin messageId → rechazado', () => {
    const { messageId, ...bad } = SAMPLES['message.created']
    expect(EVENT_SCHEMAS['message.created'].safeParse(bad).success).toBe(false)
  })
})
