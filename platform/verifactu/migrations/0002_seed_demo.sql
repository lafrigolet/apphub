-- Demo seed para el portal verifactu (sin login todavía).
--
-- Los endpoints portal-facing son públicos y se scopean por (app_id,
-- tenant_id); el portal usa este tenant demo fijo (lib/tenant.js
-- DEMO_TENANT_ID) hasta que se cablee el login real. Corre como superuser
-- en la migración → bypassa RLS, por eso los INSERT no necesitan
-- set_config('app.tenant_id').
--
-- app_id = 'verifactu', tenant_id = 11111111-1111-4111-8111-111111111111

-- 1. Registros + cadena de huellas (emisor)
INSERT INTO platform_verifactu.registros
  (app_id, tenant_id, numero, num_serie, estado_remision, cliente_nombre, cliente_nif, fecha_expedicion, importe_total, total_display, huella, huella_anterior)
VALUES
  ('verifactu','11111111-1111-4111-8111-111111111111', 128, '2027-A/000128', 'ok',   'Cliente Norte S.A.', 'A28000001', '02-01-2027',  121.00, '121,00 €',   '9B2E7C4A…FF', '3C9F0AB1…A1'),
  ('verifactu','11111111-1111-4111-8111-111111111111', 127, '2027-A/000127', 'warn', 'Servicios Beta',     'B33000002', '02-01-2027',  847.55, '847,55 €',   '3C9F0AB1…A1', '77AD22E9…0C'),
  ('verifactu','11111111-1111-4111-8111-111111111111', 126, '2027-A/000126', 'err',  'Distribuciones Sur', 'B41000003', '01-01-2027', 1452.00, '1.452,00 €', '77AD22E9…0C', NULL),
  ('verifactu','11111111-1111-4111-8111-111111111111', 125, '2027-A/000125', 'ok',   'Logística Oeste',    'B46000004', '01-01-2027',  318.20, '318,20 €',   '55BC91D4…7E', NULL),
  ('verifactu','11111111-1111-4111-8111-111111111111', 124, '2027-A/000124', 'ok',   'Comercial Levante',  'B03000005', '31-12-2026',  990.00, '990,00 €',   '12FE88A0…3B', NULL);

-- 2. Eventos del SIF (emisor "Eventos" + admin "Auditoría")
INSERT INTO platform_verifactu.eventos
  (app_id, tenant_id, tag, tone, descripcion, ts_display, ocurrido_en)
VALUES
  ('verifactu','11111111-1111-4111-8111-111111111111', 'ARRANQUE', 'azul',    'SIF iniciado · inst. 0001',                '02-01 08:00:11', '2027-01-02 08:00:11+01'),
  ('verifactu','11111111-1111-4111-8111-111111111111', 'LOGIN',    'slate',   'admin@ejemplo.es · mTLS',                  '02-01 08:02:40', '2027-01-02 08:02:40+01'),
  ('verifactu','11111111-1111-4111-8111-111111111111', 'EXPORT',   'emerald', 'Exportación de registros (1.452)',         '02-01 09:14:52', '2027-01-02 09:14:52+01'),
  ('verifactu','11111111-1111-4111-8111-111111111111', 'ANOMALÍA', 'amber',   'Discontinuidad temporal detectada',        '02-01 11:02:30', '2027-01-02 11:02:30+01'),
  ('verifactu','11111111-1111-4111-8111-111111111111', 'RESTORE',  'azul',    'Restauración verificada · cadena íntegra', '02-01 12:40:08', '2027-01-02 12:40:08+01');

-- 3. Lotes de remisión (asesoría)
INSERT INTO platform_verifactu.lotes
  (app_id, tenant_id, codigo, info, label, tone, pulse, created_at)
