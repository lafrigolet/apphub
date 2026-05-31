# TODO · Implementación VERI·FACTU (SIF)

Tracker **exhaustivo** para llevar `platform/verifactu` + el portal desde el
*skeleton realista* actual hasta la conformidad completa con el marco VERI·FACTU
de la AEAT (RD 1007/2023, RD 254/2025, Orden HAC/1177/2024).

> Incluye **todas** las tareas aunque no se implementen ahora. La fuente de
> arquitectura es [`verifactu-microservicios-nodejs.md`](./verifactu-microservicios-nodejs.md);
> los documentos oficiales están indexados en
> [`verifactu-documentacion-tecnica.md`](./verifactu-documentacion-tecnica.md).

## Leyenda

- `[x]` hecho en el skeleton actual
- `[~]` parcial / stub (existe pero no conforme)
- `[ ]` pendiente

> ⚠️ **Verificar contra fuente oficial**: todo lo marcado *(verificar)* —orden de
> campos de la huella, perfil XAdES, WSDL/XSD, parámetros del QR, catálogo de
> eventos y de errores, plazos— debe contrastarse con la documentación vigente de
> la Sede Electrónica de la AEAT antes de dar por buena la implementación. Cualquier
> desviación en la huella, el orden de campos o el formato rompe la verificación y
> provoca el rechazo de los registros.

### Estado global

| Bloque | Estado |
|---|---|
| Skeleton (modelo + RLS + endpoints + portal-reads + seed) | ✅ |
| Huella / QR / firma / SOAP / validación XSD (conformidad) | ⬜ |

---

## A. Núcleo de registros y cadena de huella

Ficheros: `platform/verifactu/src/lib/huella.js`, `src/services/verifactu.service.js`,
`src/repositories/verifactu.repository.js`, `migrations/0001_init.sql`.

- [~] **A1** Modelo de registro completo conforme a los diseños de registro/XSD:
  `IDVersion`, `IDFactura`, `NombreRazonEmisor`, `TipoFactura`, `TipoRectificativa`,
  importes (`CuotaTotal`, `ImporteTotal`), `Desglose`→`DetalleDesglose`
  (`TipoImpositivo`, `BaseImponible`, `CuotaRepercutida`…), `Encadenamiento`,
  `SistemaInformatico`, `FechaHoraHusoGenRegistro`, `TipoHuella`, `Huella`,
  `Signature`. Hoy el modelo está simplificado.
- [x] **A2** Huella **RegistroAlta** — orden oficial *(verificar)* en
  `lib/huella.js:cadenaAlta`; pares `clave=valor` unidos por `&`. Cableada en
  `service.crearRegistro` usando el NIF del obligado (A10). Tests: `__tests__/huella.test.js`.
- [x] **A3** Huella **RegistroAnulacion** (`cadenaAnulacion`/`huellaAnulacion`) *(verificar)*.
- [x] **A4** Huella **RegistroEvento** (`cadenaEvento`/`huellaEvento`) *(verificar —
  claves del evento especialmente inciertas)*.
- [x] **A5** Reglas de formato: trim de valores, campo vacío como `clave=`, UTF-8,
  SHA-256, salida **hex MAYÚSCULAS**, `TIPO_HUELLA='01'`, timestamp ISO-8601 con huso.
- [~] **A6** Encadenamiento: `PrimerRegistro` (huella anterior vacía) vs
  `RegistroAnterior` ✅; **falta** lock optimista por `(emisor, serie)` e idempotencia
  por `(NIF emisor + serie + número + tipo)`.
- [ ] **A7** Series y numeración por emisor.
- [ ] **A8** Soporte de modalidad `VERIFACTU` vs `NO_VERIFACTU` (firma obligatoria
  en la segunda; remisión en la primera).
- [ ] **A9** Inmutabilidad / append-only; las correcciones se modelan con
  anulación/sustitución, nunca con UPDATE/DELETE del registro.
- [x] **A10** NIF y nombre del **obligado emisor** en `config`
  (`nif_obligado`/`nombre_obligado`, migración `0003_obligado_huella.sql`); usado como
  `IDEmisorFactura` en la huella. Pendiente reutilizarlo en el QR (B1) y en la cabecera
  SOAP (D1).

## B. QR y servicio de cotejo

Ficheros nuevos: `src/lib/qr.js`, `src/lib/cotejo.js`. Portal:
`apps/verifactu/verifactu-portal/src/views/{emisor,receptor}/`.

- [ ] **B1** Builder de la **URL de cotejo** *(verificar)*: base test
  `https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR`, prod
  `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR`; parámetros en
  orden `nif, numserie, fecha, importe`; fecha `DD-MM-AAAA`; importe con punto
  decimal; URL-encoding estándar.
