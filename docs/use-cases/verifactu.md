# Casos de uso — `platform/verifactu` (platform-marketplace → platform-core)

> Dominio: SIF (Sistema Informático de Facturación) / facturación verificable AEAT — Veri\*Factu, RD 1007/2023, Orden HAC/1177/2024. Módulo platform reutilizable por cualquier app que deba cumplir la obligación de facturación verificable: genera y encadena registros de alta/anulación, eventos del SIF, lotes de remisión, QR de cotejo, y gestiona la cartera de clientes en caso de uso asesoría/representante.

## Estado actual (implementado)

Modelo de datos completo persistido en `platform_verifactu` (RLS por `app_id` + `tenant_id`): tablas `registros`, `eventos`, `lotes`, `clientes`, `certificados`, `config`, `cotejos`. Algoritmo de huella SHA-256 encadenada para registros de alta, anulación y eventos del SIF (lib/huella.js). Verificación del enlace de la cadena (lib/cadena.js). Generación de URL de cotejo + QR data-URI (lib/cotejo.js + lib/qr.js). Validación estructural pre-remisión (lib/validacion.js). Scaffold del envelope SOAP + cliente mTLS gateado por certificado (lib/soap-envelope.js + lib/remision.js). Endpoints públicos para emisor, asesoría, administrador y receptor (`GET/POST /v1/verifactu/*`). Modalidad única Veri\*Factu (NO\_VERI\*FACTU descartada en migración 0006). NIF del obligado emisor en `config` (migración 0003). Huella encadenada en eventos (migración 0005). Identidad del SIF en lib/sif.js (productor, versión, nº instalación).

**Piezas stubbed / pendientes de specs AEAT:** orden exacto de campos de la huella (vector de test oficial no verificado), firma XAdES (no implementada), WSDL/XSD oficiales del SOAP (namespaces ilustrativos), colas de remisión/reintentos/DLQ, cotejo externo contra la Sede AEAT, nivel de corrección de errores del QR, catálogo de tipos de evento (Orden HAC/1177/2024 no extraída de fuente oficial).

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Registro de alta de factura

- ✅ `POST /v1/verifactu/registros` — crea un registro de alta con número de secuencia correlativo, `num_serie`, `tipo_factura` (F1/…), cliente, fecha, importe y cuota.
- ✅ Cálculo de la huella SHA-256 encadenada (`cadenaAlta` → `sha256Upper`) con los campos en el orden reconstruido del algoritmo AEAT.
- ✅ Referencia a la huella anterior (`huellaAnterior = NULL` en el primer registro → primer eslabón de la cadena).
- ✅ Persistencia de `huella` + `huella_anterior` + `qr_url` en `registros`.
- ✅ `IDEmisorFactura` = NIF del obligado (de `config.nif_obligado`), no el NIF del cliente receptor.
- 🔧 Orden de campos de la huella reconstruido de documentación pública — **pendiente de blindar con el vector de test oficial de la AEAT** antes de producción.
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
- 🔧 Sin endpoint dedicado para anulación — el `POST /registros` acepta `tipo` en el body pero carece de validación de que el `num_serie` referenciado exista.
- ❌ Reglas de negocio: impedir anular una factura ya anulada; requerir referencia al registro de alta original; devolver error si el registro no consta en la cadena del tenant.
- ❌ Flujo de anulación parcial o sustitución (rectificativa R1–R5).

## 3. Cadena de huellas encadenadas (hash chain)

- ✅ Cada registro enlaza con la huella del registro inmediatamente anterior (`huella_anterior`).
- ✅ El primer registro de la cadena declara `huella_anterior = NULL` (eslabón inicial).
- ✅ `GET /v1/verifactu/cadena` — devuelve los últimos registros con su `huella` y `anterior` para visualización del portal.
- ✅ `GET /v1/verifactu/cadena/verificar` — recorre hasta 1 000 registros y valida que cada `huella_anterior` apunta exactamente a la huella del registro previo (`verificarEnlace`); detecta roturas.
- ✅ Cadena de eventos del SIF también encadenada desde migración 0005 (`huella`+`huella_anterior` en `eventos`).
- 🔧 `verificarEnlace` comprueba el encadenamiento declarado pero **no recalcula la huella** de cada registro (exige `FechaHoraHusoGenRegistro` persistido + modelo de campos completo — TODO A1).
- ❌ Recálculo completo de la cadena (full re-hash) para auditoría de inalterabilidad.
- ❌ Detección de registros interpolados / insertados retroactivamente.
- ❌ Exportación de la cadena completa en formato AEAT para peritaje.

