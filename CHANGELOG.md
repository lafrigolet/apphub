# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

### Added
- **Cesta de la compra en la landing de `luciapassardi` (cesta real + checkout).**
  Reutiliza `platform/basket` (Redis), `platform/orders` y `payments`:
  - **Token de invitado en `platform/auth`** (capacidad nueva): `POST /v1/auth/guest`
    emite un JWT `role='guest'` (sin fila en BD, 30d) para que visitantes anónimos
    operen la cesta y creen pedidos sin login. `guestUserId` opcional reanuda una
    cesta previa.
  - **Frontend**: `CartProvider` + panel lateral con badge en el menú, alta/baja de
    cantidades sobre `platform/basket`, y botón "Añadir" en la tienda. El checkout
    crea un **pedido real** en `platform/orders` (aparece en el backoffice de Pedidos)
    e intenta iniciar el pago por Stripe; si el pago no está disponible, el pedido
    queda registrado y se confirma al cliente.
- **Secciones de backoffice de `luciapassardi` (gestión real, reutilizando plataforma).**
  - **Eventos / Calendario / Tienda / Pedidos**: CRUD real sobre
    `platform/services` (sesiones de eventos y clases con edición/borrado inline
    sobre el calendario semanal Lun–Dom), `platform/catalog` (productos) y
    `platform/orders` (pedidos: lista con filtro por estado, detalle con líneas/
    dirección/historial y transiciones que respetan la FSM del módulo). Datos
    inicializados en BD (`seed.sql` §6–8: eventos, 17 productos, 6 pedidos).
  - **Suscripción a Hulkstein**: nueva sección que **extiende `platform/tenant-config`**
    (la suscripción tenant↔plataforma ya vivía en `platform_tenants`). Switch
    activar/desactivar que reutiliza el flujo real de Stripe Checkout
    (`POST /v1/tenants/:id/subscribe`, mode=subscription) y un nuevo
    `POST /v1/tenants/:id/unsubscribe` (owner/admin del propio tenant). Campo
    nuevo `subscription_payment_method` (migración 0006) y plan sembrado de
    **100 €/mes, tarjeta** (`seed.sql` §9).

- **Sesión persistente con refresh token (toda la plataforma).** Antes el frontend
  descartaba el refresh token y la sesión moría al caducar el access token (15 min).
  Ahora `@apphub/tenant-console-ui` guarda y **rota** el refresh token, auto-renueva
  en cualquier 401 (con reintento) y expone `refreshSession()`/`ensureSession()`; los
  portales sobreviven a recargas y refrescan proactivamente. TTL del refresh subido a
  **90 días** (`PLATFORM_JWT_REFRESH_DAYS`, antes 30). luciapassardi guarda el refresh
  token y su `/admin` renueva al montar + cada 10 min.

### Fixed
- **nginx: `/api/tenants/` enrutaba a `/v1/` en vez de `/v1/tenants/`**, dejando
  inalcanzables los endpoints de detalle/suscripción del tenant (404). Alineado
  con la convención del resto de rutas de platform-core (`/api/apps/`→`/v1/apps/`,
  …).

- **Backoffice de `luciapassardi` (V1) — reutilizando módulos de plataforma.**
  Convierte la landing en una app con tenant + login + consola, sin reinventar:
  - **Módulo nuevo `platform/commerce`** ([ADR 019](docs/adr/019-platform-commerce-orchestration.md)):
    orquestación de comercio dirigida por eventos — `checkouts` + subscriber a
    `payment.succeeded` que emite `commerce.purchase.paid`; `platform/packages`
    crea el bono y `platform/bookings` confirma la reserva al consumirlo. Schema
    `platform_commerce`, registrado en platform-core, ruta `/api/commerce/`,
    init/role/compose. +7 tests.
  - **Aprovisionamiento + seed** (`apps/luciapassardi/seed.sql`): app+tenant+owner
    (`platform_tenants`/`platform_auth`) y dominio real reutilizando
    `platform/services` (clases), `platform/resources` (ubicaciones como salas),
    `platform/packages` (bonos 5/10) y `service_sessions` (horario semanal de las
    próximas 3 semanas + retiros/talleres).
  - **Portal admin**: login (`platform/auth`) en `/admin` + consola reutilizada
    `@apphub/tenant-console-ui` (servicios, recursos, reservas, bonos,
    notificaciones, usuarios/practicantes). Acceso desde el footer.
  - **Landing en vivo**: el hero (próximos eventos) y la sección Horario leen
    datos reales (`/api/services/sessions/upcoming`) con fallback estático;
    `/api` enrutado en el seed nginx. Helpers `reservarSesion`/`comprarBono`
    (commerce + payments) listos. **Recordatorios** de clase y caducidad de bono
    salen gratis del `platform-scheduler`.
- **Landing `luciapassardi` (yoga) — restyle completo (ADR 017).** Nuevo portal
  landing-only `apps/luciapassardi/luciapassardi-portal` (puerto 5184) servido por
  el contenedor `portals`, en `luciapassardi.hulkstein.local`. Reutiliza el
  contenido de `luciapassardiyoga.com` (clases grupales/privadas/colectivas,
  retiros y talleres, enfoque asana/pranayama/meditación, credenciales) con una
  **estética nueva "sereno/zen"** (paleta piedra/salvia/teal, Cormorant + Mulish,
  blobs orgánicos, degradados, reveal on scroll), one-page con anclas y **contacto
  directo** (WhatsApp/email/Instagram, sin backend). Estructura canónica
  `data/ + components/ + views/ + hooks/`. Wiring completo: pnpm-workspace,
  Dockerfile/portals.conf/dev-entrypoint de `portals`, compose, upstreams dev+prod,
  seed nginx `luciapassardi.conf`, `deploy/services.json`. TODO: sustituir fotos
  placeholder por imágenes reales de Lucía.
- **Veri\*Factu — camino de remisión real + certificados + auth (EXTEND
  `platform/verifactu`).** Cierra el ciclo de cumplimiento end-to-end sobre el
  modelo ya existente (cadena de huellas blindada al vector oficial AEAT):
  - **Certificados PKCS#12 (§12)** — `POST/GET:id/POST:id/renovar/DELETE`
    `/v1/verifactu/certificados`. El .p12 (con clave privada) + passphrase se
    guardan **cifrados AES-256-GCM** (`PLATFORM_CONFIG_ENCRYPTION_KEY`), nunca en
    claro; se extraen metadatos reales (CN, emisor, nº de serie, caducidad) con
    `node-forge` (`lib/pkcs12.js`). Migración 0008.
  - **Firma XAdES (§4)** — `lib/xades.js` (xml-crypto): firma *enveloped*
    RSA-SHA256 con KeyInfo X509, verificable; `POST /registros/:numSerie/firmar`.
    Opcional en Veri\*Factu (resta el perfil EPES de política AEAT).
  - **Remisión real (§5/§17)** — namespaces y XSD **oficiales** de la AEAT
    (descargados en `schemas/aeat/`) en `lib/soap-envelope.js` (RegistroAlta
    completo: IDFactura, Encadenamiento, SistemaInformatico, Desglose, Huella).
    Cola `remision_queue` (estado mutable; los `registros` son append-only) con
    back-off exponencial y DLQ; `services/remision.service.js` reclama→envía
    (mTLS con el cert activo)→parsea `RespuestaLinea`→actualiza estado + CSV +
    lote. Endpoints `POST /remitir`, `POST /registros/:numSerie/remitir`,
    `GET /cola`, `POST /remision/dry-run`, `POST /dlq/:id/reintentar`,
    `GET /lotes/:codigo`.
  - **Worker (platform-scheduler)** — jobs `verifactu-remision-retry` (cada
    minuto, publica `verifactu.remision.due` por tenant con trabajo) y
    `verifactu-dlq-alert` (cada hora). El módulo consume el tick
    (`remision-events.handler`) y drena; grant cross-schema de sólo lectura.
  - **Integración por eventos (§15)** — `domain-events.handler` consume
    `order.completed` y `donation.created` → registro de alta con dedupe por
    `order_id`/`donation_id` (índices únicos parciales). POS NO se consume
    directamente: ya fluye `pos.bill.*`→`tpv`→`tpv.receipt.issued` (sin doble
    emisión).
  - **Autenticación (§18)** — los endpoints dejan de ser públicos: scope desde
    el JWT (`appGuard`), impersonación staff por query, y `requireRole(
    'super_admin','staff')` en todas las mutaciones. +20 tests
    (pkcs12/cifrado, XAdES, remisión, eventos de dominio, jobs del scheduler).
  - **Gestión desde console.hulkstein (§11/§12)** — nueva vista
    `console-portal` *Veri\*Factu (SIF)*: selector de tenant (cada obligado es una
    entidad legal) + impersonación staff, edición del **NIF/razón del obligado**,
    **entorno test/prod** (config gana columna `entorno`, migración 0009),
    parámetros de remisión, **subida/renovación/baja de certificados PKCS#12**
    (fichero → base64 → cifrado at-rest) y panel de estado de la cola. +3 tests.
- **Cobro por QR / payment link — Stripe Checkout Sessions (EXTEND
  `platform/payments`).** "Cobrar desde el móvil" sin hardware ni
  certificación CPoC/MPoC: el cajero genera un cobro y muestra un **QR** (o
  comparte el enlace) y el **cliente paga en SU propio dispositivo** (tarjeta,
  Apple/Google Pay y, en ES, **Bizum** si está habilitado en la cuenta). No es
  card-present → no hay lectura de tarjeta en el móvil del comercio.
  - `POST /v1/payments/checkout-sessions` (`checkout.service.js` +
    `routes/checkout.routes.js`): crea una Stripe Checkout Session `mode:payment`
    con `price_data` ad-hoc por importe, devuelve `{ url, qr, sessionId,
    transactionId, status }`. Sin `payment_method_types` Checkout ofrece los
    métodos habilitados en la cuenta. `qr` es un data-URL PNG (dep `qrcode`,
    carga perezosa: si falta, devuelve `qr:null` y el cliente renderiza el QR
    desde `url`). `GET /v1/payments/checkout-sessions/:id` para poll de estado.
  - Persiste la transacción keyed por el id de sesión (`cs_...`) con
    `source=checkout_link`; reconciliación por webhook
    (`checkout.session.completed` → `succeeded` solo si `payment_status=paid`;
    `async_payment_succeeded/failed`, `expired`). Reutiliza cliente Stripe,
    idempotencia (24h Redis), persistencia de transacciones y el receptor de
    webhooks existentes. Modo stub e2e sin claves. +8 tests (5 ruta, 3 webhook).
  - **Acortador de pay-links** (opcional): con `PAYMENTS_PUBLIC_BASE_URL`
    configurado, el QR codifica un enlace corto propio
    (`https://<base>/api/payments/pay/<code>`, la ruta pública del gateway) que
    **302-redirige** a la URL larga de Stripe → QR mucho menos denso y enlaces
    propios/revocables. El mapeo `code → url` vive en Redis con el TTL de la
    sesión. Sin esa env el QR sigue llevando la URL directa de Stripe (default
    dev). **Producción ya cableada**: `docker-compose.prod.yml` fija
    `PAYMENTS_PUBLIC_BASE_URL=https://hulkstein.com`. +2 tests de redirect.
