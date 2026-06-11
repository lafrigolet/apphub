# TPV — Tap to Pay (Expo)

App nativa para usar el **móvil como TPV**: teclado (con tecla **"00"**) para introducir un
importe y cobrar **acercando la tarjeta del cliente al móvil del cajero** (Stripe Tap to Pay).

> **Por qué es app nativa y no web**: "acercar la tarjeta al móvil" = NFC/EMV contactless =
> Stripe Tap to Pay, que **solo existe en SDK nativo** (iOS/Android/React Native). El
> navegador no expone el lector EMV ni pasa la atestación de dispositivo, así que **ni web
> ni PWA pueden hacerlo**. Ver `docs/adr/` (decisión) y la conversación de diseño.

## Piezas

- **`tpv-app/`** — app **Expo** (React Native) con **Tap to Pay** (acercar tarjeta al móvil).
  *Fuera del pnpm workspace* (install propio) para no chocar con el hoisting de Expo+pnpm.
  No se despliega en Docker.
- **`tpv-portal/`** — **portal web** (Vite/React) servido en `tpv.hulkstein.local` por el
  contenedor `portals` (puerto 5183, ADR 017). Teclado + **cobro por QR** (Stripe Checkout):
  el cliente paga en SU móvil escaneando el QR. Fallback sin Tap to Pay para cualquier navegador.
- **`seed.sql`** — registra el app `tpv`, un tenant de prueba, el cajero `cajero@tpv.local`
  y los **settings fiscales** del tenant (emisor + `auto_issue_simplified` + serie A) para que
  se emita el recibo (fase 2).
- **Backend** — `platform/payments` (módulo de platform-core):
  - Terminal: `POST /api/payments/terminal/{connection-token,intents}` (PaymentIntent `card_present`).
  - Checkout (web/QR): `POST /api/payments/checkout-sessions` (+ `GET /:id` para el estado).
  - Ambos los reconcilia el webhook; en `payment_intent.succeeded` / `checkout.session.completed`
    se emite `payment.succeeded` con `source` (`tap_to_pay` / `tpv_checkout`).
- **Recibo (fase 2)** — `platform/tpv` consume ese `payment.succeeded`
  (`services/payments-events.handler.js`): crea un `billing_fact` (IVA incluido al
  `default_sale_tax_rate` del tenant) y, con `auto_issue_simplified`, emite el ticket
  simplificado correlativo (numeración + snapshot + feed Veri*Factu).

## Target web — tpv.hulkstein.local

1. Stack arriba con claves Stripe **test** en console. Seed aplicado (`seed.sql`).
2. `/etc/hosts`: `127.0.0.1 tpv.hulkstein.local`.
3. `docker compose up -d --build portals nginx`.
4. Abrir `http://tpv.hulkstein.local:8080` → teclear importe (prueba **"00"**) → **Cobrar** →
   aparece el **QR** → el cliente lo escanea y paga en su móvil → al completarse, la pantalla
   pasa a **"Pagado ✅"** (polling) y `platform/tpv` emite el recibo.

## Puesta en marcha (modo test / reader simulado)

1. **Stack AppHub arriba** (gateway en `:8080`) con las claves Stripe **test** configuradas
   en console (módulo Payments). En modo test el SDK usa un **reader simulado** — sin hardware.

2. **Seed** del tenant/cajero de prueba (idempotente):
   ```bash
   docker compose exec -T postgres psql -U splitpay -d splitpay -f - < apps/tpv/seed.sql
   ```

3. **Instalar y construir la app** (necesita Node + toolchain Android/Xcode en tu máquina):
   ```bash
   cd apps/tpv/tpv-app
   npm install
   # Tap to Pay usa un módulo nativo → NO funciona en Expo Go. Hace falta dev client:
   npx expo prebuild
   npx expo run:android      # o: npx expo run:ios
   ```
   Si tu versión del SDK Terminal usa el naming nuevo (`tapToPay` en vez de `localMobile`),
   ajusta las dos llamadas marcadas `[API]` en `src/terminal.js`.

4. **Conectividad con el backend**: por defecto la app apunta a `http://10.0.2.2:8080`
   (emulador Android) / `http://localhost:8080` (simulador iOS). Para un **dispositivo
   físico**, exporta la IP LAN del host:
   ```bash
   EXPO_PUBLIC_API_BASE=http://192.168.1.50:8080 npx expo run:android
   ```

5. **Probar**: teclear un importe (prueba la tecla **"00"**: `12` + `00` = `12,00 €`) →
   **Cobrar** → el reader simulado completa el pago → pantalla **"Pagado ✅"**. La transacción
   queda en `platform_payments.transactions` (`metadata.source = tap_to_pay`).

## Tap físico (diferido)

Para el tap real con una tarjeta:
- **Tap to Pay habilitado** en la cuenta Stripe (puede requerir solicitar acceso).
- **Dispositivo compatible**: iPhone XS+ / iOS 16.4+, o Android 11+ con NFC y atestación.
- Cambiar `simulated: true → false` en `src/terminal.js` y construir un **dev client / EAS build**.

## Fuera de alcance V1

- Web en `tpv.hulkstein.local` (Expo web export + QR-Checkout fallback).
- Emisión de recibo fiscal en `platform/tpv` tras el cobro.
- Login real del cajero (hoy: login silencioso con credenciales dev de `seed.sql`).
