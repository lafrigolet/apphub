# Casos de uso por microservicio — catálogo de funcionalidad

Este directorio contiene, **un fichero por microservicio/módulo de plataforma**, la enumeración
exhaustiva de casos de uso del dominio de ese módulo —estén implementados o no—, con el fin de
detectar funcionalidad futura deseable en la plataforma AppHub.

## Formato

Cada fichero sigue la misma estructura (plantilla canónica: [`leads.md`](leads.md)):

1. **Dominio** — qué problema resuelve el módulo.
2. **Estado actual (implementado)** — resumen de lo que existe hoy (verificado contra el código).
3. **Secciones temáticas numeradas** con casos de uso marcados:
   - ✅ implementado · 🔧 parcial · ❌ no implementado
4. **Recomendaciones de priorización** — qué construir a continuación (valor / coste).

## Índice por contenedor

### platform-core (puerto 3000) — infraestructura horizontal

- [auth](auth.md) — autenticación e identidad (login, OAuth, JWT, roles, MFA, SSO…)
- [payments](payments.md) — pagos Stripe (🔧 skeleton)
- [notifications](notifications.md) — email / SMS / push / in-app
- [tenant-config](tenant-config.md) — registro de apps y tenants, feature flags
- [splitpay](splitpay.md) — Stripe Connect / split payments
- [storage](storage.md) — objetos S3/MinIO, presigned URLs
- [leads](leads.md) — captación de prospectos global + CRM *(plantilla canónica)*
- [donations](donations.md) — donaciones + fiscalidad (Ley 49/2002, AEAT 182)
- [inquiries](inquiries.md) — formulario de contacto por-tenant
- [verifactu](verifactu.md) — facturación verificable AEAT Veri*Factu (🔧 skeleton)
- [chat](chat.md) — chat de miembros + gateway WebSocket

### platform-marketplace (puerto 3100) — transacciones marketplace

- [orders](orders.md) — ledger de pedidos
- [inventory](inventory.md) — stock por SKU
- [reviews](reviews.md) — reseñas verificadas + respuestas
- [messaging](messaging.md) — mensajería buyer ↔ vendor
- [shipping](shipping.md) — envíos (zonas, tarifas, tracking)
- [disputes](disputes.md) — disputas operacionales pre-chargeback
- [catalog](catalog.md) — catálogo producto/servicio
- [basket](basket.md) — carrito de compra (Redis-only)

### platform-restaurant (puerto 3200) — operaciones restaurante

- [menu](menu.md) — carta F&B (modifiers, alérgenos, 86-list)
- [reservations](reservations.md) — reservas de mesa + waitlist
- [floor-plan](floor-plan.md) — plano de sala / mesas / secciones
- [kds](kds.md) — Kitchen Display System
- [pos](pos.md) — TPV (cuentas, split, propinas, pagos mixtos)
- [delivery-dispatch](delivery-dispatch.md) — reparto last-mile (riders, GPS, flota)

### platform-appointments (puerto 3300) — citas / scheduling

- [services](services.md) — catálogo de servicios reservables
- [resources](resources.md) — practitioners, salas, equipos, horarios
- [bookings](bookings.md) — FSM de cita, recurrencia, reschedule, waitlist
- [availability](availability.md) — motor de slots + holds atómicos Redis
- [intake-forms](intake-forms.md) — cuestionarios pre-cita + firmas
- [telehealth](telehealth.md) — videoconsulta (salas + tokens)
- [packages](packages.md) — bonos prepago (saldo + caducidad)
- [practitioner-payouts](practitioner-payouts.md) — comisiones, devengos, cierre periódico

### platform-scheduler (puerto 3400) — cron single-runner

- [scheduler](scheduler.md) — cron-as-a-service, jobs, advisory locks, eventos

### platform-tpv (puerto 3500) — operaciones de punto de venta

- [tpv](tpv.md) — TPV genérico: dispositivos, sesiones de caja, efectivo, recibos correlativos, abonos, informes X/Z, Veri*Factu ([ADR 015](../adr/015-platform-tpv-monolith.md))

---

> **Nota:** El "Estado actual" de cada fichero refleja una inspección del código en el momento
> de su redacción. Al implementar nueva funcionalidad, re-verifica el estado contra el código y
> actualiza el ✅/🔧/❌ correspondiente.