- [ ] **B2** Generación del **QR** (dep `qrcode`): nivel de corrección de errores
  **M** *(verificar tamaño/módulos/versión)*.
- [ ] **B3** Persistir `qr_url` por registro al crearlo + leyenda "VERI·FACTU".
- [ ] **B4** Endpoint `GET /v1/verifactu/registros/:id/qr` → `{ url, dataUri }`.
- [ ] **B5** Portal Emisor (sección QR): reemplazar el SVG y la URL hardcoded por el
  QR y la URL reales del registro seleccionado.
- [ ] **B6** Receptor: parseo de la URL de cotejo pegada (extraer `nif/numserie/
  fecha/importe`) en vez de valores fijos.
- [~] **B7** `cotejar`: hoy devuelve siempre `verificada` con emisor hardcoded.
  Pasar a verificación real contra la cadena local: `verificada` si existe el
  registro `(nif, numserie)` y la huella concuerda, `no_consta` si no. Devolver
  emisor/importe reales de la fila. *(El cotejo real consulta la Sede AEAT — ver B8.)*
- [ ] **B8** Cotejo real contra la Sede Electrónica de la AEAT (servicio externo) —
  futuro.

## C. Firma electrónica XAdES (modalidad NO_VERIFACTU)

Fichero nuevo: `src/lib/firma.js` (inerte sin certificado configurado).

- [ ] **C1** Carga de PKCS#12 (`.p12`/`.pfx`) desde vault/HSM (`node-forge` / `pem`);
  **nunca** en el repositorio ni en variables de entorno en claro en producción.
- [ ] **C2** Firmante **XAdES Enveloped**, perfil **XAdES-EPES** *(verificar)*,
  digest/firma SHA-256, canonicalización c14n (`xadesjs` + `@peculiar/xmldsigjs`).
- [ ] **C3** Política de firma (policy identifier) — *(verificar contra la spec
  oficial de firma)*.
- [ ] **C4** Firma de `RegistroAlta`/`RegistroAnulacion` y de `RegistroEvento`.
- [ ] **C5** Verificación de firma (validación de la cadena del certificado).
- [ ] **C6** Custodia y rotación del certificado en vault/HSM.

## D. Remisión SOAP a la AEAT (modalidad VERIFACTU)

Ficheros nuevos: `src/lib/remision.js`, `src/lib/soap-envelope.js` (inerte sin cert).

- [ ] **D1** Envelope SOAP: `Cabecera` (`ObligadoEmision` NIF/Nombre + `Representante`
  opcional) + lista `RegistroFactura` (máx **1000** registros por remisión)
  *(verificar límite)*.
- [ ] **D2** Cliente HTTPS con **mTLS** (`https.Agent` con `pfx` + passphrase) o `soap`.
- [ ] **D3** Endpoints configurables test/prod *(verificar)*: Verifactu
  `…/ws/SistemaFacturacion/VerifactuSOAP` (prewww1/www1, variantes de sello
  prewww10/www10); Requerimiento `…/RequerimientoSOAP`.
- [ ] **D4** Operaciones `RegFactuSistemaFacturacion` (alta/anulación) y
  `ConsultaFactuSistemaFacturacion`.
- [ ] **D5** Parseo de respuesta: `EstadoEnvio`, `EstadoRegistro` por línea, `CSV`,
  `TiempoEsperaEnvio`, `MinimoRegistrosEnvio`/`MinutosEsperaEnvio`.
- [ ] **D6** Control de flujo dinámico: respetar `TiempoEsperaEnvio` devuelto;
  rate-limit; agrupación en lotes acotada al máximo.
- [ ] **D7** Idempotencia: no reenviar registros ya aceptados (clave = huella);
  evitar el error 3000 (duplicado) al reintentar `AceptadoConErrores`.
- [ ] **D8** Cola + reintentos con backoff + dead-letter (Redis / `platform-scheduler`).
- [ ] **D9** Persistir estado por registro + CSV; alimentar `lotes` y el estado de
  cola reales.

## E. Validación XSD / generación de XML

Fichero: `src/services/verifactu.service.js` (`validar`, hoy stub) + `src/lib/`.

- [ ] **E1** Descargar y versionar los **XSD oficiales** (descarga manual — la página
  del portal de desarrolladores no permite acceso automatizado).
- [ ] **E2** Validación del XML contra el XSD (`libxmljs2`); fallar el build de CI si
  no valida.
- [ ] **E3** Validación de negocio: campos obligatorios, coherencia de importes
  (base/cuota), enumeraciones (`TipoFactura` F1/F2/R1…, `TipoRectificativa`).
- [ ] **E4** Catálogo de errores **admisibles** vs **no admisibles** (documento de
  validaciones y errores — *no extraído aún de la fuente oficial*).
