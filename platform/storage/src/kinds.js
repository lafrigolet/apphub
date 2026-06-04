// Catalogue of allowed object 'kinds'. Each entry caps MIME types, max size,
// and retention. Adding a new kind is the only place you should need to
// touch when wiring a new consumer module.

const MB = 1024 * 1024
const GB = 1024 * MB

export const KINDS = {
  menu_photo: {
    mime: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 10 * MB,
    retentionDays: null,
  },
  signature: {
    mime: ['image/png', 'image/svg+xml', 'application/pdf'],
    maxBytes: 1 * MB,
    retentionDays: 365 * 7,                            // GDPR / clinical retention
  },
  intake_attachment: {
    mime: ['image/jpeg', 'image/png', 'application/pdf'],
    maxBytes: 20 * MB,
    retentionDays: 365 * 5,
  },
  dispute_evidence: {
    mime: ['image/jpeg', 'image/png', 'application/pdf', 'video/mp4'],
    maxBytes: 50 * MB,
    retentionDays: 365 * 2,
  },
  message_attachment: {
    mime: ['image/jpeg', 'image/png', 'application/pdf'],
    maxBytes: 25 * MB,
    retentionDays: 365,
  },
  review_media: {
    mime: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'],
    maxBytes: 30 * MB,
    retentionDays: null,
  },
  catalog_image: {
    mime: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 10 * MB,
    retentionDays: null,
  },
  service_image: {
    mime: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 10 * MB,
    retentionDays: null,
  },
  resource_attachment: {
    mime: ['image/jpeg', 'image/png', 'application/pdf'],
    maxBytes: 5 * MB,
    retentionDays: null,
  },
  telehealth_recording: {
    mime: ['video/mp4', 'video/webm', 'audio/webm'],
    maxBytes: 2 * GB,
    retentionDays: 365,
  },
  payout_report: {
    mime: ['application/pdf'],
    maxBytes: 5 * MB,
    retentionDays: 365 * 7,
  },
  invoice: {
    mime: ['application/pdf'],
    maxBytes: 5 * MB,
    retentionDays: 365 * 7,
  },
  qr_code: {
    mime: ['image/png', 'image/svg+xml'],
    maxBytes: 1 * MB,
    retentionDays: null,
  },
  // Certificados emitidos por aikikan-server: diplomas de grado (KYU/DAN)
  // o de asistencia a un evento. Los emite admin tras un examen / curso.
  // Retención larga (10 años) — los grados son acreditaciones permanentes.
  aikikan_certificate: {
    mime: ['application/pdf'],
    maxBytes: 10 * MB,
    retentionDays: 365 * 10,
  },
  // Descargables públicos de las landings (p.ej. materiales de la sección
  // Grafocaligrafía de aulavera). `public: true` habilita el endpoint
  // anónimo GET /v1/storage/public/:id (302 → presigned GET); el resto de
  // kinds siguen siendo solo-autenticados. La subida sigue requiriendo
  // identidad (o el seed script con UUIDs fijos).
  public_download: {
    mime: ['application/pdf', 'application/zip'],
    maxBytes: 100 * MB,
    retentionDays: null,
    public: true,
  },
}

export function getKind(name) {
  return KINDS[name] ?? null
}

export function listKinds() {
  return Object.keys(KINDS)
}