VALUES
  ('verifactu','11111111-1111-4111-8111-111111111111', 'LOTE-2027-0042', '847 registros · 9 NIF',    'Completado',     'ok',    false, '2027-01-02 10:00:03+01'),
  ('verifactu','11111111-1111-4111-8111-111111111111', 'LOTE-2027-0043', '312 registros · 4 NIF',    'Enviando',       'azul',  true,  '2027-01-02 10:00:02+01'),
  ('verifactu','11111111-1111-4111-8111-111111111111', 'LOTE-2027-0041', '1.000 registros · 11 NIF', '5 advertencias', 'amber', false, '2027-01-02 10:00:01+01');

-- 4. Clientes (cartera) + apoderamiento (representación = repr_estado IS NOT NULL)
INSERT INTO platform_verifactu.clientes
  (app_id, tenant_id, nombre, nif, facturas_mes, estado, apoderamiento_doc, apoderamiento_vigencia, repr_estado, repr_tone, created_at)
VALUES
  ('verifactu','11111111-1111-4111-8111-111111111111', 'Cliente Norte S.A.', 'A28000001', 128, 'ok',   'REPR-0012', 'hasta 31-12-2027', 'Vigente',   'ok',    '2027-01-02 10:00:01+01'),
  ('verifactu','11111111-1111-4111-8111-111111111111', 'Servicios Beta',     'B33000002',  64, 'warn', 'REPR-0019', 'hasta 30-06-2027', 'Vigente',   'ok',    '2027-01-02 10:00:02+01'),
  ('verifactu','11111111-1111-4111-8111-111111111111', 'Distribuciones Sur', 'B41000003',  22, 'err',  '—',         '—',                'Pendiente', 'amber', '2027-01-02 10:00:03+01'),
  ('verifactu','11111111-1111-4111-8111-111111111111', 'Logística Oeste',    'B46000004', 311, 'ok',   NULL, NULL, NULL, NULL, '2027-01-02 10:00:04+01'),
  ('verifactu','11111111-1111-4111-8111-111111111111', 'Comercial Levante',  'B03000005',  97, 'ok',   NULL, NULL, NULL, NULL, '2027-01-02 10:00:05+01'),
  ('verifactu','11111111-1111-4111-8111-111111111111', 'Talleres Centro',    'B45000006',  45, 'ok',   NULL, NULL, NULL, NULL, '2027-01-02 10:00:06+01');

-- 5. Certificados (admin)
INSERT INTO platform_verifactu.certificados
  (app_id, tenant_id, nombre, meta, estado, tone, icon_tone, created_at)
VALUES
  ('verifactu','11111111-1111-4111-8111-111111111111', 'Certificado del obligado · B12345678', 'PKCS#12 · caduca 14-09-2027', 'Vigente',       'ok',    'emerald', '2027-01-02 10:00:01+01'),
  ('verifactu','11111111-1111-4111-8111-111111111111', 'Certificado de representante',         'PKCS#12 · caduca 02-03-2027', 'Caduca pronto', 'amber', 'emerald', '2027-01-02 10:00:02+01'),
  ('verifactu','11111111-1111-4111-8111-111111111111', 'Certificado de pruebas (test)',        'solo preportal.aeat.es',      'Sandbox',       'slate', 'slate',   '2027-01-02 10:00:03+01');

-- 6. Control de flujo (admin)
INSERT INTO platform_verifactu.config (app_id, tenant_id)
VALUES ('verifactu','11111111-1111-4111-8111-111111111111');

-- 7. Cotejos (receptor — historial)
INSERT INTO platform_verifactu.cotejos
  (app_id, tenant_id, nif_emisor, num_serie, resultado, label, tone, ts_display, created_at)
VALUES
  ('verifactu','11111111-1111-4111-8111-111111111111', 'B12345678', '2027-A/000128', 'verificada', 'Verificada', 'ok',   'hace 2 min', '2027-01-02 10:00:03+01'),
  ('verifactu','11111111-1111-4111-8111-111111111111', 'A28000001', '2027-B/004410', 'verificada', 'Verificada', 'ok',   'ayer',       '2027-01-02 10:00:02+01'),
  ('verifactu','11111111-1111-4111-8111-111111111111', 'B99999999', '2027-X/000001', 'no_consta',  'No consta',  'rose', '12-04',      '2027-01-02 10:00:01+01');
