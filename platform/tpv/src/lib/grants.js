import pg from 'pg'
import { logger } from './logger.js'

// Política de grants del módulo: las tablas de snapshot son INMUTABLES para
// el rol del servicio (la migración 0001 hace estos mismos REVOKEs, pero
// ensureModuleRole — que el orquestador ejecuta en cada boot para reconciliar
// roles — re-otorga UPDATE/DELETE sobre TODAS las tablas del schema y los
// desharía). Por eso el módulo exporta enforceGrants() y el orquestador lo
// invoca DESPUÉS de ensureModuleRole. Idempotente; corre como superusuario.
const ENFORCE_SQL = `
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_tpv') THEN
    -- append-only puros: ni UPDATE ni DELETE
    REVOKE UPDATE, DELETE ON platform_tpv.cash_movements  FROM svc_platform_tpv;
    REVOKE UPDATE, DELETE ON platform_tpv.cash_counts     FROM svc_platform_tpv;
    REVOKE UPDATE, DELETE ON platform_tpv.z_reports       FROM svc_platform_tpv;
    REVOKE UPDATE, DELETE ON platform_tpv.receipt_lines   FROM svc_platform_tpv;
    -- recibos: snapshot intocable; UPDATE solo fiscal async + status + updated_at
    REVOKE UPDATE, DELETE ON platform_tpv.receipts        FROM svc_platform_tpv;
    GRANT  UPDATE (verifactu_status, verifactu_num_serie, qr_payload, qr_data_uri, status, updated_at)
      ON platform_tpv.receipts TO svc_platform_tpv;
    -- abonos: igual, más el flujo de autorización (que asigna el correlativo)
    REVOKE UPDATE, DELETE ON platform_tpv.credit_notes    FROM svc_platform_tpv;
    GRANT  UPDATE (verifactu_status, verifactu_num_serie, qr_payload, qr_data_uri,
                   status, authorized_by, refund_external_ref, issued_at,
                   series_id, number, num_serie, updated_at)
      ON platform_tpv.credit_notes TO svc_platform_tpv;
  END IF;
END
$$;
`

export async function enforceGrants(superuserUrl) {
  if (!superuserUrl) return
  const pool = new pg.Pool({ connectionString: superuserUrl })
  const client = await pool.connect()
  try {
    await client.query(ENFORCE_SQL)
    logger.info('tpv immutability grants enforced')
  } finally {
    client.release()
    await pool.end()
  }
}
