import { NotFoundError, ConflictError, ValidationError } from '@apphub/platform-sdk/errors'
import { withTenantTransaction } from '../lib/db.js'
import { publishEvent } from '../lib/redis.js'
import * as creditNotesRepo from '../repositories/credit-notes.repository.js'
import * as receiptsRepo from '../repositories/receipts.repository.js'
import * as seriesRepo from '../repositories/number-series.repository.js'
import * as settingsRepo from '../repositories/settings.repository.js'
import * as sessionsRepo from '../repositories/cash-sessions.repository.js'
import * as movementsRepo from '../repositories/cash-movements.repository.js'

const MANAGER_ROLES = ['manager', 'owner', 'admin', 'staff', 'super_admin']

function buildVoidedPayload(note, original) {
  return {
    appId: note.app_id,
    tenantId: note.tenant_id,
    subTenantId: note.sub_tenant_id ?? null,
    creditNoteId: note.id,
    numSerie: note.num_serie,
    originalReceiptId: original.id,
    originalNumSerie: original.num_serie,
    amountCents: Number(note.amount_cents),
    reason: note.reason,
    refundMethod: note.refund_method,
    lines: note.lines ?? [],
    issuedAt: note.issued_at,
    issuer: original.issuer ?? null,       // emisor snapshot del recibo original (NIF para verifactu)
    receptor: original.receptor_nif
      ? { nif: original.receptor_nif, name: original.receptor_name }
      : null,
  }
}

// El cajero solicita el abono; un manager lo autoriza. Si quien lo crea ya
// es manager+, se autoriza en el mismo paso. El correlativo (serie R) se
// consume SOLO al autorizar — un abono rechazado no quema número.
export async function createCreditNote(identity, body) {
  const { note, original, autoAuthorized, payload } = await withTenantTransaction(
    identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
      const original = await receiptsRepo.findById(c, body.originalReceiptId)
      if (!original) throw new NotFoundError('Original receipt not found')
      if (original.status === 'voided') throw new ConflictError('Receipt is already fully voided')

      const alreadyRefunded = await creditNotesRepo.sumAuthorizedByReceipt(c, original.id)
      if (alreadyRefunded + body.amountCents > Number(original.total_cents)) {
        throw new ValidationError('Credit note exceeds the refundable amount of the original receipt')
      }
      if (body.refundMethod === 'cash' && !body.sessionId) {
        throw new ValidationError('Cash refunds require sessionId of an open cash session')
      }

      const note = await creditNotesRepo.insert(c, {
        appId: identity.appId,
        tenantId: identity.tenantId,
        subTenantId: identity.subTenantId ?? null,
        originalReceiptId: original.id,
        reason: body.reason,
        amountCents: body.amountCents,
        lines: body.lines,
        refundMethod: body.refundMethod,
        requestedBy: identity.userId,
      })

      if (MANAGER_ROLES.includes(identity.role)) {
        const r = await authorizeCore(c, identity, note, original, {
          sessionId: body.sessionId,
          refundExternalRef: body.refundExternalRef,
        })
        return { note: r.note, original, autoAuthorized: true, payload: r.payload }
      }
      return { note, original, autoAuthorized: false, payload: null }
    })

  if (autoAuthorized && payload) await publishEvent('tpv.receipt.voided', payload)
  return { ...note, autoAuthorized }
}

async function authorizeCore(client, identity, note, original, { sessionId, refundExternalRef }) {
  const settings = await settingsRepo.getOrDefaultsExplicit(client, identity.appId, identity.tenantId)
  const code = settings.default_credit_note_series_code
  const series = await seriesRepo.findByCodeExplicit(client, identity.appId, identity.tenantId, code)
  if (!series) throw new ConflictError(`Numbering series '${code}' not found — create it in /v1/tpv/series first`)
  if (series.kind !== 'credit_note') throw new ConflictError(`Series '${code}' is for ${series.kind}, not credit_note`)

  const seq = await seriesRepo.consumeNextNumber(client, series.id)
  if (!seq) throw new ConflictError(`Series '${code}' is not active`)
  const number = Number(seq.number)
  const numSerie = `${seq.prefix ?? ''}${seq.code}-${String(number).padStart(6, '0')}`

  const authorized = await creditNotesRepo.authorize(client, note.id, {
    authorizedBy: identity.userId,
    seriesId: series.id,
    number,
    numSerie,
    refundExternalRef,
  })
  if (!authorized) throw new ConflictError('Credit note is not pending')

  // Devolución en efectivo: cash-out automático en la sesión abierta indicada.
  if (authorized.refund_method === 'cash') {
    if (!sessionId) throw new ValidationError('Cash refunds require sessionId of an open cash session')
    const session = await sessionsRepo.findById(client, sessionId)
    if (!session || session.status !== 'open') throw new ConflictError('Cash session not found or not open')
    await movementsRepo.insert(client, {
      appId: identity.appId,
      tenantId: identity.tenantId,
      subTenantId: identity.subTenantId ?? null,
      sessionId,
      kind: 'refund_cash',
      amountCents: -Math.abs(Number(authorized.amount_cents)),
      reason: `Abono ${numSerie} de ${original.num_serie}`,
      actorId: identity.userId,
      source: 'manual',
      receiptId: original.id,
    })
  }

  // Abono total → el recibo original queda voided; parcial → sigue issued.
  const totalRefunded = await creditNotesRepo.sumAuthorizedByReceipt(client, original.id)
  if (totalRefunded >= Number(original.total_cents)) {
    await receiptsRepo.setStatus(client, original.id, 'voided')
  }

  return { note: authorized, payload: buildVoidedPayload(authorized, original) }
}

export async function authorizeCreditNote(identity, id, body) {
  const { note, payload } = await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    const note = await creditNotesRepo.findById(c, id)
    if (!note) throw new NotFoundError('Credit note not found')
    if (note.status !== 'pending') throw new ConflictError(`Credit note is ${note.status}`)
    const original = await receiptsRepo.findById(c, note.original_receipt_id)
    return authorizeCore(c, identity, note, original, {
      sessionId: body.sessionId,
      refundExternalRef: body.refundExternalRef,
    })
  })
  await publishEvent('tpv.receipt.voided', payload)
  return note
}

export async function rejectCreditNote(identity, id) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    const note = await creditNotesRepo.reject(c, id, { authorizedBy: identity.userId })
    if (!note) throw new ConflictError('Credit note not found or not pending')
    return note
  })
}

export async function listCreditNotes(identity, filters) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, (c) =>
    creditNotesRepo.list(c, filters))
}

export async function getCreditNote(identity, id) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    const note = await creditNotesRepo.findById(c, id)
    if (!note) throw new NotFoundError('Credit note not found')
    return note
  })
}