- **TPV "Tap to Pay" — app nativa Expo + endpoints Stripe Terminal (V1, modo
  test).** El móvil como TPV: teclado moderno (con tecla **"00"**) para
  introducir el importe y cobrar **acercando la tarjeta del cliente al móvil**
  (Stripe Tap to Pay). Bloqueante de diseño documentado: el "tap" =
  NFC/EMV contactless = **solo SDK nativo** (no web/PWA: el navegador no
  expone EMV ni pasa la atestación de dispositivo) → se elige **Expo / React
  Native** con `@stripe/stripe-terminal-react-native`.
  - **Backend (EXTEND `platform/payments`)**: `terminal.service.js` +
    `routes/terminal.routes.js` →
    `POST /v1/payments/terminal/connection-token` (ConnectionToken + Location
    cacheada en config `terminal_location_id`, migración 0005) y
    `POST /v1/payments/terminal/intents` (PaymentIntent `card_present` —
    única excepción donde Stripe admite `payment_method_types`). Reutiliza el
    cliente Stripe, la persistencia de transacciones, idempotencia y el
    webhook existentes; el cobro se reconcilia con `payment_intent.succeeded`
    sin cambios. +5 tests.
  - **App `apps/tpv/tpv-app`** (Expo, **fuera del pnpm workspace** — install
    propio, no se despliega en Docker): lógica pura del teclado
    (`src/lib/amount.js`, 8 tests incl. "00"), login silencioso del cajero,
    flujo Tap to Pay (`StripeTerminalProvider` + `useStripeTerminal`) con
    reader **simulado** en test. Requiere dev-client (no Expo Go).
  - **Seed** `apps/tpv/seed.sql`: app `tpv`, tenant de prueba y cajero
    `cajero@tpv.local`. Verificado e2e en modo stub: login → JWT(app_id=tpv)
    → connection-token + terminal intent → transacción `source=tap_to_pay`.
  - Fuera de la V1 inicial (luego añadido, ver abajo): recibo fiscal y target web.
- **TPV — fase 2 (recibo fiscal) + target web (QR Checkout).** Extiende lo
  anterior:
  - **Recibo tras el cobro**: el webhook de `platform/payments` propaga `source`
    en `payment.succeeded` (tanto en `payment_intent.*` como en
    `checkout.session.*`); `platform/tpv` gana `services/payments-events.handler.js`
    que, ante un cobro `tap_to_pay`/`checkout_link`, crea un `billing_fact`
    (importe IVA incluido al `default_sale_tax_rate` del tenant — settings 0002)
    y auto-emite el ticket simplificado correlativo (reusa `issueReceiptCore`;
    numeración + snapshot + feed Veri*Factu). Verificado e2e: `payment.succeeded`
    → recibo A-000001 (1210 = base 1000 + IVA 210). +5 tests.
  - **Target web `apps/tpv/tpv-portal`** (Vite/React) en `tpv.hulkstein.local`
    vía el contenedor `portals` (puerto 5183, ADR 017): teclado (con "00") +
    **cobro por QR** reutilizando el endpoint de Checkout Sessions de arriba
    (`POST /v1/payments/checkout-sessions`, `source=checkout_link`); el portal
    muestra el QR (`payUrl`/`url`) y hace poll del estado por `transactionId`
    (`GET /:id`) hasta `succeeded`. Es el fallback sin Tap to Pay para cualquier
    navegador. Cableado completo: pnpm-workspace
    (ruta exacta `apps/tpv/tpv-portal` para excluir la app Expo), Dockerfile/
    portals.conf/dev-entrypoint de `portals`, compose, upstreams dev+prod,
    seed nginx `tpv.conf`, `deploy/services.json`.

### Fixed
- **Webhook de Stripe roto a través del gateway (producción).** El bloque NGINX
  `location /api/payments/webhooks/stripe` hacía `proxy_pass …/v1/webhooks/stripe`
  (sin el segmento `payments`), pero el módulo lo sirve en
  `/v1/payments/webhooks/stripe` → en prod Stripe recibía **404** y **ningún
  pago se reconciliaba** (QR, Terminal y one-shot quedaban `pending`). Corregido
  el `proxy_pass` a `…/v1/payments/webhooks/stripe`. Verificado vía gateway:
  ahora el handler responde `400 MISSING_SIGNATURE` (llega a la app) en vez de 404.
- **TPV connection-token devolvía `502 STRIPE_ERROR` con claves Stripe reales.**
  `terminal.service.js#ensureLocation` creaba la Terminal Location con una
  dirección placeholder inválida para España (`postal_code: '00000'` y sin
  `state`), que Stripe rechaza (`Invalid ES postal code` →
  `Missing required address field … address[state]`). Se sustituye por una
  dirección ES válida (`Madrid`, `state: 'Madrid'`, `28013`). El modo stub no
  lo detectaba porque no llega a llamar a Stripe; sólo afloraba con claves
  test/live configuradas. Verificado e2e con claves test: connection-token →
  `pst_test_…` + `locationId` reales.

### Changed
- **Contenedor `apps-servers` único para todos los servidores específicos de
  app ([ADR 018](docs/adr/018-apps-servers-orchestrator.md)).** aikikan-server
  y aulavera-server pasan de contenedores propios a MÓDULOS de un orquestador
  (`apps/apps-servers/`, puerto 3030) con el mismo contrato
  `register/runMigrations` de los monolitos platform-*: un proceso Fastify,
  plugins transversales una vez, un Pool por app ligado a su rol
  `svc_app_<app>` (+ `ensureModuleRole` y hook `enforceGrants` opcional).
  Pieza de seguridad nueva en el SDK: `makeAppGuardHook(expectedAppId)` +
  `ensureIdentityDecorator` — guard **por scope** (el `appGuard` global es
  fastify-plugin y solo valida un `EXPECTED_APP_ID` por proceso); cada módulo
  protege sus rutas en su propio scope y un token de otro app recibe
  `403 APP_MISMATCH` (verificado e2e: token aulavera → ruta aikikan → 403).
  Las constantes `APP_ID` de services/handlers pasan a literal (el env del
  contenedor es compartido); los suscriptores Redis de cada app se mueven de
  su `server.js` a su `register()` (cierre vía `onClose`, flag
  `subscribe:false` para tests de integración). Cada app conserva
  `server.js`+`app.js`+`Dockerfile` como artefactos ready-to-split (criterio
  ADR 016). Wiring: compose dev+prod (2 servicios → 1), upstreams
  `aikikan_server`/`aulavera_server` → `apps-servers:3030`,
  `deploy/services.json` (2 entradas → 1, imagen `apphub-apps-servers`).
  Suites verdes: aikikan 121 · aulavera 61 · platform-sdk 158.
- **Contenedor `portals` único para los 9 frontends
  ([ADR 017](docs/adr/017-unified-portals-container.md)).** Antes: 9
  contenedores (vite en dev, nginx-alpine casi idénticos en prod). Ahora:
  `infra/portals/Dockerfile` con target dev (9 procesos vite lanzados por
  `dev-entrypoint.sh` — el `VITE_API_BASE_URL` de cada portal se inyecta
  POR PROCESO porque el env de contenedor es compartido; HMR intacto) y
  target prod (un nginx-alpine de ~160 MB con un server block POR PUERTO —
  los mismos 5173/5175–5182 de los vite, así `upstream.conf` y
  `upstream.prod.conf` quedan idénticos: `server portals:<puerto>`).
  Deliberadamente sin routing por Host dentro del contenedor: el gateway ya
  elige portal por server block y tenant-console sirve hostnames dinámicos
  (ADR 012). Eliminados los 9 Dockerfiles por-portal e
  `infra/nginx/spa.conf` (factorizado en `infra/portals/spa-locations.conf`);
  `deploy/services.json` pasa de 9 entradas a una (`portals` →
  `apphub-portals`, con el coste documentado de granularidad: tocar un
  portal reconstruye la imagen con los 9); `/opendragon-bootstrap-app`
  reescrito para registrar portales nuevos dentro del contenedor compartido.
  Verificado: dev levanta los 9 vite (títulos distintos por puerto) y la
  imagen prod sirve los 9 dist con `/_health` + fallback SPA por puerto.

### Fixed
- **`deploy/server/deploy.sh` — los contenedores de servicios eliminados
  del compose quedaban corriendo para siempre en prod.** Tras consolidar
  los portales (ADR 017), los 9 contenedores por-app seguían vivos junto a
  `portals`: el `up -d` del deploy no usaba `--remove-orphans` por un
  malentendido documentado de la flag (solo elimina contenedores cuyo
  servicio YA NO existe en el compose; los definidos-pero-no-levantados no
  son huérfanos y no se tocan). Añadido `--remove-orphans` — el siguiente
  deploy limpia los 9 automáticamente.
- **`platform/tpv` integrado en `platform-core`
  ([ADR 016](docs/adr/016-tpv-folded-into-platform-core.md), supersede la
  decisión de contenedor del ADR 015).** Operar un contenedor entero para un
  único módulo de tráfico bajo no compensaba; el contrato de módulos hace la
  reubicación un cambio de cableado puro (cero lógica de negocio): descriptor
  en `platform/core/src/server.js` (12º módulo, con `ensureModuleRole`),
  `DATABASE_URL_TPV` en env/compose, COPYs en el Dockerfile de core, ruta
  NGINX `/api/tpv/` → upstream `platform_core`, servicio `platform-tpv`
  eliminado de compose (puerto 3500 liberado, reservado para un futuro
  re-split). Sin cambios en schema/rol/eventos/scheduler. El módulo conserva
  `src/server.js` + `Dockerfile` como artefactos ready-to-split. De paso,
  `deploy/services.json` corrige los paths de platform-core (faltaban
  leads/donations/inquiries/verifactu/chat — sus cambios no disparaban
  rebuild en deploy) y añade `platform/tpv/**`. La integración destapó un
  conflicto real: `ensureModuleRole` (boot de core) re-otorgaba UPDATE/DELETE
  uniformes deshaciendo los REVOKEs de inmutabilidad de tpv — el contrato de
  módulo gana el hook **opcional** `enforceGrants(superuserUrl)` que el
  orquestador invoca DESPUÉS de la reconciliación
  (`platform/tpv/src/lib/grants.js`; verificado que los grants estrictos
  sobreviven al boot). Verificado e2e: los 12 módulos arrancan,
  settings/datos intactos (mismo schema) y el ciclo fiscal completo (venta
  cash → recibo → registro Veri*Factu → QR) funciona con tpv y verifactu en
  el mismo proceso.

