// Every 15 minutes — force-close TPV cash sessions left open beyond the
// tenant's session_autoclose_hours (fallback: platform default in
// platform_tpv.config, then 16h). Runs cross-tenant with BYPASSRLS; the
// theoretical cash snapshot is computed from the session's movements so the
// manager can still reconcile the till afterwards. tpv reacts to the
// tpv.session.force_closed event (no Z report is generated — a forced close
// has no declared count; the reopen + proper close flow produces it).

export const meta = {
  name:        'tpv-session-autoclose',
  cron:        '*/15 * * * *',
  description: 'Force-close TPV cash sessions left open beyond the tenant autoclose window',
}

export async function run({ db, publish, logger }) {
  const { rows } = await db.query(
    `UPDATE platform_tpv.cash_sessions s
        SET status = 'force_closed',
            closed_at = now(),
            theoretical_close = jsonb_build_object('cash', (
              SELECT COALESCE(SUM(m.amount_cents), 0)
                FROM platform_tpv.cash_movements m
               WHERE m.session_id = s.id
            )),
            updated_at = now()
      WHERE s.status = 'open'
        AND s.opened_at < now() - make_interval(hours => COALESCE(
              (SELECT t.session_autoclose_hours
                 FROM platform_tpv.settings t
                WHERE t.app_id = s.app_id AND t.tenant_id = s.tenant_id
                ORDER BY t.sub_tenant_id NULLS LAST LIMIT 1),
              (SELECT NULLIF(c.plain_value, '')::int
                 FROM platform_tpv.config c
                WHERE c.key = 'default_session_autoclose_hours'),
              16))
      RETURNING id, app_id, tenant_id, sub_tenant_id, device_id`,
  )
  for (const s of rows) {
    await publish({
      type: 'tpv.session.force_closed',
      payload: {
        appId:       s.app_id,
        tenantId:    s.tenant_id,
        subTenantId: s.sub_tenant_id,
        sessionId:   s.id,
        deviceId:    s.device_id,
      },
    })
  }
  if (rows.length) logger.info({ count: rows.length }, 'stale tpv cash sessions force-closed')
  return { rowsAffected: rows.length }
}
