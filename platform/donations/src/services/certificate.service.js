import { randomUUID } from 'node:crypto'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { withTenantTransaction } from '../lib/db.js'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import { publish } from '@apphub/platform-sdk/redis'
import * as donationsRepo from '../repositories/donations.repository.js'
import * as certsRepo     from '../repositories/fiscal-certificates.repository.js'
import { computeIrpfDeduction, consecutiveYearsForLoyalty } from '../lib/deduction.js'
import { Certificate } from '../templates/Certificate.js'
import { AppError, ForbiddenError, NotFoundError } from '@apphub/platform-sdk/errors'

const ADMIN_ROLES = new Set(['owner', 'admin', 'staff', 'super_admin'])

function requireAdmin(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) throw new ForbiddenError('Only admin/staff')
}

// Resuelve la identidad del emisor (entidad declarante) consultando
// platform_tenants.tenants. Necesita los campos `legal_name`, `cif` y
// `address` que ya existen en esa tabla.
async function resolveEntity(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT legal_name, display_name, cif, address
       FROM platform_tenants.tenants
      WHERE id = $1 AND app_id = $2 LIMIT 1`,
    [tenantId, appId],
  )
  const t = rows[0]
  return {
    name:    t?.legal_name || t?.display_name || 'Entidad sin nombre',
    nif:     t?.cif || '',
    address: t?.address || null,
  }
}

export async function generateAnnualCertificates(identity, { year, donorNif }, { redis } = {}) {
  requireAdmin(identity)
  if (!Number.isInteger(year)) throw new AppError('VALIDATION_ERROR', 'year debe ser entero', 422)

  const results = []

  await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, async (c) => {
    const entity = await resolveEntity(c, identity.appId, identity.tenantId)

    // Recolectamos donaciones del año filtrando por donorNif si se pidió uno.
    const { rows: donations } = await c.query(
      `SELECT d.id, d.donor_nif, d.donor_email, d.donor_name,
              d.donor_address, d.donor_postal_code, d.donor_country,
              d.amount_cents, d.paid_at, d.cause_id, c.name AS cause_name
         FROM platform_donations.donations d
         LEFT JOIN platform_donations.causes c ON c.id = d.cause_id
        WHERE d.donor_nif IS NOT NULL
          AND d.status = 'paid'
          AND EXTRACT(YEAR FROM d.paid_at) = $1
          AND ($2::text IS NULL OR d.donor_nif = $2)
        ORDER BY d.donor_nif, d.paid_at`,
      [year, donorNif ?? null],
    )

    // Agrupa por donor_nif.
    const byNif = new Map()
    for (const d of donations) {
      if (!byNif.has(d.donor_nif)) {
        byNif.set(d.donor_nif, {
          donor: {
            nif:        d.donor_nif,
            email:      d.donor_email,
            name:       d.donor_name,
            address:    d.donor_address,
            postalCode: d.donor_postal_code,
            country:    d.donor_country,
          },
          donations: [],
          totalCents: 0,
          ids:       [],
        })
      }
      const g = byNif.get(d.donor_nif)
      g.donations.push({ amountCents: d.amount_cents, paidAt: d.paid_at, causeName: d.cause_name })
      g.totalCents += Number(d.amount_cents)
      g.ids.push(d.id)
    }

    // Render PDF + persistencia + emit event por cada donante.
    for (const [nif, g] of byNif) {
      const certificateId = randomUUID()
      const generatedAt   = new Date()

      // Deducción IRPF estimada por tramos (Ley 49/2002) con
      // fidelización: 40 % sobre el exceso si el donante mantiene el
      // donativo ≥ 3 años consecutivos al mismo tenant.
      const donationYears = await donationsRepo.listDonationYearsForNif(c, nif)
      const { loyal } = consecutiveYearsForLoyalty(donationYears, year)
      const deduction = computeIrpfDeduction(g.totalCents, loyal)

      const pdfBuffer = await renderToBuffer(
        React.createElement(Certificate, {
          entity, donor: g.donor, fiscalYear: year,
          donations: g.donations, totalCents: g.totalCents,
          generatedAt, certificateId, deduction,
        }),
      )

      // Sube el PDF a platform/storage. Reutilizamos el endpoint de
      // uploads del propio module via loopback HTTP.
      const objectId = await uploadPdf({
        appId: identity.appId, tenantId: identity.tenantId,
        filename: `certificado-${year}-${nif}.pdf`,
        buffer:   pdfBuffer,
      })

      // Persiste el row (upsert via UNIQUE).
      const { rows } = await c.query(
        `INSERT INTO platform_donations.fiscal_certificates
           (app_id, tenant_id, fiscal_year, donor_nif, donor_email, donor_name,
            total_cents, donation_ids, pdf_object_id, generated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid[], $9, $10)
         ON CONFLICT (app_id, tenant_id, fiscal_year, donor_nif) DO UPDATE SET
           donor_email   = EXCLUDED.donor_email,
           donor_name    = EXCLUDED.donor_name,
           total_cents   = EXCLUDED.total_cents,
           donation_ids  = EXCLUDED.donation_ids,
           pdf_object_id = EXCLUDED.pdf_object_id,
           generated_at  = EXCLUDED.generated_at
         RETURNING id`,
        [
          identity.appId, identity.tenantId, year, nif, g.donor.email, g.donor.name,
          g.totalCents, g.ids, objectId, generatedAt,
        ],
      )
      results.push({ donorNif: nif, certificateId: rows[0].id, totalCents: g.totalCents })

      if (redis) {
        await publish(redis, identity.appId, {
          type: 'donation.certificate.ready',
          payload: {
            certificateId: rows[0].id,
            appId:         identity.appId,
            tenantId:      identity.tenantId,
            donorEmail:    g.donor.email,
            donorName:     g.donor.name,
            donorNif:      nif,
            fiscalYear:    year,
            totalCents:    g.totalCents,
          },
        })
      }
    }
  })

  logger.info({ year, count: results.length }, 'annual certificates generated')
  return results
}

// Sube un PDF al módulo storage via HTTP loopback. Devuelve objectId.
async function uploadPdf({ appId, tenantId, filename, buffer }) {
  const url = `${env.PLATFORM_CORE_BASE_URL}/v1/storage/uploads`
  // Endpoint storage acepta multipart/form-data; usamos FormData de
  // node-fetch nativo (Node 18+).
  const form = new FormData()
  form.append('file', new Blob([buffer], { type: 'application/pdf' }), filename)
  form.append('appId', appId)
  form.append('tenantId', tenantId)
  form.append('kind', 'document')
  const res = await fetch(url, { method: 'POST', body: form })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new AppError('STORAGE_UPLOAD_FAILED', `storage upload ${res.status}: ${txt}`, 502)
  }
  const json = await res.json()
  return json.data?.id ?? json.id
}

export async function listCertificates(identity, { year } = {}) {
  requireAdmin(identity)
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, async (c) => {
    const params = []
    let where = ''
    if (year) {
      params.push(year)
      where = `WHERE fiscal_year = $${params.length}`
    }
    const { rows } = await c.query(
      `SELECT id, fiscal_year, donor_nif, donor_email, donor_name,
              total_cents, pdf_object_id, generated_at, sent_at
         FROM platform_donations.fiscal_certificates
         ${where}
         ORDER BY fiscal_year DESC, donor_nif`,
      params,
    )
    return rows
  })
}

// Reenvío individual de un certificado al email del donante (rec. #2).
// El envío real del email lo hace un suscriptor de notifications (cross-
// cutting, pendiente); aquí (a) marcamos sent_at y (b) re-publicamos el
// evento `donation.certificate.ready` para que el suscriptor lo procese.
// Idempotente respecto al estado del certificado: refresca sent_at.
export async function resendCertificate(identity, certificateId, { redis } = {}) {
  requireAdmin(identity)
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, async (c) => {
    const existing = await certsRepo.findById(c, certificateId)
    if (!existing) throw new NotFoundError('Certificate')

    const cert = await certsRepo.markSent(c, certificateId)

    if (redis) {
      await publish(redis, identity.appId, {
        type: 'donation.certificate.ready',
        payload: {
          certificateId: cert.id,
          appId:         identity.appId,
          tenantId:      identity.tenantId,
          donorEmail:    cert.donor_email,
          donorName:     cert.donor_name,
          donorNif:      cert.donor_nif,
          fiscalYear:    cert.fiscal_year,
          totalCents:    Number(cert.total_cents),
          pdfObjectId:   cert.pdf_object_id,
          resend:        true,
        },
      })
    }
    logger.info({ certificateId: cert.id }, 'certificate resend requested')
    return cert
  })
}