- [ ] **E5** Generación de XML conforme al XSD desde el modelo interno (`xmlbuilder2`).
- [~] **E6** Interino: `validar` hace comprobación de buena-formación + presencia de
  campos obligatorios + recálculo de huella/encadenamiento, **claramente marcado como
  NO validación XSD oficial**.

## F. Eventos del SIF

Tabla `eventos`; fichero nuevo `src/lib/eventos.js`.

- [ ] **F1** Catálogo de eventos obligatorios *(verificar contra Orden HAC/1177/2024)*:
  arranque, restauración, detección de anomalías, exportación, etc.
- [ ] **F2** Generación de `RegistroEvento` con huella encadenada y firma (en
  NO_VERIFACTU).
- [ ] **F3** Hooks que generan eventos automáticamente (arranque del SIF, exportación,
  detección de discontinuidad/anomalía, restauración de copia).

## G. Conservación / inalterabilidad

- [ ] **G1** Almacenamiento append-only / WORM de los registros.
- [ ] **G2** Verificación periódica de la integridad de la cadena de huellas (job en
  `platform-scheduler`).
- [ ] **G3** Exportación a requerimiento de la AEAT (formato + firma).
- [ ] **G4** Retención durante el plazo legal *(verificar plazo)*.
- [ ] **G5** Generación de un evento de **anomalía** ante manipulación detectada.

## H. Certificados

Tabla `certificados` (hoy solo metadatos en seed).

- [ ] **H1** Subida/gestión de certificados PKCS#12 en vault (las claves privadas
  **no** en la BD).
- [ ] **H2** Tracking de caducidad + avisos vía `platform/notifications`.
- [ ] **H3** Certificado de pruebas (preportal) vs producción.
- [ ] **H4** Representación de terceros / apoderamiento *(Resolución 18-dic-2024)*.

## I. Control de flujo / configuración (admin)

Tabla `config`.

- [x] **I1** CRUD de parámetros (`TiempoEsperaEnvio`, máx registros/lote, reintentos,
  DLQ) con RLS — GET/PATCH implementados.
- [ ] **I2** Ajuste dinámico de los parámetros con la respuesta de la AEAT.
- [ ] **I3** Estado de cola real (pendientes/en proceso/DLQ) — hoy hardcoded en el
  portal.

## J. Auth / multi-tenant (cuando exista login)

- [ ] **J1** Migrar los endpoints públicos a `req.identity` (JWT) y añadir endpoints
  admin role-gated para las mutaciones sensibles.
- [ ] **J2** Roles emisor/asesoría/administrador/desarrollador/receptor (REUSE
  `platform/auth`).
- [ ] **J3** `adminUsuarios` real desde `platform/auth` (hoy mock en `data/mock.js`).
- [ ] **J4** Apoderamiento multi-NIF (la asesoría opera en nombre de cada cliente).

## K. Portal (frontend)

Ficheros: `apps/verifactu/verifactu-portal/src/views/*`.

- [x] **K1** Lecturas cableadas a la API (facturas, cadena, eventos, clientes, lotes,
  representación, certificados, config, cotejos).
- [~] **K2** Escrituras: toggle DLQ → `PATCH /config`; cotejar → `POST /cotejo`;
  validar → `POST /validar`.
- [ ] **K3** QR dinámico (sustituir el SVG y la URL hardcoded del Emisor).
- [ ] **K4** "Nueva factura": modal/formulario real → `POST /registros`.
- [ ] **K5** "Añadir cliente": formulario real → `POST /clientes`.
- [ ] **K6** Validador: input XML real (textarea) → `POST /validar`.
- [ ] **K7** Receptor: inputs de URL/datos reales → cotejo.
- [ ] **K8** Estados de carga/vacío/error coherentes en todas las vistas.
- [ ] **K9** Login/activación cuando exista auth.

## L. Observabilidad / requisitos no funcionales

- [ ] **L1** `correlationId` de extremo a extremo en logs y eventos.
- [ ] **L2** Métricas de cola y de respuestas de la AEAT.
- [ ] **L3** Trazas distribuidas (OpenTelemetry) — opcional.
- [ ] **L4** Seguridad: secretos en vault, principio de mínimo privilegio, auditoría
  de accesos.

## M. Tests — cobertura mínima **95 %** (objetivo 100 %)

Ficheros: `platform/verifactu/src/__tests__/`, `platform/verifactu/vitest.config.js`,
`platform/verifactu/vitest.integration.config.js`. Patrón de referencia ya existente:
`platform/inquiries` y `platform/leads` (+ `scripts/integration-or-skip.mjs`).

