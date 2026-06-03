import { ForbiddenError, NotFoundError } from '@apphub/platform-sdk/errors'

export const STAFF_ROLES = new Set(['staff', 'super_admin'])
export const MANAGER_ROLES = new Set(['owner', 'admin'])

export function isStaff(ctx) {
  return STAFF_ROLES.has(ctx.role)
}

// The caller must be an active participant of the conversation, OR platform
// staff (staff can read/moderate any conversation in their tenant).
export function ensureParticipant(participant, ctx) {
  if (isStaff(ctx)) return
  if (!participant || participant.left_at) throw new ForbiddenError('not a participant of this conversation')
}

// The caller must manage the conversation (owner/admin participant) or be staff.
export function ensureManager(participant, ctx) {
  if (isStaff(ctx)) return
  if (!participant || participant.left_at) throw new ForbiddenError('not a participant of this conversation')
  if (!MANAGER_ROLES.has(participant.role)) throw new ForbiddenError('requires owner/admin role in this conversation')
}

export function requireStaff(ctx) {
  if (!isStaff(ctx)) throw new ForbiddenError('requires staff role')
}

export function ensureFound(row, resource) {
  if (!row) throw new NotFoundError(resource)
  return row
}
