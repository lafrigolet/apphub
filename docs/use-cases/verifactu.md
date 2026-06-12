# Casos de uso — `platform/verifactu` (platform-marketplace → platform-core)

> Dominio: SIF (Sistema Informático de Facturación) / facturación verificable AEAT — Veri\*Factu, RD 1007/2023, Orden HAC/1177/2024. Módulo platform reutilizable por cualquier app que deba cumplir la obligación de facturación verificable: genera y encadena registros de alta/anulación, eventos del SIF, lotes de remisión, QR de cotejo, y gestiona la cartera de clientes en caso de uso asesoría/representante.

## Estado actual (implementado)

Modelo de datos completo persistido en `platform_verifactu` (RLS por `app_id` + `tenant_id`): tablas `registros`, `eventos`, `lotes`, `clientes`, `certificados`, `config`, `cotejos`. Algoritmo de huella SHA-256 encadenada para registros de alta, anulación y eventos del SIF (lib/huella.js). Verificación del enlace de la cadena (lib/cadena.js). Generación de URL de cotejo + QR data-URI (lib/cotejo.js + lib/qr.js). Validación estructural pre-remisión (lib/validacion.js). Scaffold del envelope SOAP + cliente mTLS gateado por certificado (lib/soap-envelope.js + lib/remision.js). Endpoints públicos para emisor, asesoría, administrador y receptor (`GET/POST /v1/verifactu/*`). Modalidad única Veri\*Factu (NO\_VERI\*FACTU descartada en migración 0006). NIF del obligado emisor en `config` (migración 0003). Huella encadenada en eventos (migración 0005). Identidad del SIF en lib/sif.js (productor, versión, nº instalación).

Orden exacto de campos de la huella de **RegistroAlta blindado contra el VECTOR DE TEST OFICIAL de la AEAT** (ejemplo `89890001K / 12345678/G33` → `3C46…2F60`, `src/__tests__/huella.test.js` · "vector oficial AEAT").

**Feed desde `platform/tpv` (ADR 015):** subscriber `services/tpv-events.handler.js` consume `tpv.receipt.issued` (→ registro de alta F1/F2 con `idEmisor` del emisor por-tenant del recibo) y `tpv.receipt.voided` (→ rectificativa R1 con importe negativo), y publica `verifactu.registro.created {receiptId|creditNoteId, numSerie, huella, qrPayload, qrDataUri}` (o `verifactu.registro.failed`) que tpv usa para completar el QR del documento async. `crearRegistro` acepta `input.idEmisor` explícito y devuelve `qrUrl`/`numero`.

**Camino de remisión real (implementado):** certificados PKCS#12 cifrados at-rest
(AES-256-GCM) con extracción de metadatos reales; firma XAdES *enveloped*
RSA-SHA256 verificable (`lib/xades.js`); **namespaces y XSD oficiales de la AEAT**
(`schemas/aeat/SuministroLR.xsd` + `SuministroInformacion.xsd`) en el envelope
SOAP; cola de remisión `remision_queue` con back-off exponencial + DLQ y worker
del `platform-scheduler` (`verifactu-remision-retry` / `verifactu-dlq-alert`) que
publica ticks que el módulo drena vía mTLS; integración por eventos
`order.completed` / `donation.created` (POS vía cadena TPV); endpoints
autenticados (`appGuard` + `requireRole`).

**Piezas pendientes de specs AEAT:** perfil **XAdES-EPES** (identificador de
política de firma de la AEAT) sobre la base XML-DSig ya implementada; validación
**XSD estricta en runtime** (los XSD oficiales se versionan en `schemas/aeat/`,
falta enchufar un validador); cotejo externo contra la Sede AEAT; nivel de
corrección de errores del QR; catálogo de tipos de evento (Orden HAC/1177/2024);
vector oficial de RegistroAnulacion/RegistroEvento (el doc AEAT sólo publica el
ejemplo de alta).

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Registro de alta de factura

