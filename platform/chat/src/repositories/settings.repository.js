const SCHEMA = 'platform_chat'

// Selects every configurable column, including those added in 0002 (DM
// requests, attachment + word policies) and 0003 (per-priority SLA thresholds,
// search language). Earlier versions of this file omitted the 0002 columns, so
// dm_requests / banned_words / allowed_attachment_kinds resolved to undefined.
const COLS = `
  app_id, tenant_id, allow_groups, max_group_size, redaction_enabled,
  retention_days, support_enabled, dm_requests, max_attachment_mb,
  allowed_attachment_kinds, banned_words, sla_minutes_low, sla_minutes_normal,
  sla_minutes_high, sla_minutes_urgent, search_language, support_auto_reply,
  created_at, updated_at
`

export async function find(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.settings WHERE app_id = $1 AND tenant_id = $2`,
    [appId, tenantId],
  )
  return rows[0] ?? null
}

export async function upsert(client, appId, tenantId, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.settings
       (app_id, tenant_id, allow_groups, max_group_size, redaction_enabled, retention_days,
        support_enabled, dm_requests, max_attachment_mb, allowed_attachment_kinds, banned_words,
        sla_minutes_low, sla_minutes_normal, sla_minutes_high, sla_minutes_urgent, search_language,
        support_auto_reply)
     VALUES ($1,$2,
       COALESCE($3, true), COALESCE($4, 256), COALESCE($5, false), $6, COALESCE($7, true),
       COALESCE($8, false), $9, $10, $11, $12, $13, $14, $15, COALESCE($16, 'simple'),
       NULLIF($17, ''))
     ON CONFLICT (app_id, tenant_id) DO UPDATE SET
       allow_groups             = COALESCE($3,  ${SCHEMA}.settings.allow_groups),
       max_group_size           = COALESCE($4,  ${SCHEMA}.settings.max_group_size),
       redaction_enabled        = COALESCE($5,  ${SCHEMA}.settings.redaction_enabled),
       retention_days           = $6,
       support_enabled          = COALESCE($7,  ${SCHEMA}.settings.support_enabled),
       dm_requests              = COALESCE($8,  ${SCHEMA}.settings.dm_requests),
       max_attachment_mb        = COALESCE($9,  ${SCHEMA}.settings.max_attachment_mb),
       allowed_attachment_kinds = COALESCE($10, ${SCHEMA}.settings.allowed_attachment_kinds),
       banned_words             = COALESCE($11, ${SCHEMA}.settings.banned_words),
       sla_minutes_low          = COALESCE($12, ${SCHEMA}.settings.sla_minutes_low),
       sla_minutes_normal       = COALESCE($13, ${SCHEMA}.settings.sla_minutes_normal),
       sla_minutes_high         = COALESCE($14, ${SCHEMA}.settings.sla_minutes_high),
       sla_minutes_urgent       = COALESCE($15, ${SCHEMA}.settings.sla_minutes_urgent),
       search_language          = COALESCE($16, ${SCHEMA}.settings.search_language),
       -- empty string clears the auto-reply; null leaves it unchanged.
       support_auto_reply       = CASE WHEN $17 = '' THEN NULL
                                       ELSE COALESCE($17, ${SCHEMA}.settings.support_auto_reply) END
     RETURNING ${COLS}`,
    [
      appId, tenantId,
      s.allowGroups ?? null, s.maxGroupSize ?? null, s.redactionEnabled ?? null,
      s.retentionDays ?? null, s.supportEnabled ?? null, s.dmRequests ?? null,
      s.maxAttachmentMb ?? null, s.allowedAttachmentKinds ?? null, s.bannedWords ?? null,
      s.slaMinutesLow ?? null, s.slaMinutesNormal ?? null, s.slaMinutesHigh ?? null,
      s.slaMinutesUrgent ?? null, s.searchLanguage ?? null, s.supportAutoReply ?? null,
    ],
  )
  return rows[0]
}