### Fixed
- **`turbo.json` — warnings "no output files found" en `test:unit`.** La tarea
  declaraba `outputs: ["coverage/**"]` pero `vitest run` (sin `--coverage`) no
  genera ese directorio, así que turbo avisaba en cada paquete con cache miss.
  Ahora `outputs: []` (la cobertura vive en `test:coverage`) y `vitest.config*`
  entra en `inputs` para invalidar la caché al cambiar la config de vitest.

### Added
- **`docs/guides/landing-brief.md`** — plantilla de brief para describir una
  landing nueva de forma que el asistente la construya de una pasada con el
  flujo opendragon: identidad, objetivo de conversión (mapeado a los módulos
  de plataforma que lo cubren), audiencia, secciones, contenido/assets,
  formulario público (leads vs inquiries + RGPD), parámetros admin, SEO y
  referencias. Con las secciones 1–4 basta para una V1; incluye ejemplo
  rellenado y un **anexo-catálogo de objetos de diseño** (héroes, galerías,
  bloques de contenido, social proof, navegación, formularios, efectos,
  footers) con cuándo usar cada uno, caveats de CWV y marca ⚡ en los patrones
  ya implementados en portales del repo.
- **Claves Stripe test/live con switch de modo (console + `platform/payments` +
  `platform/splitpay`).** Cada módulo guarda ahora DOS juegos de claves
  (`stripe_test_*` / `stripe_live_*`; en splitpay también
  `platform_account_id_{test,live}` — la cuenta plataforma Connect difiere por
  modo) y una fila plain `stripe_mode` que decide el juego activo.
  Migraciones `payments/0004` y `splitpay/0010`: renombran las claves
  existentes al juego **test** (lo guardado eran credenciales test) y siembran
  `stripe_mode='test'`. Runtime: `reloadStripeFromDb()`/`getWebhookSecret()`
  resuelven por modo, con fallback a env (`PLATFORM_STRIPE_*` /
  `SPLITPAY_STRIPE_*`) **solo en test** — live se resuelve exclusivamente de
  DB. PATCH admin valida prefijos por juego (`sk_test_`/`sk_live_`, idem pk)
  y recarga el cliente al tocar modo o secret; rutas admin de ambos módulos
  ganan schema OpenAPI. Console: `PaymentsConfig.jsx` y `SplitpayConfig.jsx`
  muestran ambos bloques de claves con badge del modo activo y un switch
  segmentado Test|Live (componente nuevo `StripeModeSwitch.jsx`) que persiste
  `stripe_mode` al pulsar Guardar. Fees de splitpay compartidas entre modos.
  Suites verdes: payments 78 · splitpay 289 · console-portal 24.
- **`platform-tpv` — quinto monolito de dominio: TPV genérico (V1 completa).**
  [ADR 015](docs/adr/015-platform-tpv-monolith.md) + spec en
  `docs/use-cases/tpv.md`. Contenedor nuevo en puerto 3500 (módulo único
  `platform/tpv`, schema `platform_tpv`, rol `svc_platform_tpv`, RLS
  estándar): dispositivos terminal, sesiones de caja (una abierta por
  dispositivo vía índice parcial UNIQUE, arqueo ciego, cierre con variance),
  movimientos de efectivo append-only, **recibos con numeración correlativa
  sin huecos** (lock de fila en `number_series` en la misma transacción que
  el documento; verificado bajo concurrencia) y snapshot inmutable forzado
  por grants (el rol solo puede UPDATE en columnas fiscales async), factura
  completa + canje simplificado→factura, abonos con autorización manager
  (correlativo al autorizar; refund cash automático en sesión), informes
  X/Z + agregados por periodo + export CSV, settings por tenant (incl.
  emisor fiscal — cada tenant es una entidad legal) y config service-level
  con vista en console (`TpvConfig.jsx`). Integraciones por eventos: REUSE
  de `platform/pos` como motor de cuentas (evento `pos.bill.paid`
  **enriquecido** de forma aditiva con payments[]/unitPriceCents/metadata —
  el frontend TPV viaja `deviceId` en metadata del bill); ciclo fiscal
  Veri*Factu completo (`tpv.receipt.issued/voided` → registro encadenado
  alta F1/F2/R1 en `platform/verifactu` → `verifactu.registro.created`
  devuelve huella + QR de cotejo async al recibo); job
  `tpv-session-autoclose` en platform-scheduler (grants cross-schema
  acotados, migración 0008). Suites verdes: tpv 38 · pos 107 · scheduler
  168 · verifactu 176; flujo e2e verificado en compose (venta cash →
  billing fact + imputación → recibo A-000001…N sin huecos → QR AEAT →
  abono R con refund en caja → X/Z → CSV → autoclose).
