import { logger } from '../lib/logger.js'
import { withStaffBypass } from '../lib/db.js'
import * as receiptsRepo from '../repositories/receipts.repository.js'
import * as creditNotesRepo from '../repositories/credit-notes.repository.js'

const PATTERN = '*.events'

// Cierra el ciclo fiscal async: verifactu confirma el registro encadenado y
// devuelve el QR de cotejo, que se completa sobre el recibo/abono. Es el
// ÚNICO UPDATE permitido sobre los snapshots (grants column-level, 0001).
export function startVerifactuEventsHandler({ redis }) {
  const sub = redis.duplicate()
  sub.psubscribe(PATTERN, (err) => {
    if (err) {
      logger.error({ err, pattern: PATTERN }, 'Failed to psubscribe')
      return
    }
    logger.info({ pattern: PATTERN }, 'tpv subscribed to verifactu events')
  })

  sub.on('pmessage', async (_pattern, channel, message) => {
    let event
    try { event = JSON.parse(message) } catch { return }
    if (!event?.type?.startsWith('verifactu.registro.')) return

    try {
      const p = event.payload ?? {}
      if (!p.appId || !p.tenantId) return
      const status = event.type === 'verifactu.registro.created' ? 'registered' : 'failed'

      await withStaffBypass(async (c) => {
        if (p.receiptId) {
          const r = await receiptsRepo.findById(c, p.receiptId)
          if (r && r.app_id === p.appId && r.tenant_id === p.tenantId) {
            await receiptsRepo.setVerifactu(c, p.receiptId, {
              status,
              numSerie: p.numSerie ?? null,
              qrPayload: p.qrPayload ?? null,
              qrDataUri: p.qrDataUri ?? null,
            })
          }
        }
        if (p.creditNoteId) {
          const n = await creditNotesRepo.findById(c, p.creditNoteId)
          if (n && n.app_id === p.appId && n.tenant_id === p.tenantId) {
            await creditNotesRepo.setVerifactu(c, p.creditNoteId, {
              status,
              numSerie: p.numSerie ?? null,
              qrPayload: p.qrPayload ?? null,
              qrDataUri: p.qrDataUri ?? null,
            })
          }
        }
      })
    } catch (err) {
      logger.error({ err, type: event.type, channel }, 'tpv verifactu event handler failed')
    }
  })

  return sub
}
