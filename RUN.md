# RUN.md — Cómo ejecutar la plataforma

## Índice

1. [Requisitos](#1-requisitos)
2. [Primera vez](#2-primera-vez)
3. [Variables de entorno](#3-variables-de-entorno)
4. [Arrancar sin claves de Stripe](#4-arrancar-sin-claves-de-stripe)
5. [Arrancar con Stripe en modo test](#5-arrancar-con-stripe-en-modo-test)
6. [Modos de ejecución](#6-modos-de-ejecución)
7. [Verificar que funciona](#7-verificar-que-funciona)
8. [Ejecutar los tests](#8-ejecutar-los-tests)
9. [Comandos frecuentes](#9-comandos-frecuentes)
10. [Resolución de problemas](#10-resolución-de-problemas)

---

## 1. Requisitos

| Herramienta | Versión mínima | Cómo instalar |
|---|---|---|
| Node.js | 20 LTS | https://nodejs.org o `nvm install 20` |
| Docker | 24+ | https://docs.docker.com/get-docker/ |
| Docker Compose | v2 (incluido con Docker Desktop) | — |
| pnpm | 9+ | `npm install -g pnpm@9` |

> **¿Qué es pnpm?** Es un gestor de paquetes para Node.js, igual que `npm`.
> Se usa aquí porque gestiona mejor los monorepos con múltiples paquetes.
> Si lo prefieres, puedes usar `npm` — ver sección [Usar npm en lugar de pnpm](#usar-npm-en-lugar-de-pnpm).

Verifica que tienes todo antes de continuar:

```bash
node --version    # debe mostrar v20.x.x o superior
docker --version  # debe mostrar Docker version 24.x.x o superior
pnpm --version    # debe mostrar 9.x.x o superior
```

---

## 2. Primera vez

```bash
# 1. Descomprime el proyecto
unzip splitpay-platform.zip
cd splitpay-platform

# 2. Instala las dependencias de todos los paquetes
pnpm install

# 3. Crea el fichero de variables de entorno
cp .env.example .env
```

Ahora edita `.env` con tus valores. Continúa en la sección siguiente.

---

## 3. Variables de entorno

El fichero `.env` en la raíz del proyecto contiene toda la configuración.
**Nunca lo subas a Git** — ya está incluido en `.gitignore`.

### Variables obligatorias

```bash
# Base de datos — los valores por defecto funcionan con docker-compose.yml
DATABASE_URL=postgresql://splitpay:splitpay@localhost:5432/splitpay

# Redis — el valor por defecto funciona con docker-compose.yml
REDIS_URL=redis://localhost:6379

# Secreto para firmar JWT — pon cualquier cadena larga y aleatoria
JWT_SECRET=cambia_esto_por_una_cadena_larga_y_aleatoria_minimo_32_caracteres

# Entorno
NODE_ENV=development
LOG_LEVEL=debug
```

### Variables de Stripe

```bash
PAYMENTS_STRIPE_SECRET_KEY=sk_test_...
PAYMENTS_STRIPE_PUBLISHABLE_KEY=pk_test_...
PAYMENTS_STRIPE_WEBHOOK_SECRET=whsec_...
```

> Ver sección [4](#4-arrancar-sin-claves-de-stripe) si no tienes claves de Stripe todavía,
> o sección [5](#5-arrancar-con-stripe-en-modo-test) para obtenerlas gratuitamente.

---

## 4. Arrancar sin claves de Stripe

Puedes arrancar la plataforma completamente sin tener cuenta en Stripe.
Solo necesitas que las claves tengan el formato correcto para pasar la validación de arranque.

Edita `.env` con estos placeholders:

```bash
PAYMENTS_STRIPE_SECRET_KEY=<your-stripe-test-secret-key>
PAYMENTS_STRIPE_PUBLISHABLE_KEY=pk_test_placeholder0000000000000000000
PAYMENTS_STRIPE_WEBHOOK_SECRET=<your-stripe-webhook-secret>
JWT_SECRET=desarrollo_local_pon_aqui_cualquier_cadena_de_32_chars
DATABASE_URL=postgresql://splitpay:splitpay@localhost:5432/splitpay
REDIS_URL=redis://localhost:6379
NODE_ENV=development
LOG_LEVEL=debug
```

### Qué funciona sin Stripe

| Endpoint | ¿Funciona? |
|---|---|
| `GET /health` | ✅ Sí |
| `GET /v1/split-rules` | ✅ Sí |
| `POST /v1/split-rules` | ✅ Sí |
| `DELETE /v1/split-rules/:id` | ✅ Sí |
| `POST /v1/split-rules/simulate` | ✅ Sí — lógica pura, no usa Stripe |
| `GET /v1/payments` | ✅ Sí |
| `GET /v1/payments/:id` | ✅ Sí |
| `POST /v1/payments` | ❌ Falla al crear PaymentIntent en Stripe |
| `POST /v1/payments/:id/refunds` | ❌ Falla al emitir reembolso en Stripe |
| `POST /v1/connect-accounts` | ❌ Falla al crear cuenta Connect en Stripe |
| `POST /v1/webhooks/stripe` | ❌ Rechaza eventos (firma inválida) |

Arranca con:

```bash
docker compose up -d postgres redis
pnpm --filter @splitpay/split-payments db:migrate
pnpm --filter @splitpay/split-payments dev
```

---

## 5. Arrancar con Stripe en modo test

### Obtener las claves (gratuito, sin datos bancarios)

1. Crea una cuenta gratuita en https://stripe.com
2. Ve a https://dashboard.stripe.com/test/apikeys
3. Copia la **Secret key** (`sk_test_...`) y la **Publishable key** (`pk_test_...`)
4. Pégalas en `.env`

### Configurar webhooks locales con la Stripe CLI

Para que Stripe pueda notificar a tu máquina local cuando ocurre un pago,
necesitas la Stripe CLI que crea un túnel temporal:

```bash
# Instala la Stripe CLI
# macOS:
brew install stripe/stripe-cli/stripe

# Windows (con scoop):
scoop install stripe

# Linux / manual: https://stripe.com/docs/stripe-cli#install

# Autentícate
stripe login

# Abre una terminal separada y déjala corriendo
stripe listen --forward-to localhost:3001/v1/webhooks/stripe
```

La Stripe CLI imprimirá algo así:

```
> Ready! Your webhook signing secret is whsec_abc123def456...
```

Copia ese valor y ponlo en `.env`:

```bash
PAYMENTS_STRIPE_WEBHOOK_SECRET=whsec_abc123def456...
```

> La Stripe CLI debe estar corriendo en su propia terminal mientras desarrollas.
> Si la cierras, los webhooks dejarán de llegar aunque el servicio siga activo.

---

## 6. Modos de ejecución

### Opción A — Solo el servicio (recomendado para desarrollo)

Infraestructura (PostgreSQL + Redis) gestionada por Docker,
servicio corriendo directamente en tu máquina con recarga automática al guardar:

```bash
# Terminal 1 — infraestructura
docker compose up -d postgres redis

# Ejecuta las migraciones (solo la primera vez o tras añadir migraciones)
pnpm --filter @splitpay/split-payments db:migrate

# Terminal 2 — servicio con hot reload
pnpm --filter @splitpay/split-payments dev

# Terminal 3 — webhooks de Stripe (opcional, solo si tienes claves)
stripe listen --forward-to localhost:3001/v1/webhooks/stripe
```

### Opción B — Todo con Docker Compose

Todo corre dentro de Docker, incluyendo el servicio:

```bash
# Construye las imágenes y arranca todo
docker compose up -d

# Ejecuta las migraciones dentro del contenedor
docker compose exec split-payments pnpm db:migrate

# Sigue los logs
docker compose logs -f split-payments
```

> En este modo no hay hot reload. Cada cambio en el código requiere
> reconstruir la imagen: `docker compose up -d --build split-payments`

### Opción C — Solo las migraciones y los tests (sin arrancar el servicio)

```bash
docker compose up -d postgres redis
pnpm --filter @splitpay/split-payments db:migrate
pnpm --filter @splitpay/split-payments test
```

### Usar npm en lugar de pnpm

Si prefieres no instalar pnpm, puedes usar npm directamente dentro del servicio:

```bash
docker compose up -d postgres redis

cd services/split-payments
npm install
npm run db:migrate
npm run dev
```

---

## 7. Verificar que funciona

Una vez arrancado el servicio, prueba estos endpoints:

### Health check (sin autenticación)

```bash
curl http://localhost:3001/health
```

Respuesta esperada:

```json
{
  "status": "ok",
  "service": "split-payments",
  "timestamp": "2025-04-12T10:00:00.000Z"
}
```

### A través del gateway Nginx (si está arrancado)

```bash
curl http://localhost:8080/health
```

### Crear una regla de split (requiere token JWT)

Para los endpoints protegidos necesitas un JWT con `tenant_id` en el payload.
En desarrollo puedes generar uno manualmente con esta línea de Node:

```bash
node -e "
const p = Buffer.from(JSON.stringify({
  tenant_id: 'tenant-test-001',
  sub_tenant_id: null,
  exp: 9999999999
})).toString('base64url');
console.log('Bearer header.' + p + '.sig');
"
```

Copia el resultado y úsalo como cabecera `Authorization`:

```bash
curl -X POST http://localhost:3001/v1/split-rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer header.eyJ0ZW5hbnRfaWQi..." \
  -d '{
    "name": "Marketplace estándar",
    "platformFeePercent": 15,
    "recipients": [
      { "accountId": "acct_test_merchant", "label": "Comercio", "percentage": 85 }
    ]
  }'
```

### Simulador de split (no llama a Stripe)

```bash
curl -X POST http://localhost:3001/v1/split-rules/simulate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer header.eyJ0ZW5hbnRfaWQi..." \
  -d '{
    "splitRuleId": "<id-de-la-regla-creada>",
    "amount": 10000,
    "currency": "eur"
  }'
```

Respuesta esperada (muestra cómo se distribuiría un pago de 100€):

```json
{
  "data": {
    "grossAmount": 10000,
    "currency": "eur",
    "stripeFee": 320,
    "netAmount": 9680,
    "platformFee": 1452,
    "recipients": [
      {
        "label": "Comercio",
        "accountId": "acct_test_merchant",
        "percentage": 85,
        "amount": 8228
      }
    ]
  }
}
```

### Prototipo de frontend

Abre directamente en el navegador (no requiere que el servicio esté corriendo):

```
services/split-payments/docs/splitpay-prototype.html
```

---

## 8. Ejecutar los tests

Los tests no necesitan Stripe ni Redis activos — todas las dependencias externas
están mockeadas.

```bash
# Todos los tests
pnpm --filter @splitpay/split-payments test

# Con informe de cobertura (genera un HTML en services/split-payments/coverage/)
pnpm --filter @splitpay/split-payments test:coverage

# Modo watch — re-ejecuta al guardar cambios
pnpm --filter @splitpay/split-payments test:watch

# Solo los tests unitarios
pnpm --filter @splitpay/split-payments test tests/unit

# Solo los tests de integración de la API
pnpm --filter @splitpay/split-payments test tests/integration
```

Ver el informe de cobertura en el navegador:

```bash
open services/split-payments/coverage/index.html   # macOS
xdg-open services/split-payments/coverage/index.html  # Linux
```

---

## 9. Comandos frecuentes

### Gestión del servicio

```bash
# Arrancar solo la infraestructura
docker compose up -d postgres redis

# Arrancar todo (infra + servicio)
docker compose up -d

# Parar todo
docker compose down

# Parar todo y borrar los datos de la BD (reset completo)
docker compose down -v

# Ver logs en tiempo real
docker compose logs -f split-payments

# Reiniciar solo el servicio
docker compose restart split-payments

# Reconstruir la imagen tras cambios en Dockerfile
docker compose up -d --build split-payments
```

### Base de datos

```bash
# Ejecutar migraciones pendientes
pnpm --filter @splitpay/split-payments db:migrate

# Conectar a PostgreSQL directamente
docker compose exec postgres psql -U splitpay -d splitpay

# Ver las tablas del schema de pagos
docker compose exec postgres psql -U splitpay -d splitpay \
  -c "\dt payments.*"

# Ver las migraciones aplicadas
docker compose exec postgres psql -U splitpay -d splitpay \
  -c "SELECT * FROM payments.migrations ORDER BY applied_at;"
```

### Monorepo

```bash
# Instalar dependencias de todos los paquetes
pnpm install

# Comprobar tipos TypeScript en todo el monorepo
pnpm typecheck

# Linting en todo el monorepo
pnpm lint

# Tests en todo el monorepo
pnpm test

# Limpiar builds y node_modules
pnpm clean
```

---

## 10. Resolución de problemas

### El servicio no arranca: "Invalid environment variables"

El fichero `.env` tiene claves con formato incorrecto o faltan variables.
Asegúrate de que:
- `PAYMENTS_STRIPE_SECRET_KEY` empieza por `sk_test_` o `sk_live_`
- `PAYMENTS_STRIPE_PUBLISHABLE_KEY` empieza por `pk_test_` o `pk_live_`
- `PAYMENTS_STRIPE_WEBHOOK_SECRET` empieza por `whsec_`
- `JWT_SECRET` tiene al menos 32 caracteres

Si no tienes claves de Stripe, usa los placeholders de la [sección 4](#4-arrancar-sin-claves-de-stripe).

### Error: "connection refused" al arrancar

PostgreSQL o Redis no están listos todavía. Espera unos segundos y verifica:

```bash
docker compose ps
# Ambos deben mostrar "healthy"
```

Si no muestran `healthy` después de 30 segundos:

```bash
docker compose logs postgres
docker compose logs redis
```

### Error: "relation does not exist"

Las migraciones no se han ejecutado. Córrelas:

```bash
pnpm --filter @splitpay/split-payments db:migrate
```

### Puerto 3001 ya en uso

```bash
# macOS / Linux
lsof -ti:3001 | xargs kill

# Windows (PowerShell)
Get-Process -Id (Get-NetTCPConnection -LocalPort 3001).OwningProcess | Stop-Process
```

### Webhooks con error 400 "INVALID_SIGNATURE"

El valor de `PAYMENTS_STRIPE_WEBHOOK_SECRET` en `.env` no coincide con
el que imprimió `stripe listen`. Pasos:

1. Para el proceso `stripe listen` con `Ctrl+C`
2. Vuelve a ejecutarlo: `stripe listen --forward-to localhost:3001/v1/webhooks/stripe`
3. Copia el nuevo `whsec_...` que imprime
4. Actualiza `.env`
5. Reinicia el servicio: `pnpm --filter @splitpay/split-payments dev`

### pnpm no reconocido

```bash
npm install -g pnpm@9
```

Si no quieres instalar pnpm, usa npm directamente dentro del directorio
del servicio como se describe en la [sección 6](#usar-npm-en-lugar-de-pnpm).

### Los tests fallan con "Cannot find module"

```bash
pnpm install
```

Si sigue fallando:

```bash
pnpm clean
pnpm install
pnpm --filter @splitpay/split-payments test
```