- **`platform/notifications` — email entrante (Resend Inbound), §23–§29 del
  catálogo de casos de uso.** La plataforma ya *recibe* correo manteniendo el
  envío por Resend sin cambios (la recepción solo añade MX; SPF/DKIM/DMARC de
  envío intactos). Decisión: EXTEND de `platform/notifications` (la API key
  Resend, `tenant_email_domains`, el webhook y las supresiones ya viven ahí).
  Piezas:
  - *Webhook + Svix*: `POST /webhooks/resend` captura raw body (parser
    encapsulado, patrón splitpay) y verifica **Svix HMAC** completo cuando
    `resend_webhook_secret` es un `whsec_…` (tolerancia 5 min, multi-firma);
    valor legacy = shared secret `x-webhook-secret` como antes. Cierra el
    cross-cutting §22. La 0026 también corrige el CHECK de config que nunca
    incluyó `resend_webhook_secret`.
  - *Pipeline* (`inbound.service.js`, migración 0026): `email.received` →
    upsert idempotente (`provider_email_id` UNIQUE) → fetch vía Receiving API
    (`GET /emails/receiving/{id}`) → FSM `received → fetched → routed |
    unrouted | archived | quarantined | failed` con reprocess staff.
  - *Adjuntos*: descarga inmediata por `download_url`, allowlist de
    content-type + tamaño máx (config), dedup sha256, bytes en el bucket S3
    compartido (`inbound/<emailId>/…` vía `@apphub/platform-sdk/storage`),
    metadatos en `inbound_attachments`.
  - *Enrutado*: reply tokens plus-addressed (`reply+<token>@dominio`,
    `mintReplyAddress()`) > reglas `inbound_routes` (exacta > dominio) >
    fallback configurable; siempre publica `email.inbound.received`.
    Correlación `In-Reply-To`/`References` ↔ `send_log.provider_message_id`.
  - *Seguridad*: anti mail-loop (detección de auto-replies + self-loop),
    block/allowlist de remitentes, rate-limit por remitente (Redis, fail-open).
  - *Consumidores*: `platform/inquiries` reinyecta la respuesta del usuario al
    timeline (`inquiry.reply.received` → activity `email_reply`, migración
    0003) y notifications alerta al inbox admin (`inquiry.reply_alert`);
    `platform/leads` crea lead desde `lead.email.received` (cierra "captura
    desde email entrante" de leads.md §1). Chat/messaging documentados como
    bloqueados (resolución de usuario por email pertenece a auth).
  - *Admin/GDPR*: `/admin/inbound` (bandeja, detalle con URLs firmadas,
    reprocess, inject dev-stub), `/admin/inbound-routes` CRUD, `DELETE
    /admin/inbound/by-sender` (borra filas + objetos S3); 9 claves
    `inbound_*` nuevas en `/admin/config`.
  - *Scheduler*: job `notifications-inbound-purge` (05:15) publica
    `notifications.inbound.purge_due`; notifications purga filas + objetos +
    tokens expirados (retención: config `inbound_retention_days` →
    `NOTIFICATIONS_INBOUND_RETENTION_DAYS`, default 365).
  - ~95 tests nuevos; suites de notifications/inquiries/leads/scheduler verdes.
- **`apps/aulavera` — sección "Grafocaligrafía Racional" (multi-página, marca
  propia).** Integración del contenido de grafocaligrafiaracional.com (Juanjo
  Vara, discípulo de Vicente Lledó Parrés) como sección con identidad
  diferenciada bajo `/grafocaligrafia` con 6 sub-rutas: quiénes somos, técnica
  escritural ("la escritura sana"), método de los 12 trazos (con temperatura
  y esencias por trazo + Gran Test V1 estático — la auto-evaluación
  interactiva queda para V2 si el autor facilita el algoritmo), guía para
  zurdos, recursos (20 vídeos YouTube con facade click-to-load, 15 artículos
  externos enlazados, 8 descargables) y curso profesional con inscripción.
  Contenido estático en `src/data/grafocaligrafia/` + assets en
  `public/grafocaligrafia/`; scope visual `.grafo` (acento azul tinta) en
  `styles/grafocaligrafia.css` sin tocar el design system. La inscripción al
  curso REUSA `platform/leads` (`source: aulavera/grafocaligrafia-curso`) —
  cero backend nuevo en el app.
- **`platform/storage` — descargas públicas (kind `public_download`).** Nuevo
  kind (`pdf`/`zip`, 100 MB, `public: true`) y endpoint anónimo
  `GET /v1/storage/public/:id?appId&tenantId` que responde `302` → presigned
  GET (rate-limit 30/min por IP, mismo criterio anti-abuso que los POST
  públicos de leads/inquiries; el UUID no es adivinable y el RLS sigue
  aplicando). Helper `putObject` server-side en `@apphub/platform-sdk/storage`
  y seed idempotente
  `platform/storage/scripts/seed-grafocaligrafia-downloads.mjs` que sube los
  3 descargables pesados (>10 MB) de grafocaligrafía a MinIO con UUIDs fijos;
  los ≤10 MB se sirven como estáticos del portal.
- **Prioritarios de `docs/use-cases/` implementados en los 34 módulos (5 olas).**
  Cada módulo de plataforma recibió sus recomendaciones priorizadas viables
  (backend-only) del catálogo de casos de uso, con migraciones aditivas,
  OpenAPI en todas las rutas nuevas, scoping `(app_id, tenant_id)`/RLS
  intacto y suites verdes por módulo (~+1.500 tests netos). Detalle por ola
  en los commits `a778835` (marketplace ×8), `3f5b81f` (restaurant ×6),
  `8406a9c` (appointments ×8), `00f593d` (core ×10) y el commit actual
  (scheduler + wiring de notifications). Cierre cross-cutting:
  **platform-scheduler** gana retry con backoff + evento
  `scheduler.job.failed` (dead-man parcial) y 5 jobs nuevos
  (`scheduler-runs-purge`, `auth-token-purge`,
  `notification-send-log-purge`, `messaging-sla`,
  `telehealth-expire-stale`) con grants least-privilege (migración 0007,
  sin guard condicional); **platform/notifications** cablea 8 consumers
  nuevos (review.replied, dispute.opened/withdrawn, package.frozen/
  unfrozen/refunded → push; waitlist.notified de reservations y bookings →
  SMS) con plantillas seed es/en (migración 0025). Los ítems que requieren
  proveedores externos, UI o diseño mayor quedan anotados como pendientes
  en cada `docs/use-cases/<módulo>.md`.
- **`platform/leads` — CRM completo (casos de uso priorizados de
  `docs/use-cases/leads.md`).** Migración `0002_crm_extension`: asignación
  (`assigned_to`), `score`, estados `won|lost` con `lost_reason` obligatorio
  (`closed` queda legacy), `tags`, `custom_fields`, atribución UTM completa +
  `referrer`/`landing_url` + `app_id` de origen, consentimiento LOPDGDD
  (`consent_text/version/at` sellado en el alta), snooze
  (`next_follow_up_at`) y conversión lead→tenant (`converted_tenant_id`).
  Nueva tabla `lead_activities` (timeline con autor: notas, llamadas, emails,
  reuniones + transiciones de estado y asignaciones auditadas
  automáticamente). API admin: filtros combinados + búsqueda `?q=` +
  ordenación + bandeja `assignedTo=me|none`, `GET/POST /:id/activities`,
  `POST /:id/convert` (one-shot, 409 si ya convertido) y `DELETE /:id`
  (borrado GDPR). Eventos nuevos: `lead.status_changed`, `lead.assigned`,
  `lead.converted`, `lead.deleted`. **`platform/notifications`**:
  auto-respuesta al prospecto (consumer de `lead.created` → plantilla
  `lead.acknowledged` es/en, migración `0022`).
  **`platform-scheduler`**: job `lead-retention-purge` (diario 04:45, borra
  leads cerrados con antigüedad > `LEADS_RETENTION_DAYS`, default 1095 días)
  + grant cross-schema a `platform_leads` (migración `0006`, sin guard
  condicional — lección de `0005`).
- **`docs/use-cases/` — catálogo exhaustivo de casos de uso por microservicio.**
  Un fichero por módulo de plataforma (34 + README índice) enumerando los
  casos de uso posibles del dominio —implementados o no— con marcado
  ✅/🔧/❌ verificado contra el código, para detectar funcionalidad futura
  deseable. Plantilla canónica: `docs/use-cases/leads.md`.
- **`platform/notifications` — auditoría de envíos en `send_log`.** Los tres
  senders (email/Resend, SMS/Twilio, push/FCM) registran ahora cada intento en
  `platform_notifications.send_log` con `status` `sent|failed|skipped`,
  `channel`, `template` (la clave de plantilla viaja desde `compose()` vía
  `templateKey`) y `recipient`. Push registra además el tenant context completo
  (`app_id`/`tenant_id`/`user_id`); email/SMS lo dejarán completo cuando el
  pipeline sea tenant-aware (TODO-resend). Migración `0021` (scope nullable +
  CHECK de status + índices) y endpoint staff
  `GET /v1/notifications/admin/send-log` con filtros channel/template/status.
  El log es best-effort: un fallo al escribirlo nunca tumba el envío.
- **`platform/leads` + `platform/inquiries` — anti-abuso en los endpoints
  públicos.** `POST /v1/leads` y `POST /v1/inquiries` llevan ahora (a) override
  de rate-limit por ruta (5 req/min por IP, sobre el global de
  `@fastify/rate-limit`) y (b) campo honeypot `website`: si llega relleno se
  responde un `201` indistinguible del éxito real pero no se persiste ni se
  publica evento.

### Fixed
- **`platform/core/Dockerfile` no copiaba el workspace `platform/chat`** (ni
  `package.json` ni `src`/`migrations`, en las stages development y
  production). El contenedor `platform-core` fallaba al arrancar con
  `ERR_MODULE_NOT_FOUND: @apphub/platform-chat`, las migraciones de chat nunca
  corrían y los jobs `chat-*` del scheduler fallaban cada minuto con
  `relation "platform_chat.messages" does not exist`. Nota operativa para
  entornos con volumen de Postgres anterior al módulo chat: el init SQL no
  re-corre, hay que crear a mano rol/schema/grants de `platform_chat` y
  `platform_verifactu` y re-aplicar el grant condicional
  `platform/scheduler/migrations/0005_grant_platform_chat.sql` (quedó
  registrado como aplicado siendo no-op).
- **`trustProxy` en los 4 monolitos públicos** (`platform-core`,
  `platform-marketplace`, `platform-restaurant`, `platform-appointments`).
  Detrás de NGINX/Cloudflare `req.ip` era la IP del proxy, lo que colapsaba el
  rate-limit por IP en un único bucket compartido y guardaba la IP del proxy en
  `leads.ip`/`inquiries.ip`. Ahora se honra `X-Forwarded-For`.
- **`platform/chat` — ampliación de features (bloques A+B+C+D).** Sobre el
  módulo base se añadió: **threads** (sub-respuestas), **forward**, **pins**,
  **@menciones** ampliadas (`@all`/`@here`, por rol de conversación, y por rol
  de app `@staff` resolviendo vía HTTP a `platform/auth`), **acuses de
  entregado** (delivered receipts), **filtros de búsqueda**
  (conversación/autor/tipo/fecha), **solicitudes de DM** (request/accept/
  decline), **invitaciones por código + grupos públicos**, **mensajes
  programados** y **efímeros (TTL)**, **límite de adjuntos por tenant**,
  **palabras prohibidas** y **baneos de tenant**, **export + métricas** de
  staff, y soporte tipo helpdesk con **CSAT**, **macros** (respuestas
  guardadas) y **enrutado por cola**. Nueva migración `0002_features.sql`
  (columnas + tablas `pinned_messages`/`conversation_invites`/`tenant_bans`/
  `support_csat`/`support_macros`, todas con RLS forzada). El módulo ahora corre
  un **consumidor de `platform.events`** para entregar mensajes programados.
  **`platform-scheduler`**: 4 jobs nuevos (`chat-scheduled-send`,
  `chat-ephemeral-purge`, `chat-retention-purge`, `chat-support-sla`) + grant
  cross-schema a `svc_platform_scheduler` (migración `0005`). **`platform/
  notifications`**: handlers `chat.*` que mandan **push** al destinatario
  (resoluble por `userId` vía `push_devices`). Tests unitarios (≥95%
  statements/lines en chat) + integración (threads, pins, invites, entrega
  programada, baneo). Ver [ADR 014](docs/adr/014-chat-module-and-websocket-gateway.md).
- **`platform/chat` — módulo de chat entre miembros (platform-core).**
  Capacidad horizontal nueva (schema `platform_chat`, rol `svc_platform_chat`,
  registrada en `platform/core/src/server.js`) que da a cualquier app chat
  **directo (1:1)**, **grupo** y **soporte**. Funcionalidad: conversaciones con
  dedup de directos, gestión de participantes/roles, mensajes (responder,
  editar, soft-delete), reacciones, @menciones, adjuntos vía `platform/storage`,
  marcadores de leído + contadores de no-leídos, búsqueda full-text
  (`tsvector`), bloqueos + reportes (moderación), redacción PII opcional por
  tenant (OFF por defecto), y soporte tipo helpdesk (cola + asignación de
  agente + estado/prioridad). Aislamiento multi-tenant por RLS forzada como el
  resto de módulos. **Primer gateway WebSocket de la plataforma**
  (`GET /v1/chat/ws`, `@fastify/websocket`) con fan-out cross-instancia por
  Redis (`chat:rt:{appId}:{tenantId}`) — entrega navegador-a-navegador; el
  *envío* sigue por POST REST (ruta de escritura única). Presencia y typing
  efímeros en Redis. Publica `chat.{conversation.created,message.created,
  mention.created,support.assigned,message.reported}` en `platform.events`
  (a integrar en `notifications` como seguimiento). NGINX: `/api/chat/ws` con
  upgrade headers + timeout largo. Tests unitarios (≥95% statements/lines) +
  integración (RLS cross-tenant, e2e grupo, dedup directo, soporte, y fan-out
  real-time end-to-end). Ver [ADR 014](docs/adr/014-chat-module-and-websocket-gateway.md).
- **Cobertura de tests ≥95% en cada microservicio de `platform/`.** Se añadió
  una config de cobertura compartida (`vitest.coverage.mjs`: v8, mide
  services/routes/repositories/libs con lógica; excluye plumbing —
  `server.js`/`index.js`/`lib/{env,logger,db,redis,migrate}.js`/`plugins/`/
  `*.config.js`) y se cableó en los 36 módulos (incl. `test:coverage` +
  `@vitest/coverage-v8` en los que faltaban; los orquestadores
  appointments/marketplace/restaurant miden `server.js` como core). Tras
  añadir tests unitarios (repositorios SQL-shape, rutas vía invocación directa
  de handlers para las ramas `?? {}`, y casos de rama en services), **los 36
  módulos quedan ≥95% en Statements, Branches, Functions y Lines** según
  `pnpm test:coverage` (37/37 tareas verdes). Único cambio de fuente:
  eliminación de la función muerta `pad2` en el job de recurrencia del
  scheduler.
- **Cobertura de tests (TODO-test.md).** Implementados los tests pendientes
  que cubren código existente, más 3 features pequeñas que el inventario de
  tests anticipaba (cada una con su test):
  - `platform/leads` — publica evento `lead.created` en `platform.events`
    tras crear un lead (nuevo `lib/redis.js` con `configureRedis`, publish
    post-commit que no propaga fallos). Lo consume `notifications`.
  - `platform/messaging` — redacción de PII (`lib/redact.js`) aplicada en
    `postMessage` antes de persistir: emails y teléfonos (≥9 dígitos) se
    enmascaran (anti-disintermediation).
  - `platform/catalog` — búsqueda por texto: `items.repository.searchItems`
    (ILIKE sobre nombre/descripción, parametrizado) + `items.service.searchItems`
    + `GET /v1/items?q=`.
  - Tests nuevos: módulos platform (inquiries, verifactu, marketplace/restaurant/
    appointments server, tenant-config nginx render, scheduler advisory-lock/
    missed-tick, core OpenAPI + schema-isolation integration), `@splitpay/sdk-js`
    (client + contract), y arneses RTL nuevos en aulavera/aikikan/console/
    splitpay/portal con tests de vistas. Aulavera-server `migrations`.
  - **`packages/contract-tests`** (paquete nuevo) — cross-cutting/infra:
    contratos file-based (CI workflows, postgres-init, nginx sidecar +
    ejecución funcional con `sh`, runbook, registro de eventos zod) que siempre
    corren, e integration guardado (postgres-roles, RLS smoke, tenant
    lifecycle, OpenAPI snapshot vs `openapi-paths.snapshot.json`) que pasa
    contra el stack vivo y se SKIPea si la DB/core no son accesibles.
  - **E2E Playwright** (`packages/contract-tests/e2e/`) — specs por subdominio
    (aulavera, aikikan magic-link, console config, cross-app cuota) + config,
    detrás del script `test:e2e` (fuera del pipeline por defecto; requiere
    `playwright install`).
- **`apps/verifactu` — portal multi-rol + módulo platform `verifactu`
  (bootstrap → importa → implementa).** App de facturación verificable
  (AEAT VERI\*FACTU).
  - **Portal** (`apps/verifactu/verifactu-portal`, puerto 5182): 5 roles
    (emisor/asesoría/desarrollador/administrador/receptor) importados 1:1
    de los prototipos `docs/*.html` a estructura React canónica
    (RoleSelector + router + `data/` + `components/` + `lib/` + `hooks/`),
    estilado Tailwind.
  - **Módulo platform `platform/verifactu`** (en `platform-core`, schema
    `platform_verifactu`, rol `svc_platform_verifactu`): registros + cadena
    de huellas + eventos SIF + lotes de remisión + cartera/representación +
    certificados + control de flujo + cotejo. RLS por `(app_id, tenant_id)`.
    Endpoints portal-facing públicos scopeados por query/body (sin login
    aún). Las 5 vistas leen datos reales vía API + seed demo.
  - **Skeleton realista**: huella (SHA-256), firma XAdES, SOAP de remisión
    y QR van como **stubs marcados `TODO: fuente-oficial AEAT`** — el orden
    de campos de la huella, el perfil XAdES, el WSDL y los parámetros del QR
    dependen de specs oficiales aún no disponibles.
- **`apps/macabeo` portal multi-rol (importa · full split)** — economato
  ecológico con 11 roles. Se importaron los 11 prototipos HTML de
  `apps/macabeo/doc/` (índice selector + invitado/socio/cliente
  front-office + administrador/gestor-pedidos/almacén/comprador/cajero/
  repartidor/proveedor/tesorero back-office) a la estructura React
  canónica con **preservación 1:1**. Decisión de scope tomada con el
  usuario (full multi-role split) y de estilado (**CSS Modules por vista**
  para evitar colisión de nombres de clase y cero deriva visual).
  - Router (`react-router-dom`) en `App.jsx`: `/` = selector de rol,
    `/invitado /socio /cliente /admin /gestor-pedidos /almacen /comprador
    /cajero /repartidor /proveedor /tesorero`.
  - Fundación compartida: `index.css` (tokens `:root` `--mb-*` + reset
    base + fuentes Fraunces/Manrope/JetBrains en `index.html`),
    `components/RoleCrumb` (breadcrumb "← roles"), `lib/api.js` +
    `lib/tenant.js` (scaffolds para `/opendragon-implementa`),
    `hooks/index.js` (`useCountdown`, `useToast`), `data/*` (mock por rol,
    sin JSX).
  - Cada vista = `views/<rol>/<Comp>.jsx` + `<Comp>.module.css` con el CSS
    bespoke del prototipo verbatim; interacciones del prototipo (filtros,
    carrito, countdown, TPV add-to-ticket, picking, toggles de estado)
    portadas a estado React.
  - **Sin backend aún**: los únicos "forms" del front-office público son
    CTAs de registro/login → diferido a `/opendragon-implementa` (auth,
    role-gating, wiring de inquiries/pedidos). Sin schema `app_macabeo`
    todavía (decisión de ADR 013 la toma `/opendragon-implementa`).
- **`apps/js-electric` CRM-lite iteración 1** — discriminación de leads
  por canal (contacto vs presupuesto) + captura de simulación solar como
  metadata. Cero microservicios nuevos: todo REUSE de
  `platform/inquiries` (incluyendo el endpoint público, los admin GET/
  PATCH y la columna JSONB `metadata`).
  - **Modal de presupuesto**: nuevo `BudgetRequestModal.jsx` abierto
    desde el botón "Pedir presupuesto exacto" de la calculadora solar.
    Pide nombre/email/teléfono + GDPR y submitea con `source='landing-budget'`
    + `metadata.simulation` ({potencia, ahorroAnual, roi, co2, coste,
    facturaMensual, area, tipo, orientación}). Convierte la calculadora
    en un canal de lead cualificado con contexto que antes se perdía.
  - **Form de Contacto** marca ahora `source='landing-contact'` para
    distinguir el canal en la bandeja.
  - **Admin**: nav y H1 renombrados de "Inquiries" a "Leads"; nueva
    columna **Tipo** (badges Contacto / Presupuesto derivados de
    `source`); filtro de tipo cliente-side (el endpoint admin no
    soporta `?source=…` todavía — iteración 5 lo extenderá si hace
    falta); panel destacado "Simulación solar" en el detalle cuando
    `metadata.kind === 'budget'`, con KPIs y inputs originales.
  - **No tocado**: enum `status` del módulo `platform/inquiries`
    (compatibilidad con otros consumidores), schema de inquiries (sin
    migraciones), módulo platform en general (cero cambios).

- **`apps/js-electric` Implementa lean — admin inbox + tenant seed**.
  Sigue el patrón de marketing-site con admin embebido (vs. shared
  tenant-console): toda la funcionalidad admin vive en el propio portal.
  - **Seed**: `apps/js-electric/js-electric-portal/scripts/seed.js`
    registra app `js-electric`, tenant `js-electric` (uuid `5000…0001`,
    subdomain `js-electric`) y admin `admin@jselectric.es` (rol `owner`,
    pass `password123`). Sin app schema — la app es marketing puro, no
    tiene dominio de datos propio.
  - **Backend**: cero módulos nuevos. Solo REUSE de `platform/inquiries`
    (form público + admin CRUD) y `platform/auth` (login). El portal del
    landing ya wireado a `POST /api/inquiries/v1/inquiries` durante
    Importa funciona end-to-end con el seed.
  - **Frontend**: `react-router-dom` añadido; nuevas rutas
    `/admin/login`, `/admin/inquiries`, `/admin/inquiries/:id` con
    `RequireAdmin` guard. Vistas: lista con filtro por status +
    paginación, detalle con `status`/`staffNotes` editables (PATCH).
  - **Out of scope**: CMS para `projects`/`testimonials`/`blogPosts`
    (siguen estáticos en `mock.js`). Se evaluará cuando marketing pida
    poder editarlos sin PR.

### Changed
- **ESP swap: Resend en lugar de SendGrid** — `platform/notifications` ahora
  usa la SDK de Resend para envío de email y para la API de Domain
  Authentication por tenant.
  - `email.service.js` reescrito con `import { Resend } from 'resend'`.
  - `sendgrid-domains.service.js` eliminado; `resend-domains.service.js`
    implementa create/validate/delete contra Resend's Domains API.
  - DB: clave config renombrada `sendgrid_api_key` → `resend_api_key`;
    migración 0014 borra la fila stale (la API key vieja era de SendGrid,
    inservible para Resend).
  - Env vars: `SENDGRID_API_KEY`/`SENDGRID_FROM_EMAIL` → `RESEND_API_KEY`/
    `EMAIL_FROM_ADDRESS` (más genérico, futureproof).
  - UI: Hulkstein Console > Configuración > "Resend" (era "SendGrid"),
    placeholder API key `re_…`, helper de SPF actualizado a
    `include:amazonses.com` (Resend usa AWS SES por debajo).
  - Tests: mocks `vi.mock('@sendgrid/mail')` → `vi.mock('resend')`.
  - Operador debe pegar la nueva API key de Resend desde la consola
    tras desplegar.

### Added
- **`platform/donations` module** — infraestructura completa para
  gestión de donaciones, reutilizable por cualquier app de la
  plataforma. Vive dentro de `platform-core` (puerto 3000) junto a
  `splitpay` y `notifications`.
  - Cubre **todos los tipos**: one-shot vs `recurring_monthly`,
    anónimas vs identificadas, donante registrado vs invitado, fondo
    general vs campaña/causa, fiscal completo (Ley 49/2002 + AEAT
    modelo 182).
  - **DB**: schema `platform_donations`, rol `svc_platform_donations`,
    4 tablas con RLS por `(app_id, tenant_id)` —
    `causes` (campañas con `target_cents`/`raised_cents`),
    `donations` (estado + PII donante incluyendo `donor_nif`),
    `donation_subscriptions` (recurrentes Stripe),
    `fiscal_certificates` (idempotente por
    `(app_id, tenant_id, fiscal_year, donor_nif)`).
    Lectura selectiva sobre `platform_tenants.tenants` (NIF/razón
    social/dirección — necesarios para certificado y modelo 182).
  - **Splitpay queda intacto** — `createCheckoutSession` ya aceptaba
    `price_data` ad-hoc y `mode:'subscription'` con
    `recurring.interval`. El módulo lo consume vía HTTP loopback con
    `metadata.purpose='donation'`.
  - **Eventos**: subscriber psubscribe a `*.events` filtrando por
    `metadata.purpose='donation'`. Actualiza estados, incrementa
    `raised_cents`. Emite `donation.completed`,
    `donation.recurring.{charged,failed,cancelled}`,
    `donation.refunded`, `donation.certificate.ready`.
  - **Fiscal**:
    - Certificado PDF con `@react-pdf/renderer` (sin JSX,
      `React.createElement` directo — Node 20 sin transpilador).
      Sube a `platform/storage` (MinIO).
    - Export TXT modelo 182 en ISO-8859-1, registros 600 chars
      (header tipo 1 declarante + detalle tipo 2 por donante con
      NIF). Spec base Orden HAC/665/2004.
  - **Endpoints** (montados en `/api/donations/` vía nginx →
    `platform_core/v1/donations/`):
    - Públicos: `GET /causes/?appId=&tenantId=`,
      `POST /checkout` (one-shot o recurring), `GET /health`.
    - Autenticados: `GET /me`, `GET /subscriptions/me`,
      `POST /subscriptions/:id/cancel`, `GET /:id`.
    - Admin (`owner|admin|staff|super_admin`):
      `GET/POST/PATCH/DELETE /causes/admin/*`,
      `GET /admin/`, `GET /admin/subscriptions`,
      `POST /admin/:id/refund`,
      `GET /fiscal/certificates`,
      `POST /fiscal/certificates/generate`,
      `GET /fiscal/modelo-182?year=`.
  - **Notifications** (`platform_notifications.migrations/0019`):
    6 plantillas nuevas (`donation.thank_you`,
    `donation.receipt.monthly`, `donation.payment_failed`,
    `donation.cancelled`, `donation.refunded`,
    `donation.certificate.ready`) + 6 helpers `sendDonation*` en
    `email.service.js` + 6 subscribers en `event-consumer.js` que
    mapean cada evento de donación a su email Resend.
  - **Provisión**: schema + rol en
    `infra/postgres/init/01_platform_schemas.sql` con GRANT default
    de DML; ruta `/api/donations/` en
    `infra/nginx/snippets/platform-routes.conf` (burst=20);
    `DATABASE_URL_DONATIONS` + `PLATFORM_CORE_BASE_URL` en
    `docker-compose.yml` (servicio `platform-core`);
    `SVC_PLATFORM_DONATIONS_DB_PASSWORD` en `.env.example`;
    Dockerfile platform/core actualizado (COPY package.json + src,
    en dev y prod stages).
  - **No app-side en este commit**: se construye sólo la
    infraestructura plataforma. La integración con apps específicos
    (aikikan: formulario donante en `/area-socio`, admin de causas
    en `/consola`, link "Donar" en la landing) queda como commit
    posterior.
- **`platform/leads` module** — public lead-capture endpoint for the
  Hulkstein landing's contact form. New schema `platform_leads` + role
  `svc_platform_leads`. POST `/v1/leads` is public (no auth, nginx rate
  limit burst=5); GET/PATCH `/v1/leads/admin` is staff-gated via
  `requireRole('super_admin', 'staff')`. Lead table captures
  contact_name/email/business_name/phone/industry/message/source plus
  ip/user_agent (for abuse triage) and a `status` workflow
  (new → contacted → qualified → closed) for the future CRM UI.
- **Hulkstein public landing** at `apps/portal/` (the apex
  `hulkstein.com`). Replaces the legacy Stripe-themed admin clone that
  was never wired to a real backend. Sections: Header, Hero,
  Industries (Restaurantes, Gym, Servicios, Tienda), HowItWorks,
  WhyUs, FinalCta with gradient indigo→violet, Footer. Lead-capture
  modal (`LeadModal.jsx`) POSTs to `/api/leads/v1`. Tailwind palette
  swapped to indigo/slate defaults; font swapped from DM Sans to
  Inter. "Iniciar sesión" link points to
  `console.hulkstein.com` for staff/admin entry — overridable
  via `VITE_LOGIN_URL`. Legacy `features/`, `components/layout/`,
  `components/shared/` stay on disk as dead code (unreferenced by
  routes; tree-shaken at build).

### Changed
- **TLS at the origin via Cloudflare Origin Certificate** — every per-app
  nginx server block (seeds and dynamic templates rendered into Redis by
  `platform/tenant-config`) now `include`s
  `/etc/nginx/snippets/tls-listen.conf`. In dev that file is empty
  (HTTP-only). In prod, `docker-compose.prod.yml` overlays
  `tls-listen.prod.conf` on top of it, activating
  `listen 443 ssl http2;` plus the cert at
  `/etc/cloudflare/origin/{cert,key}.pem`. Required to run Cloudflare in
  `Full (Strict)` SSL mode (the only secure option now that CF removed
  `Flexible` for new sites). The prod compose also adds `443:443` to the
  nginx ports and mounts `/etc/cloudflare/origin:ro`. Full setup is in
  `docs/runbooks/cloudflare-dns.md` (cert generation in CF UI → upload
  to host → deploy → flip SSL mode → verify).
- **Public production domain switched to `hulkstein.com`** (was placeholder
  `hulkstein.com`). Nginx seed configs in `infra/nginx/seed/*.conf` now match
  `<sub>.hulkstein.com` for prod and keep `<sub>.hulkstein.local` for dev. New
  env var `PLATFORM_PUBLIC_DOMAIN` (set on `platform-core` in
  `docker-compose.prod.yml`) drives the host suffix used by
  `platform/tenant-config/src/services/nginx-config.service.js` when it
  renders dynamic per-app / per-tenant blocks into Redis. Default remains
  `hulkstein.com` so dev stacks are untouched.
- **Cloudflare proxy support in nginx** — new
  `infra/nginx/snippets/cloudflare-real-ip.conf` declares Cloudflare's
  IPv4/IPv6 ranges as trusted via `set_real_ip_from` and points
  `real_ip_header CF-Connecting-IP`, so `$remote_addr` (and therefore the
  `limit_req` zone keyed by it, plus audit logs) reflect the real visitor
  IP instead of a CF datacenter. Included in the http block of
  `infra/nginx/nginx.conf`; in dev the ranges simply never match.
- **Runbook**: `docs/runbooks/cloudflare-dns.md` documents the Cloudflare
  DNS records (apex + wildcard, both proxied), SSL/TLS mode (Full →
  Full strict upgrade path with Origin Cert), origin firewall lockdown,
  and verification steps.

### Removed
- **YogaStudio app retired** — deleted `apps/yoga-studio/` (portal + 5 empty
  service shells: `yoga-users`, `yoga-classes`, `yoga-bookings`, `yoga-bonuses`,
  `yoga-reporting`). All functionality lives in platform modules now
  (`platform/auth`, `platform/services`, `platform/bookings`, `platform/packages`,
  `platform/availability`, …). Cleaned up references in `.env`, `.env.example`,
  `.github/workflows/deploy.yml`, `infra/postgres/init/00_init.sql`,
  `packages/platform-sdk/src/app-guard.js`, `platform/tenant-config/src/services/{nginx-config,bootstrap}.service.js`,
  and the live docs (CLAUDE.md, ARCHITECTURE.md, DEVELOPMENT.md, RUN.md, COMMANDS.md,
  CONVENTIONS.md, TODO.md, docs/runbooks/platform-bootstrap.md). ADRs and applied
  migrations preserve the historical record.

### Removed (secrets)
- Stripe / OAuth / Resend / S3 secrets removed from `.env` and `.env.example` —
  they live encrypted at rest in `platform_*/config|settings|oauth_providers`
  tables and are configured via `/v1/<module>/admin` endpoints (super_admin/staff).
  Only bootstrap secrets (DATABASE_URL, JWT, encryption master key, MinIO root,
  per-module DB role passwords) remain in env.

### Added
- **Module-level runtime config UI in console** — staff can now
  bootstrap every platform-core module from the admin portal without touching
  `.env` or redeploying. New sidebar group "Configuración" with sections for:
  - **OAuth Providers** (Google, Facebook): client_id + AES-GCM-encrypted
    client_secret + enabled flag. New table `platform_auth.oauth_providers`,
    routes `/v1/auth/admin/oauth-providers`. `oauth.service` resolves the live
    config from DB at each login, falling back to env for back-compat.
  - **Stripe (payments)**: publishable_key, secret_key, webhook_secret —
    encrypted. New table `platform_payments.config`, routes `/v1/payments/admin/config`.
  - **Resend + Email Templates (notifications)**: API key + sender + 6
    seeded templates with `{{var}}` interpolation. Tables
    `platform_notifications.config` and `…templates`. Routes
    `/v1/notifications/admin/config`, `…/templates` (CRUD + preview).
    `email.service` reads templates from DB with hardcoded fallback;
    Resend api_key + sender resolved from DB with env fallback (cached 30s).
  - **Stripe Connect (splitpay)**: platform_account_id + secret/publishable
    keys + webhook secret. Table `splitpay_core.config`, routes
    `/v1/splitpay/admin/config`. `lib/stripe.js` hydrates from DB at boot
    via a new `reloadStripeFromDb()` hook called from `register()`.
  - **Object storage**: S3 endpoint/region/bucket/access/secret + MinIO
    public endpoint + force_path_style. Table `platform_storage.settings`,
    routes `/v1/storage/admin/config` + `/admin/kinds` (read-only).
    `storage.service` driven by a merged DB+env settings cache.
  - **Apps & Tenants** (tenant-config): existing CRUD endpoints now require
    `requireRole('staff')` on writes; reads remain authenticated.

  All admin endpoints sit behind `requireRole('super_admin', 'staff')`. All
  secrets are encrypted at rest with AES-256-GCM via the new
  `@apphub/platform-sdk/crypto` helper (master key in
  `PLATFORM_CONFIG_ENCRYPTION_KEY`, 32 bytes hex). Migration is non-breaking:
  modules read config from DB and fall back to env for older deployments.

- **`reviews` verified-purchase check** — `platform/reviews` now calls
  `platform-marketplace`'s own `/v1/orders/:id` endpoint (HTTP loopback inside
  the same container, ready-to-split when the modules separate) to verify that
  the supplied `orderId` belongs to the reviewing user and is in a paid/fulfilled
  status. Result is persisted as `verified_purchase BOOLEAN` on
  `platform_reviews.reviews`. See [ADR 009](docs/adr/009-reviews-verified-purchase.md).
  - New column `verified_purchase` + partial index for fast verified-only listings.
  - `GET /v1/reviews?verifiedOnly=true` filter.
  - `GET /v1/reviews/aggregate` returns `verifiedCount` alongside `count`/avg.
  - Soft-fail: orders unreachable / 404 / 5xx → review created with
    `verified_purchase=false` (never blocks the user-visible action).
  - 17 unit tests for `orders-client.js`, 6 new integration tests stubbing
    `global.fetch`, all green.