## 4. Firma electrónica XAdES

- ❌ Firma XAdES-T / XAdES-BES del registro antes de incluirlo en el envelope SOAP — **completamente no implementada**.
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
- ❌ Remisión real integrada al flujo de alta — `crearRegistro` nunca llama a `remitir`; `estado_remision` queda siempre en `pendiente`.
- ❌ Cola de remisión asíncrona (batch de hasta 1 000 registros con `TiempoEsperaEnvio`).
- ❌ Reintentos con back-off exponencial y DLQ (tabla config tiene `reintentos`/`dlq_enabled` pero no se usan).
- ❌ Actualización de `estado_remision` (`ok`/`warn`/`err`) a partir de la respuesta de la AEAT.
- ❌ Almacenamiento del CSV (código seguro de verificación) devuelto por la AEAT por registro.
- ❌ Procesado de las `RespuestaLinea` individuales (errores por registro, reintento selectivo).
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

- ✅ Tabla `config` con clave primaria `(app_id, tenant_id)`: `tiempo_espera_envio`, `max_registros_lote`, `reintentos`, `dlq_enabled`, `nif_obligado`, `nombre_obligado`.
- ✅ `GET /v1/verifactu/config` — lee la config del tenant (con defaults si no existe fila).
- ✅ `PATCH /v1/verifactu/config` — upsert de cualquier subconjunto de campos.
- ✅ `nif_obligado` / `nombre_obligado` alimentan la cabecera SOAP y la URL de cotejo.
- 🔧 `max_registros_lote = 1000` — **verificar el límite oficial** en el WSDL/normativa AEAT.
- 🔧 `tiempo_espera_envio` persistido pero no respetado por ningún worker todavía.
- ❌ Configuración del entorno (`test` / `prod`) para la remisión por tenant.
- ❌ Configuración de alertas: umbral de registros pendientes, SLA de remisión, notificación de lote rechazado.
- ❌ Historial de cambios de config (audit log).
- ❌ Configuración del productor del SIF (sustituir `SIF_IDENTITY` hard-coded por valores por tenant).

## 12. Gestión de certificados digitales

- ✅ Tabla `certificados` con metadatos: `nombre`, `meta` (texto libre: "PKCS#12 · caduca 14-09-2027"), `estado` ("Vigente"), `tone`, `icon_tone`.
- ✅ `GET /v1/verifactu/certificados` — lista los certificados del tenant.
- 🔧 Solo lectura — sin endpoints de carga, renovación ni revocación.
- ❌ Carga del fichero PKCS#12 cifrado (clave privada nunca en BD clara — almacenar en vault/HSM o cifrada con `PLATFORM_CONFIG_ENCRYPTION_KEY`).
- ❌ Extracción y persistencia de metadatos reales del certificado: CN, emisor, fecha de expiración, número de serie, uso de clave.
- ❌ Alerta de caducidad (REUSE `platform/scheduler` → `verifactu.cert.expiring_soon`).
- ❌ Renovación de certificado: subir el nuevo PKCS#12 sin interrupción del servicio.
- ❌ Revocación/baja de certificado con rotación inmediata.
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

- 🔧 `num_serie` soporta formato libre (`2027-A/000128`) pero sin gestión de series como entidad.
- 🔧 `numero` es secuencia simple global por tenant — no por serie.
- ❌ Tabla `series` con `prefijo`, `ejercicio`, `siguiente_numero`, activa/inactiva.
- ❌ Validación de que el `num_serie` de un nuevo registro pertenece a una serie activa y su número es el correlativo esperado.
- ❌ Cierre de serie al final del ejercicio fiscal con bloqueo de nuevas inserciones.
- ❌ Múltiples series simultáneas (ventas, rectificativas, exportación, intracomunitarias).
- ❌ Numeración correlativa con gaps: detección de huecos en la numeración e inscripción en el evento de anomalía.

## 15. Integración con módulos `orders`, `donations` y `pos`