- [~] **M1** Config de cobertura `vitest.config.js` con **thresholds ≥95 %** (hoy 100 %
  sobre `src/lib/huella.js`); el `include` se amplía conforme entran M7/M8. Falta gate
  en CI.
- [~] **M2** Unit **huella** (`__tests__/huella.test.js`, 100 % cobertura): composición
  de cadena (orden/separador), reglas de formato (trim, campo vacío, mayúsculas),
  alta/anulación/evento, primer registro vs encadenado, cambio de huella al cambiar un
  campo. **Falta** el vector oficial AEAT (digest esperado) → `it.todo`.
- [ ] **M3** Unit **QR / URL de cotejo**: orden de parámetros, formatos de fecha/
  importe, URL-encoding, base test/prod, nivel de corrección del QR.
- [ ] **M4** Unit **firma XAdES** con fixture de certificado de test.
- [ ] **M5** Unit **envelope SOAP** + parseo de respuesta (fixtures XML
  Correcto/AceptadoConErrores/Incorrecto).
- [ ] **M6** Unit **validación** (fixtures XSD válido/inválido + reglas de negocio).
- [ ] **M7** Unit **repositorios**: scoping/RLS, `COALESCE` de config, orden de
  resultados.
- [ ] **M8** Unit **services**: `crearRegistro` encadena la huella; `cotejar`
  verificada/no_consta; `validar`; `patchConfig`.
- [ ] **M9** Integration: migraciones + seed; cada endpoint GET/POST/PATCH; **
  aislamiento cross-tenant** (un tenant no ve datos de otro).
- [ ] **M10** Integration: flujo emisión → huella → QR → (remisión mock con fixture de
  respuesta de la AEAT).
- [ ] **M11** E2E **opt-in** contra `preportal.aeat.es` (requiere certificado; skip
  automático en CI sin cert, estilo `integration-or-skip`).
- [ ] **M12** Tests de portal (Vitest + Testing Library): cada vista renderiza, maneja
  loading/empty/error y dispara los POST/PATCH correctos (con `fetch` mockeado).
- [ ] **M13** Reporte de cobertura combinado (unit + integration) ≥95 %; documentar y
  justificar cualquier hueco no cubierto.

## N. Infraestructura / despliegue / dependencias

- [ ] **N1** Dependencias nuevas en `platform/verifactu/package.json` + COPY del
  módulo en `platform/core/Dockerfile`: `qrcode`, `node-forge`, `xadesjs`,
  `@peculiar/xmldsigjs`, `xmlbuilder2`, `fast-xml-parser` (ya en el lock), `libxmljs2`.
- [ ] **N2** Variables de entorno / secretos: `CERT_PATH`/`CERT_PASS` por tenant
  (vault), endpoints AEAT (test/prod), entorno activo. Añadir a `.env.example`.
- [ ] **N3** Jobs en `platform-scheduler`: verificación periódica de la cadena,
  reintentos de remisión, avisos de caducidad de certificado.
- [ ] **N4** Documentación: actualizar el estado en el registry de `CLAUDE.md`,
  `ARCHITECTURE.md` y `CHANGELOG.md` a medida que se implementa (cambiar 🔧 Skeleton
  → ✅ Implemented cuando proceda).

## O. Cumplimiento / legal

- [ ] **O1** Declaración responsable *(contenido exacto a verificar contra la Orden
  HAC/1177/2024 y los ejemplos oficiales v0.5.1)* — generación/registro.
- [ ] **O2** Conservación de evidencias de las pruebas en preportal (peticiones,
  respuestas, CSV).
- [ ] **O3** Versionado de los esquemas/contratos usados por cada registro emitido.

---

## Fuentes y avisos de vigencia

- Índice de documentos oficiales: [`verifactu-documentacion-tecnica.md`](./verifactu-documentacion-tecnica.md)
  (recopilado 31/05/2026).
- Guía de arquitectura interna: [`verifactu-microservicios-nodejs.md`](./verifactu-microservicios-nodejs.md).
- Normativa: RD 1007/2023 (RRSIF), RD 254/2025, Orden HAC/1177/2024, Resolución
  18-dic-2024 (representación), Ley 11/2021.
- **Nota de confianza (huella)**: el orden exacto de campos de la huella se
  reconstruyó a partir de la página de la AEAT, el ejemplo oficial publicado y
  resúmenes de terceros (el PDF binario oficial no se extrajo limpio). Debe
  confirmarse contra el documento "Algoritmo de cálculo de codificación de la huella
  o hash" antes de producción, y blindarse con su **vector de test oficial** (tarea M2).
- El orden de campos de la huella, los XSD y el WSDL se revisan periódicamente:
  confirmar número de versión y fecha en la cabecera de cada documento antes de
  implementar.