- **Object storage (MinIO + `storage` module)** — sixth infra container
  (`minio:9000/9001`) and a new module of `platform-core` that mints presigned
  PUT/GET URLs and registers metadata in `platform_storage.objects`. Bytes
  never traverse Node — clients PUT directly to MinIO/S3. See
  [ADR 008](docs/adr/008-object-storage.md).
  - `packages/platform-sdk/src/storage.js` — S3 client + `presignPut/Get`,
    `headObject`, `deleteObject` helpers (using `@aws-sdk/client-s3` and
    `@aws-sdk/s3-request-presigner`).
  - `platform/storage/` — full module: `kinds.js` catalogue (13 kinds, each
    with MIME allowlist + maxBytes + retentionDays), service, repo, routes:
    `POST /v1/storage/uploads`, `POST /v1/storage/objects/:id/finalize`,
    `GET /v1/storage/objects/:id`, `GET /v1/storage/objects/:id/download-url`,
    `DELETE /v1/storage/objects/:id`, `GET /v1/storage/objects`,
    `GET /v1/storage/kinds`.
  - `platform/menu` extended with `photo_object_id`; `platform/intake-forms`
    extended with `signature_object_id`. Both keep their old URL columns for
    back-compat.
  - 2 new scheduler jobs: `storage-orphan-purge` (hourly) deletes pending
    rows older than 1h; `storage-retention-purge` (daily 03:15) soft-deletes
    objects past `retention_until` and emits `storage.object.deleted`.
  - New schema `platform_storage`, role `svc_platform_storage`, MinIO bucket
    `apphub`. Production swaps `S3_ENDPOINT` to AWS S3 / Cloudflare R2 with
    no code change.

