-- Grant the scheduler role cross-schema read access to platform_verifactu so the
-- verifactu-remision-retry and verifactu-dlq-alert jobs can find rows due for
-- remission / stuck in the DLQ. The scheduler only READS the queue (it is
-- BYPASSRLS, so it sees every tenant) and publishes verifactu.remision.due /
-- verifactu.remision.dlq_alert events; the heavy lifting (cert decryption, XAdES
-- signing, mTLS SOAP) stays in the platform/verifactu module, which owns the
-- writes. Conditional so it's a no-op where verifactu isn't deployed yet.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_scheduler')
     AND EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_verifactu') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_verifactu TO svc_platform_scheduler';
    EXECUTE 'GRANT SELECT ON platform_verifactu.remision_queue TO svc_platform_scheduler';
    -- registros: para detectar tenants con altas aún sin encolar (primer envío).
    EXECUTE 'GRANT SELECT ON platform_verifactu.registros TO svc_platform_scheduler';
  END IF;
END
$$;