- ❌ Integración con `platform/orders`: al cerrar un pedido (`order.completed`) generar automáticamente el registro Veri\*Factu de alta con los datos del pedido (cliente, importe, IVA, fecha).
- ❌ Integración con `platform/donations`: al registrar una donación generar el registro Veri\*Factu correspondiente (facturas de donativo con Ley 49/2002 para certificados fiscales AEAT 182).
- ❌ Integración con `platform/pos`: al cerrar un `bill` del POS generar el registro Veri\*Factu (tique/factura simplificada).
- ❌ Referencia cruzada `registro_id ↔ order_id` / `registro_id ↔ donation_id` / `registro_id ↔ bill_id` para trazabilidad.
- ❌ Suscripción a eventos Redis (`platform.events`) de `order.completed`, `donation.created`, `pos.bill.closed` en lugar de integración HTTP directa.
- ❌ Deduplicación: impedir doble emisión si el evento llega dos veces (idempotency key por `order_id`).

## 16. Exportación legal y backup del SIF

- ❌ `GET /v1/verifactu/exportar` — descarga de todos los registros, eventos y metadatos del tenant en formato definido por la AEAT para entrega a la Administración.
- ❌ Firma del fichero de exportación con el certificado del obligado.
- ❌ Registro automático del evento `EXPORTACION` en la cadena de eventos al exportar.
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

- 🔧 Todos los endpoints actuales son `public: true` — **el scope `(appId, tenantId)` viaja en query/body sin autenticación JWT**. Aceptable durante el desarrollo del portal pero **bloqueante para producción**.
- 🔧 RLS en BD sí aísla los datos por `(app_id, tenant_id)` correctamente via `withTenantTransaction`.
- ❌ Migración de endpoints a autenticación con `appGuard` + `requireRole` cuando el portal implemente login.
- ❌ Endpoints de escritura (`POST /registros`, `POST /eventos`, `PATCH /config`) gateados por `staff` o `super_admin`.
- ❌ Audit log de accesos/mutaciones (quién creó cada registro, quién exportó, quién cambió config).
- ❌ Inalterabilidad reforzada: impedir `UPDATE`/`DELETE` directo en `registros` mediante reglas PG o trigger que registre el intento como evento `ANOMALIA`.
- ❌ Trazabilidad `user_id` en cada registro de facturación (quién lo creó dentro del tenant).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Blindar el vector de test de la huella** contra la fuente oficial AEAT — sin esto el módulo no puede ir a producción; es el riesgo mayor con coste acotado (un test con el vector publicado por la AEAT).
2. **Firma XAdES** — requisito legal para Veri\*Factu; desbloquea toda la cadena de remisión. Usar `xmldsig-core` o librería equivalente; la clave privada del PKCS#12 ya se lee en `lib/remision.js`.
3. **Cola de remisión + worker + actualización de `estado_remision`** — conectar `crearRegistro` al flujo real: insertar en cola → job del scheduler → `remitir` → actualizar estado. Config `reintentos`/`dlq_enabled` ya está.
4. **Autenticación JWT en endpoints de escritura** (`appGuard` + `requireRole`) — bloqueo de seguridad antes del lanzamiento a producción.
5. **Namespaces SOAP desde el WSDL oficial** — completar TODO D1/D4/E1 descargando el WSDL real de la AEAT y actualizando `NS` en `soap-envelope.js`.
6. **Validación XSD oficial** (TODO E2) — imprescindible para evitar rechazos en remisión; requiere descargar `SuministroLR.xsd` + `SuministroInformacion.xsd`.
7. **Carga de certificados PKCS#12** con almacenamiento cifrado (`PLATFORM_CONFIG_ENCRYPTION_KEY`) + alerta de caducidad via `platform/scheduler`.
8. **Integración con `platform/orders` y `platform/pos`** vía eventos Redis — mayor impacto para las apps marketplace/restaurant que ya usan esos módulos.
9. **Recálculo completo de la cadena** (`full re-hash`, TODO A1) — requiere persistir `FechaHoraHusoGenRegistro` exacto en cada registro; completar la auditoría de inalterabilidad.
10. **Exportación legal** + evento `EXPORTACION` automático — obligación normativa; bajo coste una vez que el modelo de datos es estable.
11. **Series de facturación** como entidad — necesario para ejercicios multi-serie (ventas / rectificativas / exportación).
12. **Modo contingencia** con marcado y remisión diferida — importante para entornos con conectividad intermitente.