- **`platform-scheduler` container** — fifth monolith (port 3400), single-runner
  cron service that polls Postgres and publishes scheduled events to the other
  4 monoliths over `platform.events`. See
  [ADR 007](docs/adr/007-platform-scheduler.md). Ships 9 jobs:
  - `availability-hold-purge` (`* * * * *`) — DELETE expired holds
  - `booking-reminders` (`*/5 * * * *`) — publish `booking.reminder.due` (T-24h, T-2h)
  - `booking-recurrence-expander` (`0 * * * *`) — materialize recurrences 30 days ahead
  - `reservation-reminders` (`*/5 * * * *`) — publish `reservation.reminder.due`
  - `package-expiry-warning` (`0 8 * * *`) — publish `package.expiring` (T-30d, T-7d)
  - `package-expiry-transition` (`30 0 * * *`) — flip active → expired
  - `practitioner-payout-close` (`0 2 * * *`) — publish `payout.period_due` per schedule
  - `dispute-sla` (`*/30 * * * *`) — publish `dispute.sla_breached` (>48h no vendor reply)
  - `basket-abandoned` (`0 * * * *`) — publish `basket.abandoned` for idle baskets
  - **Postgres advisory locks** wrap each job to skip overlapping ticks.
  - **Audit table** `platform_scheduler.runs` stores every run's status/timing/error.
  - **Admin API** (internal-only) `/v1/scheduler/jobs`, `/v1/scheduler/runs`,
    `/v1/scheduler/jobs/:name/run` for staff.
  - New schema `platform_scheduler` + role `svc_platform_scheduler` (BYPASSRLS,
    minimal cross-schema GRANTs).
  - Idempotency columns on client modules:
    `bookings.reminder_{24h,2h}_sent_at`, `reservations.reminder_{24h,2h}_sent_at`,
    `packages.warning_{30d,7d}_sent_at`, `disputes.sla_breached_at`.
  - New table `platform_practitioner_payouts.payout_schedules`
    (period weekly/biweekly/monthly + next_run_at).
  - Event consumers extended:
    `notifications` handles `booking.reminder.due`, `reservation.reminder.due`,
    `package.expiring`, `dispute.sla_breached`;
    `practitioner-payouts` handles `payout.period_due`;
    `disputes` handles `dispute.sla_breached`.

