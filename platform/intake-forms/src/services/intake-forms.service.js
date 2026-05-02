import { pool, withTenantTransaction } from '../lib/db.js'
import { publish, subscribe } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/intake-forms.repository.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'

export async function createTemplate(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertTemplate(c, ctx.appId, ctx.tenantId, body),
  )
}

export async function getTemplate(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const t = await repo.findTemplateById(c, ctx.appId, ctx.tenantId, id)
    if (!t) throw new NotFoundError('template')
    return t
  })
}

export async function listTemplates(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listTemplates(c, ctx.appId, ctx.tenantId, opts),
  )
}

export async function publishTemplate(ctx, id) {
  const t = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.publishTemplate(c, ctx.appId, ctx.tenantId, id),
  )
  if (!t) throw new NotFoundError('template')
  return t
}

export async function createSubmission(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const t = await repo.findTemplateById(c, ctx.appId, ctx.tenantId, body.templateId)
    if (!t) throw new NotFoundError('template')
    if (!t.is_published) throw new ConflictError('template is not published')
    return repo.insertSubmission(c, ctx.appId, ctx.tenantId, {
      ...body, clientUserId: body.clientUserId ?? ctx.userId,
    })
  })
}

export async function getSubmission(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const s = await repo.findSubmissionById(c, ctx.appId, ctx.tenantId, id)
    if (!s) throw new NotFoundError('submission')
    return s
  })
}

export async function submitAnswers(ctx, id, body) {
  const s = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.submitAnswers(c, ctx.appId, ctx.tenantId, id, body),
  )
  if (!s) throw new NotFoundError('submission')
  await publish({
    type: 'intake.submitted',
    payload: {
      appId: ctx.appId, tenantId: ctx.tenantId, submissionId: id,
      bookingId: s.booking_id, templateId: s.template_id, clientUserId: s.client_user_id,
    },
  })
  return s
}

export async function reviewSubmission(ctx, id) {
  const s = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.reviewSubmission(c, ctx.appId, ctx.tenantId, id, ctx.userId),
  )
  if (!s) throw new NotFoundError('submission')
  return s
}

// Event consumer: when a booking is confirmed for a service that requires intake,
// auto-create a pending submission and publish `intake.requested` so notifications
// can email the form link to the client.
export async function handleEvent(event) {
  try {
    if (event.type !== 'booking.confirmed' && event.type !== 'booking.requested') return
    const p = event.payload ?? {}
    if (!p.appId || !p.tenantId || !p.bookingId || !p.serviceId) return

    const ctx = { appId: p.appId, tenantId: p.tenantId, subTenantId: null, userId: p.clientUserId, role: 'system' }

    await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
      // Look up the service's intake_form_id (cross-schema read).
      const { rows } = await c.query(
        `SELECT requires_intake_form, intake_form_id FROM platform_services.services
         WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
        [ctx.appId, ctx.tenantId, p.serviceId],
      )
      const svc = rows[0]
      if (!svc?.requires_intake_form || !svc.intake_form_id) return

      // De-dupe: skip if a submission already exists for this booking.
      const existing = await repo.findSubmissionByBookingId(c, ctx.appId, ctx.tenantId, p.bookingId)
      if (existing) return

      const submission = await repo.insertSubmission(c, ctx.appId, ctx.tenantId, {
        templateId: svc.intake_form_id,
        bookingId: p.bookingId,
        clientUserId: p.clientUserId,
        status: 'pending',
      })
      await publish({
        type: 'intake.requested',
        payload: {
          appId: ctx.appId, tenantId: ctx.tenantId,
          submissionId: submission.id, bookingId: p.bookingId,
          templateId: svc.intake_form_id, clientUserId: p.clientUserId,
        },
      })
    })
  } catch (err) {
    logger.warn({ err, type: event.type }, 'intake-forms event handler error')
  }
}

export { subscribe }

// ── PDF export of a filled submission ──────────────────────────────────
import { createTextPdf } from '@apphub/platform-sdk/simple-pdf'

export async function exportSubmissionPdf(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const submission = await repo.findSubmissionById(c, ctx.appId, ctx.tenantId, id)
    if (!submission) throw new NotFoundError('submission')
    const template = await repo.findTemplateById(c, ctx.appId, ctx.tenantId, submission.template_id)

    const lines = []
    lines.push(`Plantilla: ${template?.name ?? submission.template_id}`)
    lines.push(`Versión: ${template?.version ?? '—'}`)
    if (submission.booking_id) lines.push(`Reserva: ${submission.booking_id}`)
    lines.push(`Estado: ${submission.status ?? '—'}`)
    lines.push(`Enviado: ${submission.submitted_at ? new Date(submission.submitted_at).toLocaleString('es-ES') : '—'}`)
    lines.push('')

    const fields    = Array.isArray(template?.fields) ? template.fields : []
    const answers   = submission.answers ?? {}
    if (fields.length) {
      for (const f of fields) {
        const value = answers[f.key]
        lines.push(`${f.label ?? f.key}:`)
        if (value == null || value === '') lines.push('  —')
        else if (Array.isArray(value))     lines.push(`  ${value.join(', ')}`)
        else if (typeof value === 'object') lines.push(`  ${JSON.stringify(value)}`)
        else                                lines.push(`  ${value}`)
        lines.push('')
      }
    } else {
      // No template fields known — dump answers as KV.
      for (const [k, v] of Object.entries(answers)) {
        lines.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      }
    }
    if (submission.signature_object_id) {
      lines.push('')
      lines.push(`Firma digital adjunta — object_id: ${submission.signature_object_id}`)
    }

    return {
      filename: `intake-${id}.pdf`,
      pdf: createTextPdf({
        title: `Cuestionario · ${template?.name ?? submission.template_id}`,
        lines,
      }),
    }
  })
}