- ✅ `POST /v1/verifactu/registros` — crea un registro de alta con número de secuencia correlativo, `num_serie`, `tipo_factura` (F1/…), cliente, fecha, importe y cuota.
- ✅ Cálculo de la huella SHA-256 encadenada (`cadenaAlta` → `sha256Upper`) con los campos en el orden reconstruido del algoritmo AEAT.
- ✅ Referencia a la huella anterior (`huellaAnterior = NULL` en el primer registro → primer eslabón de la cadena).
- ✅ Persistencia de `huella` + `huella_anterior` + `qr_url` en `registros`.
- ✅ `IDEmisorFactura` = NIF del obligado (de `config.nif_obligado`), no el NIF del cliente receptor.
- ✅ Orden de campos de la huella de RegistroAlta **blindado contra el vector de test oficial de la AEAT** (ejemplo `89890001K / 12345678/G33` → digest `3C464DAF…F38F12F60`; `src/__tests__/huella.test.js`). ~~pendiente de blindar con el vector de test oficial~~.
- 🔧 `FechaHoraHusoGenRegistro` usa `new Date().toISOString()` (UTC `Z`) — verificar si la AEAT acepta offset `+00:00` o exige el huso local del sistema.
- ❌ Validación completa contra el XSD oficial de la AEAT (E2) — solo validación estructural propia.
- ❌ Soporte de todos los tipos de factura AEAT (F2 rectificativa por sustitución, F3 resumen, R1–R5, …).
- ❌ Soporte de desglose de IVA por tipo impositivo (líneas de cuota con distintos tipos y bases).
- ❌ Facturas simplificadas (tiques) vs completas.
- ❌ Facturas intracomunitarias y exportaciones (operaciones exentas, NSP/NIF-UE).
- ❌ Referencia a la factura rectificada en los registros de tipo rectificativo.

## 2. Registro de anulación de factura

- ✅ Algoritmo de huella para `tipo = 'anulacion'` (`cadenaAnulacion` — campos distintos de alta: `IDEmisorFacturaAnulada`, `NumSerieFacturaAnulada`, `FechaExpedicionFacturaAnulada`).
- ✅ Dispatcher `calcularHuella` selecciona el algoritmo correcto según `tipo`.
- ✅ `tipo` persistido en `registros` con CHECK `('alta','anulacion')`.
- 🔧 Sin endpoint dedicado para anulación — el `POST /registros` con `tipo='anulacion'` ya valida la referencia (`numSerieAnulada`/`numSerie`).
- ✅ Reglas de negocio: `ANULACION_SIN_REF` (sin referencia), `ANULACION_NO_CONSTA` (la factura no consta en la cadena del obligado), `ANULACION_DUPLICADA` (ya anulada). ~~❌~~
- ❌ Flujo de anulación parcial o sustitución (rectificativa R1–R5).

## 3. Cadena de huellas encadenadas (hash chain)

- ✅ Cada registro enlaza con la huella del registro inmediatamente anterior (`huella_anterior`).
- ✅ El primer registro de la cadena declara `huella_anterior = NULL` (eslabón inicial).
- ✅ `GET /v1/verifactu/cadena` — devuelve los últimos registros con su `huella` y `anterior` para visualización del portal.
- ✅ `GET /v1/verifactu/cadena/verificar` — recorre hasta 1 000 registros y valida que cada `huella_anterior` apunta exactamente a la huella del registro previo (`verificarEnlace`); detecta roturas.
- ✅ Cadena de eventos del SIF también encadenada desde migración 0005 (`huella`+`huella_anterior` en `eventos`).
- 🔧 `verificarEnlace` comprueba el encadenamiento declarado pero **no recalcula la huella** de cada registro (eso lo hace ahora `recalcularCadena`, ver abajo).
- ✅ Recálculo completo de la cadena (full re-hash) para auditoría de inalterabilidad — `GET /v1/verifactu/cadena/recalcular` (`recalcularCadena` recomputa cada huella desde campos canónicos y la compara con la persistida). ~~❌~~
- ✅ Detección de registros interpolados / insertados retroactivamente (el re-hash rompe el encadenamiento recalculado, no solo el declarado). ~~❌~~
- ✅ Exportación de la cadena completa (registros + eventos + identidad SIF) en JSON — `GET /v1/verifactu/exportar`. ~~❌~~ (formato AEAT XML para peritaje sigue pendiente)

## 4. Firma electrónica XAdES