- **`platform-appointments` container + 8 appointment modules** — fourth monolith
  container (port 3300) for appointment / scheduling workloads (clinics, salons,
  workshops, lawyers, fitness, etc.). Same modular-monolith pattern as the other three:
  per-module schema + dedicated DB role, shared `PLATFORM_JWT_SECRET`, cross-container
  communication via Redis events on `platform.events`. See
  [ADR 006](docs/adr/006-platform-appointments-monolith.md).
  - `platform/appointments/` — orchestrator (`server.js`, `Dockerfile`, env)
  - `platform/services/` — bookable services catalog (duration, buffers, modality,
    cancellation policy). Publishes `service.published`, `service.deprecated`.
  - `platform/resources/` — practitioners, rooms, equipment, vehicles, with weekly
    work hours and ad-hoc exceptions. Publishes `resource.unavailable`.
  - `platform/bookings/` — appointment FSM (requested→confirmed→reminded→checked_in→
    in_progress→completed; cancelled / no_show / rescheduled), recurrence skeleton,
    waitlist, audit trail. Publishes `booking.{requested,confirmed,reminded,
    checked_in,in_progress,completed,cancelled,no_show,rescheduled}` and
    `booking.waitlist.{added,notified}`.
  - `platform/availability/` — slot computation engine. Reads work_hours, exceptions,
    bookings and active holds; atomic holds via tstzrange overlap checks. Publishes
    `availability.{held,released}`.
  - `platform/intake-forms/` — form templates (versioned), submissions, signatures.
    Subscribes to `booking.confirmed` to auto-create pending submissions for services
    flagged `requires_intake_form`. Publishes `intake.{requested,submitted}`.
  - `platform/telehealth/` — provider-agnostic video room provisioning (stub generates
    opaque ids/urls/tokens; Daily.co/Twilio/Jitsi integration is a drop-in
    replacement). Auto-provisions a room when a `telehealth`/`hybrid` booking is
    confirmed. Publishes `telehealth.room.{created,ended}`.
  - `platform/packages/` — prepaid session bundles ("10 sesiones por 400€") with
    balance tracking, validity expiry, automatic redemption on `booking.completed`
    and refund on `booking.cancelled` / `booking.no_show`. Publishes
    `package.{purchased,exhausted}`.
  - `platform/practitioner-payouts/` — commission rules per (practitioner, service),
    accruals on `booking.completed` (split evenly across attached practitioner
    resources), reversals on cancellation/no_show, periodic close into `payouts`.
    Publishes `payout.{created,paid}`.
  - `infra/postgres/init/01_platform_schemas.sql` — 8 new schemas + 8 dedicated roles.
  - `infra/nginx/snippets/platform-routes.conf` — 8 new `location /api/<module>/`
    blocks proxying to a new `platform_appointments` upstream.
  - `infra/nginx/conf.d/upstream.conf` — new `upstream platform_appointments`.
  - `docker-compose.yml` — new `platform-appointments` service with per-module
    `DATABASE_URL_*` + JWT secret + volume mounts for the 8 modules.
  - `.env.example` — 8 `SVC_PLATFORM_<MODULE>_DB_PASSWORD` entries.

- **`platform-restaurant` container + 6 restaurant modules** — third monolith container
  (port 3200) hosting **menu, reservations, floor-plan, kds, pos, delivery-dispatch**.
  Same modular-monolith pattern as `platform-core` / `platform-marketplace`: per-module
  schema + dedicated DB role, in-process module loading, shared `PLATFORM_JWT_SECRET` so
  JWTs are accepted across all three containers, cross-container communication via Redis
  events on `platform.events`. See [ADR 005](docs/adr/005-platform-restaurant-monolith.md).
  - `platform/restaurant/` — orchestrator (`server.js`, `Dockerfile`, env)
  - `platform/menu/` — F&B menu: course types, modifiers, allergens, availability
    windows, 86-list. Publishes `menu.item.eighty_sixed`, `menu.published`.
  - `platform/reservations/` — reservations + waitlist + service hours + blackouts.
    Publishes `reservation.{created,confirmed,seated,cancelled,no_show}`,
    `waitlist.{added,notified}`.
  - `platform/floor-plan/` — sections, tables, status FSM (free → reserved → occupied →
    dirty → free), table combine. Publishes `table.{seated,cleared,combined}`.
  - `platform/kds/` — Kitchen Display System. Stations route by course; tickets fired on
    `order.paid` / `pos.bill.paid`; FSM fired → in_progress → ready → picked_up.
    Publishes `kds.ticket.{fired,acked,ready,picked_up}`.
  - `platform/pos/` — open table bills, line items, split bill (equal / percent / amounts),
    tips, mixed payments. Publishes `pos.bill.{opened,split,paid,closed}`.
  - `platform/delivery-dispatch/` — delivery zones, riders + GPS pings, deliveries with
    carrier (own / glovo / uber / etc.). Subscribes `order.paid` to auto-create deliveries.
    Publishes `delivery.{created,dispatched,picked_up,delivered}`.
  - `infra/postgres/init/01_platform_schemas.sql` — 6 new schemas + 6 dedicated roles.
  - `infra/nginx/snippets/platform-routes.conf` — 6 new `location /api/<module>/` blocks
    proxying to the new `platform_restaurant` upstream.
  - `infra/nginx/conf.d/upstream.conf` — new `upstream platform_restaurant`.
  - `docker-compose.yml` — new `platform-restaurant` service with per-module DATABASE_URL_*.
  - `.env.example` — 6 `SVC_PLATFORM_<MODULE>_DB_PASSWORD` entries.

### Changed
- **`catalog` and `basket` folded into `platform-marketplace`** — both modules
  were previously standalone Docker containers (`platform-catalog:3003`,
  `platform-basket:3004`). They are now in-process modules of `platform-marketplace`,
  consistent with orders/inventory/reviews/messaging/shipping/disputes.
  - Refactored `platform/catalog/src/lib/{db,redis,migrate}.js` to the lazy + configurable pattern
  - Refactored `platform/basket/src/lib/redis.js` (no DB; basket exports a no-op `runMigrations`)
  - Both modules now export `register({app, db?, redis})` + `runMigrations(superuserUrl?)`
  - `platform/marketplace/src/server.js` handles modules without `databaseUrl` (basket: no Pool)
  - `docker-compose.yml`: removed `platform-catalog` and `platform-basket` services; added
    `DATABASE_URL_CATALOG` env + catalog/basket volume mounts to `platform-marketplace`
  - `infra/nginx/conf.d/upstream.conf`: removed `platform_catalog` and `platform_basket` upstreams
  - `infra/nginx/snippets/platform-routes.conf`: `/api/catalog/` and `/api/basket/` now proxy
    to `platform_marketplace`
  - Catalog now uses dedicated DB role `svc_platform_catalog` (was sharing `splitpay:splitpay`)

