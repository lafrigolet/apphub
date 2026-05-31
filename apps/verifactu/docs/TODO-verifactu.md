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

- [x] **B1** Builder de la **URL de cotejo** (`lib/cotejo.js:buildCotejoUrl`)
  *(verificar)*: base test/prod, orden `nif, numserie, fecha, importe`, URL-encoding.
  `nif` = obligado (de config). + `parseCotejoUrl`.
- [x] **B2** Generación del **QR** (`lib/qr.js`, dep `qrcode`, EC level M, data URI PNG)
  *(verificar tamaño/módulos)*.
- [x] **B3** Persistir `qr_url` por registro al crearlo (`crearRegistro`).
- [x] **B4** Endpoint `GET /v1/verifactu/qr?…&numSerie=` → `{ numSerie, url, dataUri }`
  (recalcula la URL/QR; `numSerie` omitido → último registro).
- [x] **B5** Portal Emisor (sección QR): QR (`<img>`) y URL reales del registro.
- [x] **B6** Receptor: input de URL controlado + `parseCotejoUrl` en el backend.
- [x] **B7** `cotejar` real contra la cadena local: `verificada` (emisor/importe
  reales) si consta `(numserie)`, `no_consta` si no. *(El cotejo contra la Sede AEAT
  es B8.)*
- [ ] **B8** Cotejo real contra la Sede Electrónica de la AEAT (servicio externo) —
  futuro.

## C. Firma electrónica XAdES (modalidad NO_VERIFACTU)

Ficheros: `src/lib/cert.js`, `src/lib/firma.js` (SCAFFOLD · inerte sin cert real).

- [~] **C1** Carga de PKCS#12 (`cert.js:cargarP12`, `node-forge`) + generador
  autofirmado de dev (`generarP12Autofirmado`). **Falta** custodia en vault/HSM (C6).
- [~] **C2** Firmante **XMLDSIG enveloped** RSA-SHA256 + **exclusive c14n**
  (`firma.js:firmarXml`, `xml-crypto`) — base de XAdES. **Faltan** las propiedades
  cualificadas **XAdES-EPES** (SignedProperties: SigningTime, cert digest, policy)
  *(verificar perfil oficial)*.
- [ ] **C3** Política de firma (policy identifier) — *(verificar spec oficial)*.
- [~] **C4** `firmarXml` firma cualquier XML; **falta** integrarlo con el modelo de
  RegistroAlta/Anulacion/Evento (depende de A1) y de eventos (F2).
- [x] **C5** Verificación de firma (`firma.js:verificarXml`) — detecta manipulación.
- [ ] **C6** Custodia y rotación del certificado en vault/HSM.

## D. Remisión SOAP a la AEAT (modalidad VERIFACTU)

Ficheros: `src/lib/soap-envelope.js`, `src/lib/remision.js` (SCAFFOLD · gated sin cert).

- [~] **D1** Envelope SOAP (`soap-envelope.js:construirEnvelope`): `Cabecera`
  (`ObligadoEmision` + `Representante` opcional) + lista `RegistroFactura`, guarda de
  máx **1000**. Estructura/namespaces **ilustrativos** *(verificar WSDL/XSD)*.
- [~] **D2** Cliente HTTPS con **mTLS** (`remision.js`, `https.Agent` + pfx), **gated**:
  sin cert lanza error claro. **Falta** envío real verificado contra preportal (M11).
- [x] **D3** Endpoints test/prod + variantes de sello configurables
  (`ENDPOINTS`/`resolverEndpoint`) *(verificar URLs)*.
- [~] **D4** `RegFactuSistemaFacturacion` (alta/anulación) en el envelope; **falta**
  `ConsultaFactuSistemaFacturacion`.
- [~] **D5** Parseo de respuesta (`parseRespuesta`): `EstadoEnvio`, `EstadoRegistro`
  por línea, `CSV`, `TiempoEsperaEnvio`. **Falta** `MinimoRegistrosEnvio`/`MinutosEsperaEnvio`.
- [ ] **D6** Control de flujo dinámico (respetar `TiempoEsperaEnvio`; rate-limit; batching).
- [ ] **D7** Idempotencia (clave = huella; evitar error 3000 duplicado).
- [ ] **D8** Cola + reintentos backoff + DLQ (Redis / `platform-scheduler`).
- [ ] **D9** Persistir estado por registro + CSV; alimentar `lotes`/estado de cola.

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
- [~] **M3** Unit **QR / URL de cotejo** (`__tests__/cotejo.test.js` + `qr.test.js`,
  100 % cobertura): orden de parámetros, formatos, URL-encoding, base test/prod,
  roundtrip parse, QR data URI/EC level. **Falta** cubrir la lógica de `cotejar`
  (verificada/no_consta) — irá por integración (M9).
- [x] **M4** Unit **firma/cert** (`cert.test.js` + `firma.test.js`, cert autofirmado
  de test): carga p12, firma enveloped, verifica, detecta manipulación. (XMLDSIG;
  propiedades XAdES-EPES pendientes con C2/C3.)
- [x] **M5** Unit **envelope SOAP** + parseo (`soap-envelope.test.js`: cabecera,
  representante, guard 1000, Correcto/ParcialmenteCorrecto/sin-líneas; `remision.test.js`:
  gate sin cert + transport inyectado).
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

- [~] **N1** Deps añadidas a `platform/verifactu/package.json`: `qrcode`,
  `node-forge`, `xml-crypto`, `xmlbuilder2`, `fast-xml-parser`. El `Dockerfile` de
  platform-core copia el módulo entero (sin cambio); las deps entran por el lockfile
  al reconstruir. **Falta** `libxmljs2` (validación XSD, E2). (Se descartó `xadesjs` a
  favor de `xml-crypto` para el scaffold.)
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