- ✅ Firma **XML-DSig enveloped RSA-SHA256** del RegistroAlta con KeyInfo X509, verificable (`lib/xades.js`, xml-crypto), a partir del PKCS#12 descifrado; `POST /registros/:numSerie/firmar`. ~~❌~~ Base sobre la que añadir XAdES-EPES.
- 🔧 Perfil **XAdES-BES/EPES** (QualifyingProperties: SigningTime, SigningCertificate, política de firma AEAT) encima de la firma XML-DSig — pendiente del identificador de política oficial. (En Veri\*Factu la firma es opcional.)
- ❌ Firma con certificado cualificado (persona física o jurídica, PKCS#12).
- ❌ Firma con sello electrónico cualificado (certificado de sello de empresa, endpoint `*10` del SOAP).
- ❌ Validación de la firma recibida en la respuesta de la AEAT.
- ❌ Timestamping (TSA) de los registros firmados.
- ❌ Integración con HSM/vault para la clave privada — la tabla `certificados` guarda solo metadatos, la clave privada nunca se persiste en BD.

## 5. Remisión Veri\*Factu a la AEAT (SOAP/REST)

- 🔧 Envelope SOAP construido (`construirEnvelope`) con `RegFactuSistemaFacturacion`, cabecera `ObligadoEmision` + `Representante` opcional, y líneas `RegistroAlta`/`RegistroAnulacion` con `IDVersion`, `NumSerieFactura` y `Huella`.
- 🔧 Namespaces SOAP **ilustrativos** — pendientes de extraer del WSDL oficial de la AEAT (TODO D1/D4/E1).
- 🔧 Cliente HTTPS mTLS (`httpsSoapPost`) con agente `pfx`/`passphrase` — funcional a nivel de transporte pero **gateado**: lanza error si no hay certificado PKCS#12 configurado.
- 🔧 Endpoints test (`prewww1`) y producción (`www1`) y sus equivalentes de sello (`prewww10`/`www10`) correctamente diferenciados.
- 🔧 `parseRespuesta` normaliza la respuesta XML a `{ estadoEnvio, csv, tiempoEsperaEnvio, lineas[] }`.
- 🔧 `lotes` se persiste como resumen display (`codigo`, `info`, `label`, `tone`, `pulse`) — sin ligarlo a los registros individuales remitidos ni a la respuesta real de la AEAT.
- ✅ Remisión real vía cola: `services/remision.service.js` reclama los vencidos, construye el envelope (namespaces oficiales), firma opcional, envía por mTLS con el cert activo y persiste el resultado. Los `registros` son append-only → el estado vive en `remision_queue`. ~~❌~~
- ✅ Cola de remisión asíncrona (`remision_queue`, batch ≤ `max_registros_lote`) drenada por el worker del scheduler. ~~❌~~
- ✅ Reintentos con **back-off exponencial** (2^intentos min) y **DLQ** al agotar `max_intentos`; `POST /dlq/:id/reintentar`. ~~❌~~
- ✅ Estado por registro (`pendiente`/`enviando`/`ok`/`warn`/`err`/`dlq`) actualizado desde la respuesta AEAT. ~~❌~~
- ✅ Almacenamiento del **CSV** por registro y por lote (`csv_aeat` / `lotes.csv`). ~~❌~~
- ✅ Procesado de las `RespuestaLinea` individuales (estado + código de error por registro; reintento selectivo desde DLQ). ~~❌~~
- ❌ Endpoint REST alternativo (si la AEAT publica API REST además de SOAP).

## 6. Modo contingencia y operación offline

- ❌ Modo contingencia: continuar generando registros localmente cuando la AEAT no responde, con marcado `contingencia = true`.
- ❌ Remisión diferida de los registros acumulados en contingencia al recuperar conectividad.
- ❌ Periodo máximo legal de contingencia (verificar RD 1007/2023 art. …) con alerta de SLA.
- ❌ Detección automática de fallo del servicio AEAT y activación/desactivación de modo contingencia.
- ❌ Registro del evento de SIF `ANOMALIA` en la cadena de eventos al entrar/salir de contingencia.

## 7. Generación de QR de cotejo

- ✅ `buildCotejoUrl` construye la URL del servicio de cotejo AEAT (`ValidarQR`) con parámetros `nif`, `numserie`, `fecha`, `importe` en el orden FIJO especificado.
- ✅ `generarQrDataUri` genera el QR como PNG data-URI usando la librería `qrcode` con nivel de corrección de errores `M` (15%) y tamaño 220 px.
- ✅ `GET /v1/verifactu/qr?numSerie=…` — devuelve `{ numSerie, url, dataUri }` para un registro específico o el último.
- ✅ `qr_url` persistida en `registros` en el momento de la inserción.
- ✅ Distinción `test` (`prewww2.aeat.es`) vs `prod` (`www2.agenciatributaria.gob.es`) en la URL base.
- 🔧 Nivel de corrección de errores `M` y tamaño del módulo **no confirmados** contra la spec oficial del QR de la AEAT.
- ❌ El QR no incluye la firma XAdES (pendiente de bloque 4).
- ❌ Impresión/incrustación del QR en el PDF de la factura.
- ❌ QR para facturas rectificativas/anulaciones (URL distinta o mismo endpoint con parámetros distintos — verificar spec).

## 8. Cotejo / verificación ciudadana

- ✅ `POST /v1/verifactu/cotejo` — acepta `nifEmisor` + `numSerie` directos **o** una `url` de cotejo completa (parsea los parámetros).
- ✅ Verificación local contra la cadena del SIF: `verificada` si el registro `num_serie` consta en la BD, `no_consta` en caso contrario.
- ✅ Historial de cotejos en tabla `cotejos` (`resultado`, `label`, `tone`, `ts_display`).
- ✅ `GET /v1/verifactu/cotejos` — lista los últimos 50 cotejos del tenant.
- 🔧 Cotejo **local** (contra la BD del SIF propio) — no realiza una consulta al servicio externo de la Sede Electrónica de la AEAT (TODO B8). En producción el receptor debe poder cotejar contra la AEAT, no contra el SIF del emisor.
- ❌ Cotejo contra el servicio externo AEAT (`ValidarQR`) con interpretación de la respuesta.
- ❌ Cotejo de facturas de terceros (desde la perspectiva del receptor, sin acceso a la BD del emisor).
- ❌ Widget embebible o endpoint público sin autenticación de tenant para que el receptor final (ciudadano/empresa) verifique.
- ❌ Integración de la respuesta de cotejo externo en el historial local.

## 9. Eventos del SIF y auditoría del sistema

- ✅ Tabla `eventos` con `tag` (ARRANQUE / RESTAURACION / EXPORTACION / ANOMALIA / LOGIN), `tone`, `descripcion`, `ocurrido_en`.
- ✅ `POST /v1/verifactu/eventos` — registra un evento del SIF con huella encadenada (`construirEvento` → `huellaEvento` → SHA-256).
- ✅ `GET /v1/verifactu/eventos` — lista de eventos ordenados cronológicamente.
- ✅ Catálogo de tipos de evento con tono de pill en `EVENTOS_CATALOGO` (lib/sif.js).
- ✅ Identidad del SIF (NIF productor, nombre, ID sistema, versión, nº instalación) centralizada en `SIF_IDENTITY`.
- 🔧 Catálogo de tipos de evento basado en interpretación de la Orden HAC/1177/2024 — **pendiente de contrastar con fuente oficial**.
- 🔧 `SIF_IDENTITY` con valores de demo (`B87654321`, `FacturaNode`) — en producción debe salir de la declaración responsable del fabricante y de la configuración por instalación.
- ❌ Registro automático del evento `ARRANQUE` al arrancar el proceso (hook en `register`).
- ❌ Registro automático del evento `EXPORTACION` al exportar registros.
- ❌ Registro automático del evento `ANOMALIA` al detectar discontinuidades en la cadena.
- ❌ `LOGIN` registrado automáticamente al autenticarse un usuario en el portal del SIF.
- ❌ Eventos `RESTAURACION` con referencia al backup restaurado (hash del fichero).
- ❌ Separación entre eventos de usuario (F3) y eventos de sistema (F2) si la AEAT los diferencia.

## 10. Validación estructural pre-remisión

- ✅ `POST /v1/verifactu/validar` — valida un registro aportado o una muestra autoconsistente generada internamente.
- ✅ Comprueba campos obligatorios: `idEmisor`, `numSerie`, `fechaExpedicion`, `importeTotal`.
- ✅ Coherencia básica: `cuotaTotal` no puede superar `importeTotal`.
- ✅ Si el registro declara huella, la recalcula y compara (`calcularHuella` → string equality).
- ✅ Respuesta estructurada `{ ok, checks: [{ level, campo, mensaje }] }`.
- 🔧 **No es validación contra el XSD oficial** — los XSD de la AEAT no son descargables automáticamente (TODO E2).
- ❌ Validación XSD completa con los esquemas oficiales (`SuministroLR.xsd`, `SuministroInformacion.xsd`).
- ❌ Validación semántica adicional (NIF válido con algoritmo de control, fecha en rango, código de divisa, …).
- ❌ Validación de firmas XAdES (pendiente de bloque 4).
- ❌ Modo dry-run de remisión contra el entorno de pruebas de la AEAT sin persistir.

## 11. Control de flujo y configuración por tenant

- ✅ Tabla `config` con clave primaria `(app_id, tenant_id)`: `tiempo_espera_envio`, `max_registros_lote`, `reintentos`, `dlq_enabled`, `nif_obligado`, `nombre_obligado`, `entorno` (migración 0009).
- ✅ `GET /v1/verifactu/config` — lee la config del tenant (con defaults si no existe fila).
- ✅ `PATCH /v1/verifactu/config` — upsert de cualquier subconjunto (incluye `nifObligado`, `nombreObligado`, `entorno`).
- ✅ **Gestión desde `console.hulkstein`** (vista *Veri\*Factu (SIF)* del `console-portal`): el staff elige el tenant (impersonación `?appId=&tenantId=`) y edita emisor, entorno, parámetros de flujo y certificados.
- ✅ `nif_obligado` / `nombre_obligado` alimentan la cabecera SOAP y la URL de cotejo.
- ✅ Configuración del entorno (`test` / `prod`) para la remisión por tenant (`entorno`, usado por la cola). ~~❌~~
- 🔧 `max_registros_lote = 1000` — **verificar el límite oficial** en el WSDL/normativa AEAT.
- ❌ Configuración de alertas: umbral de registros pendientes, SLA de remisión, notificación de lote rechazado.
- ❌ Historial de cambios de config (audit log).
- ❌ Configuración del productor del SIF (sustituir `SIF_IDENTITY` hard-coded por valores por tenant).

## 12. Gestión de certificados digitales

- ✅ Tabla `certificados` con metadatos: `nombre`, `meta` (texto libre: "PKCS#12 · caduca 14-09-2027"), `estado` ("Vigente"), `tone`, `icon_tone`.
- ✅ `GET /v1/verifactu/certificados` — lista los certificados del tenant.
- ✅ CRUD completo: `POST/GET:id/POST:id/renovar/DELETE /v1/verifactu/certificados`. ~~🔧 solo lectura~~
- ✅ Carga del PKCS#12 **cifrado** (clave privada nunca en claro — AES-256-GCM con `PLATFORM_CONFIG_ENCRYPTION_KEY`, base64 del DER; `repositories/certificados.repository.js`). ~~❌~~
- ✅ Extracción y persistencia de metadatos reales (CN, emisor, nº de serie, caducidad, uso firma/sello) con `node-forge` (`lib/pkcs12.js`). ~~❌~~
- ✅ Renovación (sustituye el PKCS#12 sin cambiar el id) y revocación/baja (DELETE). ~~❌~~
- ❌ Alerta de caducidad (REUSE `platform/scheduler` → `verifactu.cert.expiring_soon`).
- ❌ Soporte diferenciado: certificado de persona física (firma) vs certificado de sello (empresa).
- ❌ Validación de la cadena de confianza del certificado cargado (CA raíz FNMT).

## 13. Multi-emisor / multi-tenant (asesoría y representante)

- ✅ Tabla `clientes` con `nombre`, `nif`, `facturas_mes`, `estado`, `apoderamiento_doc`, `apoderamiento_vigencia`, `repr_estado`, `repr_tone`.
- ✅ `GET /v1/verifactu/clientes` — cartera de clientes del tenant-asesoría.
- ✅ `GET /v1/verifactu/representacion` — clientes con apoderamiento activo (solo filas con `repr_estado IS NOT NULL`).
- ✅ `POST /v1/verifactu/clientes` — alta de cliente en la cartera.
- ✅ `construirEnvelope` soporta `Representante` en la cabecera SOAP (`NombreRazon` + `NIF`).
- 🔧 Sin endpoint para registrar/actualizar el apoderamiento (REPR-XXXX) con su vigencia — solo carga manual en BD/seed.
- ❌ Remisión por cuenta de tercero: seleccionar cliente + su certificado para firmar + enviar en su nombre.
- ❌ Nómina de remisiones por cliente (¿cuántos registros pendientes/enviados tiene cada representado?).
- ❌ Revocación de apoderamiento y bloqueo automático de futuras remisiones en nombre del representado.
- ❌ Validación de la vigencia del apoderamiento antes de cada remisión.
- ❌ Vista de dashboard multi-cliente para la asesoría (totales, estados, alertas por cliente).

## 14. Series de facturación

- ✅ Tabla `series` (migración 0007) con `codigo`, `ejercicio`, `siguiente`, `activa`; endpoints `GET/POST /v1/verifactu/series` + `POST /v1/verifactu/series/:codigo/cerrar`. ~~❌~~
- ✅ Reserva atómica del correlativo (`reservarNumeroSerie` con `SELECT … FOR UPDATE`) → `num_serie` `CODIGO/000042` sin huecos ni colisiones.
- ✅ Validación de que el `num_serie` pertenece a una serie ACTIVA (serie inexistente/cerrada → `SERIE_INACTIVA`). ~~❌~~
- ✅ Cierre de serie con bloqueo de nuevas inserciones (`cerrarSerie` → `activa=false`; reservar sobre serie cerrada devuelve null). ~~❌~~
- 🔧 `numero` sigue siendo la secuencia global por tenant (posición en la cadena), distinta del correlativo por serie.
- ❌ Múltiples series simultáneas (ventas, rectificativas, exportación, intracomunitarias).
- ❌ Numeración correlativa con gaps: detección de huecos en la numeración e inscripción en el evento de anomalía.

## 15. Integración con módulos `orders`, `donations` y `pos`

- ✅ Integración con `platform/orders`: `order.completed` → registro de alta (F1) con los datos del pedido (`domain-events.handler.js`). ~~❌~~
- ✅ Integración con `platform/donations`: `donation.created` → registro de alta. ~~❌~~ (la especialización fiscal Ley 49/2002 / AEAT 182 queda como mejora.)
- ✅ POS: cubierto **transitivamente** por la cadena `pos.bill.*` → `platform/tpv` → `tpv.receipt.issued` (que ya consume `tpv-events.handler`). NO se consume `pos.bill.closed` aquí para no duplicar la emisión.
- ✅ Referencia cruzada `order_id` / `donation_id` / `bill_id` en `registros` (columnas + índices únicos parciales). ~~❌~~
- ✅ Suscripción a eventos Redis (`*.events`) en vez de integración HTTP directa. ~~❌~~
- ✅ Deduplicación por índice único parcial `(app_id, tenant_id, order_id|donation_id|bill_id)` → reentrega no genera doble emisión (23505 → ignorado). ~~❌~~

## 16. Exportación legal y backup del SIF

- ✅ `GET /v1/verifactu/exportar` — vuelca todos los registros, eventos y metadatos del tenant (JSON). ~~❌~~ (formato XML AEAT oficial pendiente)
- ❌ Firma del fichero de exportación con el certificado del obligado.
- ✅ Registro automático del evento `EXPORTACION` encadenado al exportar (`exportar` inserta el evento antes de devolver). ~~❌~~
- ❌ Backup automático programado (REUSE `platform/scheduler`) con hash del fichero para restauración verificable.
- ❌ Restauración verificable: al restaurar un backup, registrar evento `RESTAURACION` con referencia al fichero.
- ❌ Retención mínima legal (4 años en España) con purga automática de ejercicios fuera de plazo.
- ❌ Formato de exportación XML conforme al XSD de intercambio AEAT.

## 17. Reintentos, DLQ y monitorización de la remisión

- 🔧 `config.reintentos` y `config.dlq_enabled` existen en BD pero **ningún worker los consume**.
- ❌ Cola de remisión persistida en la tabla `lotes` (o tabla `remision_queue`) con estado: `pendiente`, `enviando`, `ok`, `warn`, `err`.
- ❌ Worker asíncrono (job de `platform/scheduler` o proceso dedicado) que consume la cola con back-off exponencial.
- ❌ DLQ (dead-letter queue) para registros que han superado el máximo de reintentos, con alerta a staff.
- ❌ Actualización de `registros.estado_remision` + almacenamiento del CSV de la AEAT por cada línea procesada.
- ❌ Job de `platform/scheduler`: `verifactu-remision-retry` (cada minuto) y `verifactu-dlq-alert` (cada hora).
- ❌ Dashboard de estado de la cola: pendientes, enviados hoy, errores, tiempo medio de procesado.
- ❌ Alerta (REUSE `platform/notifications`) cuando un lote tiene estado `err` o la cola supera N registros pendientes.

## 18. Autenticación, autorización y auditoría

- ✅ Endpoints autenticados con `appGuard`: el scope `(appId, tenantId)` sale del **JWT** (`req.identity`), no de query/body. staff/super_admin pueden impersonar otro tenant por query (`?appId=&tenantId=`). ~~🔧 public~~
- ✅ RLS en BD aísla los datos por `(app_id, tenant_id)` via `withTenantTransaction`.
- ✅ Mutaciones (`POST /registros`, `/eventos`, `/clientes`, `/certificados`, `PATCH /config`, `/remitir`, `/series`, `/exportar`, …) gateadas por `requireRole('super_admin','staff')`. ~~❌~~
- ❌ Audit log de accesos/mutaciones (quién creó/exportó/cambió config) y `user_id` en cada registro.
- ❌ Audit log de accesos/mutaciones (quién creó cada registro, quién exportó, quién cambió config).
- ✅ Inalterabilidad reforzada: trigger `deny_mutation` (migración 0007) bloquea `UPDATE`/`DELETE` sobre `registros` y `eventos` a nivel de motor (append-only). ~~❌~~ (registrar el intento como evento `ANOMALIA` sigue pendiente)
- ❌ Trazabilidad `user_id` en cada registro de facturación (quién lo creó dentro del tenant).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. ✅ ~~**Blindar el vector de test de la huella** contra la fuente oficial AEAT~~ — HECHO: el RegistroAlta reproduce exactamente el digest del ejemplo oficial AEAT (`89890001K / 12345678/G33` → `3C464DAF…F38F12F60`), blindado en `src/__tests__/huella.test.js` ("vector oficial AEAT" + "vector de encadenamiento"). Pendiente sólo el vector oficial de anulación/evento (el doc AEAT no los publica).
2. ✅ ~~**Firma XAdES**~~ — HECHO (base): firma *enveloped* RSA-SHA256 verificable con KeyInfo X509 (`lib/xades.js`, xml-crypto), a partir del PKCS#12 descifrado. Pendiente sólo el perfil **XAdES-EPES** (política de firma AEAT) encima. Nota: en Veri\*Factu la firma del registro es opcional (el `Signature` del XSD es opcional); obligatoria en NO-Veri\*Factu.
3. ✅ ~~**Cola de remisión + worker + actualización de estado**~~ — HECHO: `remision_queue` (estado mutable, back-off, DLQ) + `services/remision.service.js` (reclamar→mTLS→parsear `RespuestaLinea`→estado+CSV+lote) + jobs `verifactu-remision-retry`/`verifactu-dlq-alert` del scheduler + subscriber `remision-events.handler`. Endpoints `POST /remitir`, `/registros/:numSerie/remitir`, `GET /cola`, `POST /remision/dry-run`, `POST /dlq/:id/reintentar`, `GET /lotes/:codigo`.
4. ✅ ~~**Autenticación JWT en endpoints**~~ — HECHO: scope desde el JWT (`appGuard`), impersonación staff por query, `requireRole('super_admin','staff')` en todas las mutaciones.
5. ✅ ~~**Namespaces SOAP oficiales**~~ — HECHO: `sf`/`sfLR` reales tomados de los XSD oficiales en `soap-envelope.js` (RegistroAlta completo con Encadenamiento, SistemaInformatico y Desglose).
6. 🔧 **Validación XSD oficial en runtime** — los XSD oficiales ya se versionan en `platform/verifactu/schemas/aeat/`; resta enchufar un validador (libxmljs/equivalente) en `lib/validacion.js`.
7. ✅ ~~**Carga de certificados PKCS#12** cifrados~~ — HECHO (cifrado AES-256-GCM + metadatos reales). Pendiente: alerta de caducidad vía `platform/scheduler`.
8. ✅ ~~**Integración con `orders` (y `pos`)** vía eventos~~ — HECHO para `order.completed` y `donation.created` (con dedupe). POS cubierto transitivamente por la cadena `pos.bill.*`→`tpv`→`tpv.receipt.issued`.
9. **Recálculo completo de la cadena** (`full re-hash`, TODO A1) — requiere persistir `FechaHoraHusoGenRegistro` exacto en cada registro; completar la auditoría de inalterabilidad.
10. **Exportación legal** + evento `EXPORTACION` automático — obligación normativa; bajo coste una vez que el modelo de datos es estable.
11. **Series de facturación** como entidad — necesario para ejercicios multi-serie (ventas / rectificativas / exportación).
12. **Modo contingencia** con marcado y remisión diferida — importante para entornos con conectividad intermitente.