### Added
- **`platform-marketplace` container + 6 marketplace modules** — new monolith container
  (port 3100) hosting **orders, inventory, reviews, messaging, shipping, disputes**.
  Mirror architecture of `platform-core`: per-module schema + dedicated DB role,
  in-process module loading, shared `PLATFORM_JWT_SECRET` so JWTs are accepted across both
  containers, cross-container communication via Redis events on `platform.events`.
  See [ADR 004](docs/adr/004-domain-separated-monolith-containers.md).
  - `platform/marketplace/` — orchestrator (`server.js`, `Dockerfile`, env)
  - `platform/{orders,inventory,reviews,messaging,shipping,disputes}/` — the 6 modules,
    each with own `register({app,db,redis})` and `runMigrations(superuserUrl)`
  - `infra/postgres/init/01_platform_schemas.sql` — 6 new schemas + 6 dedicated roles
  - `infra/nginx/snippets/platform-routes.conf` — 6 new `location /api/<module>/` blocks
    proxying to `platform_marketplace` upstream
  - `infra/nginx/conf.d/upstream.conf` — new `upstream platform_marketplace`
  - `docker-compose.yml` — new `platform-marketplace` service with per-module DATABASE_URL_*
  - Event flow demonstrated end-to-end: `order.created` → inventory reserves stock,
    `order.paid` → inventory commits + shipping creates shipment, `shipping.shipment.delivered`
    → orders advances to `delivered`, `splitpay.chargeback.created` → disputes escalates.

- **`scripts/bootstrap.sh`** — first-boot bootstrap of an empty platform.
  Creates the first super_admin user (`POST /v1/auth/register`), verifies
  login, and registers the `platform` app in the registry. Idempotent.
  Required after a fresh `docker compose up` (or any DB wipe) so staff can
  log in to console.
  - Full reference: [`docs/runbooks/platform-bootstrap.md`](docs/runbooks/platform-bootstrap.md) (env vars,
    troubleshooting, wipe-and-restart workflow, design rationale)
  - Quick pointer in [`RUN.md`](RUN.md) § Option A → First-time bootstrap
- **Dynamic NGINX routing via Redis sidecar** — per-subdomain `server {}` blocks now live in
  the Redis hash `nginx:configs` instead of static files in `infra/nginx/conf.d/`. A sidecar
  inside the NGINX container polls Redis every 2s and reloads NGINX on change. Registering an
  app from console (`POST /v1/apps`) propagates routing to every NGINX replica
  without manual reload, host-side ops, or filesystem coordination. Cluster-friendly.
  See [ADR 003](docs/adr/003-dynamic-nginx-routing.md).
  - `infra/nginx/Dockerfile` — custom image: `nginx:alpine` + `redis-cli` + `tini`
  - `infra/nginx/{entrypoint,sidecar}.sh` — PID-1 entrypoint + reconciler
  - `infra/nginx/seed/*.conf` — seed configs (moved from `conf.d/`); used to populate Redis on first boot
  - `platform/tenant-config/src/services/nginx-config.service.js` — `writeAppNginxConfig` writes to Redis (`HSET` + `PUBLISH`)
  - `platform/tenant-config/src/services/apps.service.js` — calls `writeAppNginxConfig` after `INSERT INTO platform_tenants.apps`

### Added (preexisting)
- **`platform/auth` — OAuth 2.0 support (Google + Facebook)**
  - `migrations/0003_oauth_connections.sql` — `oauth_connections` table; `password_hash` made nullable
  - `src/repositories/oauth.repository.js` — provider lookup, email account linking, user creation
  - `src/services/oauth.service.js` — Google id_token verification (`google-auth-library`), Facebook Graph API token validation
  - `src/routes/oauth.routes.js` — `POST /v1/auth/oauth/google`, `POST /v1/auth/oauth/facebook`

- **`platform/notifications` — email sending**
  - `src/services/email.service.js` — Resend in production; console log fallback in development
  - `src/services/event-consumer.js` — Redis subscriber on `platform:events`; handles `user.registered` (welcome email) and `auth.password_reset_requested` (reset email)

- **`apps/aikikan/aikikan-portal` — login UI wired to real API**
  - `src/lib/auth.js` — `login`, `register`, `loginGoogle`, `loginFacebook`, `forgotPassword` helpers
  - `Login.jsx` — connected to platform-auth endpoints; Google via `@react-oauth/google`; loading/error/success states

### Changed
- **Schema isolation** — `platform-auth` and `platform-notifications` now connect at runtime with
  their own dedicated DB roles (`svc_platform_auth`, `svc_platform_notifications`) instead of the
  shared superuser. `migrate.js` in both services uses `MIGRATION_DATABASE_URL` for DDL.
- `docker-compose.yml` — updated `DATABASE_URL` + added `MIGRATION_DATABASE_URL` for platform-auth
  and platform-notifications; added OAuth and VITE env vars for aikikan-portal
- `.env.example` — added `PLATFORM_AUTH_DATABASE_URL`, `PLATFORM_NOTIFICATIONS_DATABASE_URL`,
  `MIGRATION_DATABASE_URL`, `GOOGLE_CLIENT_ID`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `AIKIKAN_TENANT_ID`

---

### Added (Yoga Studio PM2 single-container consolidation)
- **Yoga Studio PM2 single-container consolidation**
  - `apps/yoga-studio/Dockerfile` — one image for all yoga processes
  - `apps/yoga-studio/ecosystem.config.cjs` — PM2 process definitions for yoga-users,
    yoga-classes, yoga-bookings, yoga-bonuses, yoga-reporting, yoga-portal
  - Single `yoga-studio` Docker service replaces the previous 6 separate containers
  - Internal service calls use `http://localhost:<port>` instead of Docker hostnames

### Changed
- `docker-compose.yml` — replaced yoga-users, yoga-classes, yoga-bookings, yoga-bonuses,
  yoga-reporting, yoga-portal services with a single `yoga-studio` service
- `infra/nginx/conf.d/upstream.conf` — all yoga upstream servers now point to `yoga-studio`
  hostname on their respective ports
- `YOGA_BONUSES_INTERNAL_URL` and `YOGA_CLASSES_INTERNAL_URL` changed from Docker hostnames
  to `http://localhost` URLs

---

### Added (platform restructure)
- **AppHub multi-app platform restructure**
  - `platform/` shared microservices: auth (3000), payments (3001), notifications (3002),
    catalog (3003), basket (3004), tenant-config (3005)
  - `packages/platform-sdk/` — internal shared library: `app-guard.js`, `db.js`,
    `errors.js`, `logger.js`, `redis.js`
  - Three-claim JWT identity: `app_id` + `tenant_id` + `sub_tenant_id`
  - `appGuard` plugin with `EXPECTED_APP_ID` enforcement — returns `403 APP_MISMATCH`
    on cross-app token use
  - `setTenantContext` sets all three PostgreSQL RLS session vars (`app.app_id`,
    `app.tenant_id`, `app.sub_tenant_id`)
  - NGINX `conf.d/` subdomain routing pattern: `portal.conf`, `yoga.conf`, `splitpay.conf`
  - `infra/nginx/snippets/platform-routes.conf` — shared include for platform locations
  - `apps/split-pay/splitpay-portal/` — React 18 + Vite + Tailwind frontend (port 5175)
  - `apps/split-pay/splitpay-core/` — Stripe Connect service (port 3020, was services/split-payments port 3001)
  - `apps/__app-template__/` — blueprint for bootstrapping new apps (`__app__` placeholder)
  - PostgreSQL init: `01_platform_schemas.sql`, `02_splitpay_core_schema.sql`
  - Subdomain aliases for local dev: `hulkstein.local`, `yoga.hulkstein.local`, `splitpay.hulkstein.local`

### Changed
- `pnpm-workspace.yaml` — added `platform/*`, `apps/split-pay/*`, `apps/__app-template__/*`
- `docker-compose.yml` — added all platform service containers and split-pay containers
- `.env.example` — added `PLATFORM_JWT_SECRET`, `PLATFORM_STRIPE_*`, `SPLITPAY_STRIPE_*`
- All `.md` documentation updated for the new AppHub multi-app platform architecture

### Removed
- `services/split-payments/` — moved to `apps/split-pay/splitpay-core/`
- `services/` directory (now empty after migration)

---

### Added (previous)
- Initial monorepo structure with pnpm workspaces and Turborepo
- `split-payments` microservice v0.1.0
  - Stripe Connect account onboarding (hosted KYC flow)
  - Payment Intent creation with automatic split via `transfer_data` and `application_fee_amount`
  - Multi-beneficiary splits via Stripe Transfers
  - Split rule templates (named, reusable, assignable to tenants)
  - Payout schedule configuration per merchant
  - Refund endpoint with proportional Transfer reversal
  - Dispute management with evidence upload
  - Webhook listener with signature verification
  - Real-time split simulator endpoint
  - Row-level security by `tenant_id` + `sub_tenant_id`
  - Redis idempotency keys for all Stripe calls
  - Full unit test coverage for split engine and services
- Yoga Studio app (`apps/yoga-studio/`):
  - `yoga-portal` — React 18 + Vite + Tailwind frontend (port 5174)
  - `yoga-users` — user profiles service (port 3011)
  - `yoga-classes` — class catalogue and scheduling service (port 3012)
  - `yoga-bookings` — bookings and waiting list service (port 3013)
  - `yoga-bonuses` — credit and bonus management service (port 3014)
  - `yoga-reporting` — metrics and reporting service (port 3017)
  - Redis Pub/Sub event bus (`yoga-studio.events` channel)
  - 238 Vitest tests across all yoga services
- AppHub admin portal (`apps/portal/`, port 5173)
- Docker Compose for local development
- PostgreSQL 16 with per-service schemas and migrations
- Redis 7 for caching and event bus
- Nginx API gateway configuration
- Root documentation: CLAUDE, CONVENTIONS, CONTRIBUTING, DEVELOPMENT, ARCHITECTURE, RUN, CHANGELOG
