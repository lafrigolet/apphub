# Historias de Usuario — Panel de Administración de Tenants

**Producto**: Voragine Platform
**Módulo**: Panel de administración de tenants (back-office)
**Épicas cubiertas**: Épica 1 (Ciclo de vida del tenant) y Épica 3 (Gestión de administradores)
**Versión**: 1.0
**Fecha**: 2026-04-21

---

## 1. Roles identificados

### 1.1 Staff de Plataforma
Empleado de Voragine con acceso al back-office global. Opera de forma transversal sobre todos los tenants de la plataforma.

- **Ámbito**: global (no está vinculado a un `tenant_id` concreto).
- **Permisos clave**: crear tenants, asignar el owner inicial, suspender, reactivar, archivar, restaurar, consultar el audit log global, gestionar el propio staff de la plataforma.
- **Autenticación**: SSO corporativo + 2FA obligatorio.

### 1.2 Tenant Owner
Propietario legal/operativo de un tenant. Existe **exactamente un Owner por tenant**.

- **Ámbito**: el `tenant_id` del que es propietario.
- **Permisos clave**: todos los permisos de Admin + transferir la propiedad + cambiar roles de otros admins + solicitar archivado del tenant.
- **Restricciones**: no puede eliminar su propia cuenta sin antes transferir la propiedad.

### 1.3 Tenant Admin
Administrador operativo dentro de un tenant. Pueden existir **varios Admins por tenant**.

- **Ámbito**: el `tenant_id` al que pertenece.
- **Permisos clave**: configurar el tenant, invitar y revocar a otros Admins, consultar operaciones.
- **Restricciones**: **no** puede modificar al Owner, **no** puede transferir la propiedad, **no** puede archivar el tenant.

### Matriz resumen de permisos

| Acción | Staff | Owner | Admin |
|---|:---:|:---:|:---:|
| Crear tenant | ✅ | ❌ | ❌ |
| Editar datos del tenant | ✅ | ✅ | ✅ (campos limitados) |
| Suspender / reactivar tenant | ✅ | ❌ | ❌ |
| Archivar tenant | ✅ | ✅ (con confirmación) | ❌ |
| Restaurar tenant archivado | ✅ | ❌ | ❌ |
| Invitar Admin | ❌ | ✅ | ✅ |
| Revocar Admin | ❌ | ✅ | ✅ |
| Cambiar rol de Admin | ❌ | ✅ | ❌ |
| Transferir propiedad | ❌ | ✅ | ❌ |
| Ver audit log del tenant | ✅ | ✅ | ✅ (lectura) |
| Ver audit log global | ✅ | ❌ | ❌ |

---

## Épica 1 — Gestión del ciclo de vida del tenant

> **Como** plataforma SaaS multi-tenant,
> **queremos** que el Staff y los Owners puedan crear, mantener, suspender, archivar y restaurar tenants de forma controlada y trazable,
> **para** garantizar la continuidad operativa del servicio, el cumplimiento regulatorio (RGPD) y una administración profesional del ciclo de vida de cada cliente.

---

### HU-1.1 — Alta de un nuevo tenant

**Como** Staff de Plataforma
**Quiero** dar de alta un nuevo tenant indicando sus datos identificativos, plan y Owner inicial
**Para** incorporar un nuevo cliente a la plataforma con una configuración de partida válida y lista para operar.

**Criterios de aceptación**

1. Dado un formulario de alta, cuando el Staff rellena: nombre comercial, razón social, país, identificador fiscal (CIF/VAT), email de contacto, plan contratado y email del Owner inicial, entonces el sistema crea el tenant con estado `ACTIVE` y `tenant_id` generado como UUID v4.
2. El sistema genera automáticamente un `slug` a partir del nombre comercial y asigna el subdominio `<slug>.voragine.app`. Si el slug ya existe, se propone un sufijo numérico hasta encontrar uno libre.
3. El sistema envía un email de invitación al Owner con un enlace firmado (JWT de un solo uso) con expiración de **72 horas**.
4. El identificador fiscal se valida con formato específico por país; si es inválido, se muestra error en línea y no se crea el tenant.
5. El email del Owner se valida con formato RFC 5322 y no puede estar ya asignado como Owner de otro tenant activo.
6. Si cualquier paso falla (envío de email, error de BD, colisión de slug irresoluble), la operación es transaccional: no se persiste un tenant a medio crear.
7. El tenant nace con `sub_tenant_id = NULL` y con el modo sub-tenancy **deshabilitado** por defecto.
8. La acción queda registrada en el audit log con: `actor_id` (Staff), `tenant_id` creado, timestamp UTC, IP de origen y payload anonimizado (sin PII sensible).
9. Solo los usuarios con rol Staff pueden acceder al endpoint de alta; cualquier otro rol recibe `403 Forbidden`.

---

### HU-1.2 — Editar datos del tenant

**Como** Staff de Plataforma o Tenant Owner/Admin
**Quiero** modificar los datos identificativos y de contacto del tenant
**Para** mantener la información actualizada ante cambios de razón social, sede, contacto, etc.

**Criterios de aceptación**

1. El Staff puede editar **todos** los campos del tenant.
2. El Owner y Admin pueden editar únicamente: nombre comercial, email de contacto, teléfono, dirección y logo.
3. Los campos **razón social, identificador fiscal y país** solo pueden ser modificados por Staff, ya que impactan KYC y facturación.
4. El cambio de subdominio queda fuera del alcance de esta HU (se tratará en la Épica 4 de dominios).
5. Toda modificación genera una entrada en el audit log con diff de campos antes/después.
6. El Owner no puede editar datos de un tenant del que no es propietario (RLS aplicado).
7. Los cambios se validan con el mismo esquema Zod que en el alta; un dato inválido bloquea el guardado completo.
8. Tras un cambio exitoso, el sistema notifica al Owner por email si el cambio fue realizado por Staff.

---

### HU-1.3 — Listar tenants con búsqueda y filtros

**Como** Staff de Plataforma
**Quiero** consultar el listado de todos los tenants con búsqueda y filtros
**Para** localizar rápidamente un tenant y tener visión global del estado de la cartera.

**Criterios de aceptación**

1. El listado muestra: nombre comercial, subdominio, plan, estado (`ACTIVE`, `SUSPENDED`, `ARCHIVED`), fecha de alta y nº de administradores.
2. Permite buscar por nombre comercial, razón social, identificador fiscal, subdominio o email del Owner.
3. Permite filtrar por estado, plan, país y rango de fecha de alta.
4. Permite ordenar por fecha de alta, nombre o volumen de transacciones.
5. La paginación es cursor-based con `limit` por defecto 20 y máximo 100.
6. Solo Staff puede acceder; otros roles reciben `403 Forbidden`.
7. Los resultados respetan el formato estándar de la API: `{ "data": [...], "next_cursor": "..." }`.
8. La consulta responde en menos de **500 ms** con hasta 10.000 tenants en BD (índices en `status`, `plan_id`, `created_at`).

---

### HU-1.4 — Ver ficha 360º de un tenant

**Como** Staff de Plataforma
**Quiero** ver una ficha completa de un tenant con toda su información relevante
**Para** diagnosticar incidencias, dar soporte y tomar decisiones operativas.

**Criterios de aceptación**

1. La ficha muestra las secciones: **Identificación** (datos fiscales), **Estado** (estado actual, fechas de cambio), **Dominios** (subdominio, dominio custom si existe), **Stripe Connect** (estado KYC, cuenta vinculada), **Administradores** (Owner + lista de Admins), **Plan y uso** (plan actual, consumos del mes), **Audit log** (últimas 20 acciones).
2. Cada sección carga de forma independiente (skeletons durante la carga) para no bloquear el render completo.
3. Los datos sensibles (secret keys, tokens) se muestran enmascarados por defecto con opción de revelar tras confirmación.
4. La ficha incluye botones de acciones rápidas contextuales al estado actual: Suspender (si ACTIVE), Reactivar (si SUSPENDED), Archivar (si ACTIVE o SUSPENDED), Restaurar (si ARCHIVED).
5. Solo Staff puede ver la ficha completa; el Owner ve una versión reducida (sin secciones de facturación interna de Voragine ni audit log global).

---

### HU-1.5 — Suspender un tenant

**Como** Staff de Plataforma
**Quiero** suspender temporalmente un tenant
**Para** bloquear su operativa ante impagos, incidentes de seguridad o incumplimiento de términos, sin perder sus datos.

**Criterios de aceptación**

1. Al suspender un tenant, su estado cambia a `SUSPENDED` y todas las llamadas a la API desde ese tenant devuelven `403 Tenant Suspended` con código de error `TENANT_SUSPENDED`.
2. La suspensión requiere indicar un **motivo** (enum: `NON_PAYMENT`, `SECURITY_INCIDENT`, `TOS_VIOLATION`, `MANUAL_REVIEW`, `OTHER`) y una nota libre.
3. Los webhooks salientes del tenant se pausan (no se entregan ni se reintentan mientras esté suspendido).
4. Las transacciones de Stripe ya iniciadas **no** se cancelan; solo se bloquean nuevas.
5. El Owner recibe un email inmediato con el motivo de la suspensión y un punto de contacto.
6. La acción se registra en el audit log con actor, motivo, nota y timestamp.
7. Solo Staff puede ejecutar la acción.
8. Un tenant ya `SUSPENDED` o `ARCHIVED` no puede volver a suspenderse; el endpoint devuelve `409 Conflict`.

---

### HU-1.6 — Reactivar un tenant suspendido

**Como** Staff de Plataforma
**Quiero** reactivar un tenant previamente suspendido
**Para** restaurar su operativa una vez resuelto el motivo de la suspensión.

**Criterios de aceptación**

1. Solo tenants en estado `SUSPENDED` pueden reactivarse; cualquier otro estado devuelve `409 Conflict`.
2. Tras la reactivación, el estado pasa a `ACTIVE` y la API vuelve a aceptar peticiones del tenant.
3. Los webhooks salientes se reanudan; los eventos acumulados durante la suspensión **no** se reintentan automáticamente (el Owner debe solicitarlo explícitamente si lo necesita).
4. La reactivación requiere nota de justificación y queda registrada en el audit log.
5. El Owner recibe un email de confirmación de la reactivación.
6. Solo Staff puede ejecutar la acción.

---

### HU-1.7 — Archivar un tenant (baja lógica)

**Como** Staff de Plataforma o Tenant Owner
**Quiero** archivar un tenant que ya no va a operar
**Para** liberar el subdominio, detener la facturación y conservar los datos durante el periodo de retención legal.

**Criterios de aceptación**

1. El Staff puede archivar cualquier tenant; el Owner solo puede archivar su propio tenant.
2. El archivado requiere confirmación explícita mediante tecleo del nombre del tenant (patrón "type to confirm").
3. Al archivar, el tenant pasa a estado `ARCHIVED`, el subdominio se libera (queda disponible para nuevos tenants tras 30 días) y la API devuelve `410 Gone` para peticiones del tenant.
4. Antes de archivar, el sistema ofrece al Owner la opción de exportar los datos del tenant (ver HU-1.8); el archivado **no** se completa hasta que el Owner confirma o rechaza la exportación.
5. La retención de datos es configurable por plan; por defecto **90 días** tras los cuales se procede al borrado definitivo.
6. Todas las suscripciones a webhooks se eliminan; todas las API keys del tenant se revocan.
7. Las cuentas de Admin del tenant se desvinculan (mantienen su cuenta de usuario, pero pierden acceso al tenant).
8. La acción queda en el audit log con actor, motivo y hash de snapshot final de los datos.
9. Un tenant con saldo pendiente en Stripe Connect no puede archivarse hasta que el saldo se liquide; se muestra error `PENDING_BALANCE`.

---

### HU-1.8 — Exportar datos de un tenant (RGPD)

**Como** Tenant Owner o Staff de Plataforma
**Quiero** solicitar una exportación completa de los datos del tenant
**Para** cumplir con el derecho de portabilidad del RGPD o conservar los datos antes de un archivado.

**Criterios de aceptación**

1. El endpoint acepta solicitudes del Owner (sobre su propio tenant) y del Staff (sobre cualquier tenant).
2. La exportación se ejecuta de forma **asíncrona** mediante un job; el endpoint devuelve `202 Accepted` con un `export_id`.
3. El job incluye todos los datos del tenant scopeados por `tenant_id`: transacciones, split rules, administradores, configuración, webhooks, audit log.
4. El resultado es un fichero ZIP con JSON por entidad, cifrado con contraseña enviada por canal separado al email del solicitante.
5. El enlace de descarga es temporal (URL firmada con expiración de 7 días) y de un solo uso.
6. La solicitud queda registrada en el audit log, incluido qué Staff solicitó la exportación (trazabilidad RGPD).
7. Si ya existe una exportación en curso para el mismo tenant, el endpoint devuelve `409 Conflict` con el `export_id` en curso.
8. Datos sensibles como secret keys se excluyen o se enmascaran en la exportación.

---

### HU-1.9 — Restaurar un tenant archivado

**Como** Staff de Plataforma
**Quiero** restaurar un tenant archivado dentro del periodo de retención
**Para** recuperar un cliente que solicita reactivar su cuenta tras un archivado.

**Criterios de aceptación**

1. Solo tenants en estado `ARCHIVED` y dentro del periodo de retención configurado pueden ser restaurados.
2. Tras un archivado, si han pasado más de los días de retención o el borrado definitivo ya se ejecutó, la restauración no es posible y el endpoint devuelve `410 Gone`.
3. La restauración vuelve a poner el tenant en estado `ACTIVE`, pero **sin** recuperar automáticamente el subdominio anterior si ya fue reasignado a otro tenant.
4. Las API keys previas **no** se reactivan; el Owner debe generar nuevas.
5. Los Admins previos **no** se reasignan automáticamente; el Staff debe confirmar con el Owner qué administradores reinvita.
6. La restauración queda registrada en el audit log.
7. Solo Staff puede ejecutar la acción.

---

## Épica 3 — Gestión de administradores y usuarios

> **Como** plataforma multi-tenant,
> **queremos** que cada tenant pueda tener uno o varios administradores con roles diferenciados y trazabilidad completa de los cambios,
> **para** permitir la delegación operativa dentro del cliente, garantizar la responsabilidad de quién puede hacer qué y cumplir con los estándares de seguridad y auditoría.

---

### HU-3.1 — Invitar a un administrador al tenant

**Como** Tenant Owner o Admin
**Quiero** invitar a una persona a administrar el tenant mediante su email
**Para** delegar tareas operativas y ampliar el equipo con acceso controlado.

**Criterios de aceptación**

1. La invitación requiere: email y rol a asignar (actualmente solo `ADMIN`; el rol `OWNER` se gestiona en HU-3.7).
2. El sistema envía un email con un enlace firmado (JWT de un solo uso) con expiración de **7 días**.
3. Si el email ya pertenece a un Admin activo del mismo tenant, el endpoint devuelve `409 Conflict`.
4. Si el email ya tiene cuenta en otra organización, la invitación se asocia a esa cuenta existente (no se duplica la identidad).
5. El estado de la invitación es `PENDING` hasta ser aceptada, expirada o cancelada.
6. La invitación está scopeada por `tenant_id` (RLS); un Admin solo puede invitar a su propio tenant.
7. La acción queda registrada en el audit log con actor, email invitado, rol propuesto y timestamp.
8. Existe un límite configurable por plan de número máximo de Admins por tenant; si se alcanza, el endpoint devuelve `403 Plan Limit Reached`.

---

### HU-3.2 — Aceptar una invitación de administrador

**Como** persona invitada a administrar un tenant
**Quiero** aceptar la invitación desde el enlace recibido por email
**Para** obtener acceso al panel del tenant y comenzar a operar.

**Criterios de aceptación**

1. Al abrir el enlace, el sistema valida el token: firma correcta, no expirado, no usado previamente.
2. Si el invitado no tiene cuenta en Voragine, se le pide completar registro (nombre, contraseña, aceptación de términos).
3. Si ya tiene cuenta, se le pide iniciar sesión y confirmar la aceptación.
4. Tras aceptar, la persona queda asignada al tenant con rol `ADMIN` y estado `ACTIVE`; la invitación pasa a estado `ACCEPTED`.
5. El Owner y quien envió la invitación reciben notificación por email de la aceptación.
6. La acción queda registrada en el audit log con actor (nuevo admin), tenant_id, invitación asociada y timestamp.
7. Un token ya usado, expirado o revocado devuelve `410 Gone` con mensaje explicativo.

---

### HU-3.3 — Cancelar una invitación pendiente

**Como** Tenant Owner o Admin
**Quiero** cancelar una invitación que todavía no ha sido aceptada
**Para** revocar el acceso antes de que se formalice, por cambio de criterio o error en el email.

**Criterios de aceptación**

1. Solo invitaciones en estado `PENDING` pueden cancelarse; estados `ACCEPTED` o `EXPIRED` devuelven `409 Conflict`.
2. Tras cancelar, la invitación pasa a estado `CANCELLED` y el token asociado queda invalidado inmediatamente.
3. Cualquier Admin o el Owner puede cancelar invitaciones del propio tenant.
4. La acción queda registrada en el audit log con actor, invitación afectada y timestamp.
5. Se envía un email de notificación al invitado informando de la cancelación.

---

### HU-3.4 — Listar administradores del tenant

**Como** Tenant Owner, Admin o Staff
**Quiero** consultar los administradores de un tenant
**Para** conocer quién tiene acceso, con qué rol y cuándo fue la última actividad.

**Criterios de aceptación**

1. El listado muestra: nombre, email, rol (`OWNER` o `ADMIN`), fecha de alta, último inicio de sesión y estado 2FA.
2. Incluye una sección separada con las invitaciones `PENDING` visibles con su email, fecha de envío y fecha de expiración.
3. Owner y Admin solo pueden ver los administradores de su propio tenant (RLS por `tenant_id`).
4. Staff puede ver los administradores de cualquier tenant.
5. El listado soporta búsqueda por nombre o email y filtro por rol y estado.
6. La respuesta sigue el formato estándar `{ "data": [...] }` con paginación cursor si supera 50 resultados.

---

### HU-3.5 — Cambiar el rol de un administrador

**Como** Tenant Owner
**Quiero** modificar el rol de un administrador existente
**Para** ajustar sus permisos según cambios en la organización del cliente.

**Criterios de aceptación**

1. Solo el Owner puede cambiar roles dentro de su tenant; Admin y Staff reciben `403 Forbidden`.
2. El rol `OWNER` no puede asignarse con esta HU (se gestiona exclusivamente vía HU-3.7 — transferencia de propiedad).
3. El Owner no puede auto-degradarse a `ADMIN` directamente; antes debe transferir la propiedad (HU-3.7).
4. El cambio es inmediato y la sesión del usuario afectado se invalida para forzar un nuevo login con los permisos actualizados.
5. El afectado recibe una notificación por email del cambio.
6. La acción queda registrada en el audit log con actor, afectado, rol anterior, rol nuevo y timestamp.

---

### HU-3.6 — Revocar el acceso de un administrador

**Como** Tenant Owner o Admin
**Quiero** retirar el acceso a un administrador del tenant
**Para** mantener el equipo actualizado cuando alguien se va o deja de tener responsabilidades.

**Criterios de aceptación**

1. El Owner puede revocar a cualquier Admin; un Admin puede revocar a otros Admins pero **no** al Owner ni a sí mismo.
2. Al revocar, el usuario pierde acceso al tenant de inmediato y sus sesiones activas sobre ese `tenant_id` son invalidadas.
3. La cuenta del usuario en Voragine **no** se elimina: si administra otros tenants, sigue teniendo acceso a esos.
4. Se envía notificación por email al afectado con el motivo opcional indicado por quien revoca.
5. La acción queda registrada en el audit log con actor, afectado, motivo (opcional) y timestamp.
6. Si tras la revocación el tenant quedase sin ningún Admin (solo el Owner), la operación se permite pero se muestra aviso informativo.
7. No se puede revocar al último usuario del tenant (el Owner); el endpoint devuelve `409 Cannot Remove Last Owner`.

---

### HU-3.7 — Transferir la propiedad del tenant

**Como** Tenant Owner
**Quiero** transferir la propiedad del tenant a otro administrador existente
**Para** ceder el control definitivo ante una reorganización interna o salida del Owner actual.

**Criterios de aceptación**

1. Solo el Owner actual puede iniciar la transferencia.
2. El destinatario debe ser un `ADMIN` **activo** del mismo tenant; un usuario externo no puede recibir la propiedad directamente (debe ser invitado y aceptar primero como Admin).
3. La transferencia es un proceso de doble confirmación:
   - El Owner actual inicia la transferencia e introduce su contraseña.
   - El destinatario recibe un email con enlace de aceptación (expiración 48h) y debe confirmar.
4. Mientras la transferencia está `PENDING`, ambas partes conservan sus roles actuales.
5. Al aceptarse, los roles se intercambian: el Owner anterior pasa a `ADMIN` y el destinatario se convierte en `OWNER`.
6. Si el destinatario rechaza o expira el plazo, la transferencia queda `CANCELLED` y los roles no cambian.
7. La acción queda registrada en el audit log en ambos extremos (iniciación y confirmación) con actores y timestamps.
8. No puede haber más de una transferencia `PENDING` simultánea por tenant.

---

### HU-3.8 — Gestionar el staff de la plataforma

**Como** Staff Super Admin de la Plataforma
**Quiero** dar de alta, editar y dar de baja cuentas de Staff internas
**Para** mantener actualizado el equipo de Voragine con acceso al back-office global.

**Criterios de aceptación**

1. Solo un Staff con rol `SUPER_ADMIN` puede gestionar otras cuentas de Staff; un Staff regular no puede.
2. El alta requiere: nombre, email corporativo del dominio @voragine.app (validado), rol Staff (`SUPER_ADMIN` o `STAFF`).
3. El nuevo Staff recibe un email con enlace de activación (expiración 72h) donde debe establecer contraseña y activar 2FA **obligatorio** antes de acceder.
4. Un Staff no puede modificar su propio rol ni darse de baja a sí mismo (evita bloqueos).
5. El sistema garantiza que siempre exista al menos un `SUPER_ADMIN` activo; bajas que romperían esta regla devuelven `409 Conflict`.
6. Todas las altas, cambios de rol y bajas se registran en el audit log global con actor, afectado, detalle del cambio y timestamp.
7. El listado de staff solo es accesible para `SUPER_ADMIN`.
8. Al dar de baja un Staff, sus sesiones activas se invalidan inmediatamente.

---

### HU-3.9 — Consultar el audit log de cambios de administradores

**Como** Tenant Owner, Admin o Staff
**Quiero** consultar el historial de cambios en los administradores del tenant
**Para** auditar cualquier modificación sensible (invitaciones, revocaciones, cambios de rol, transferencias) con trazabilidad completa.

**Criterios de aceptación**

1. El log muestra por cada entrada: timestamp UTC, actor (nombre + email + rol), acción (`INVITE`, `ACCEPT`, `CANCEL_INVITE`, `REVOKE`, `ROLE_CHANGE`, `TRANSFER_INITIATED`, `TRANSFER_COMPLETED`), afectado e IP de origen.
2. Owner y Admin solo ven el log de su propio tenant (RLS por `tenant_id`).
3. Staff puede consultar el log de cualquier tenant y además tiene acceso a un log global multi-tenant.
4. El log soporta filtro por tipo de acción, rango de fechas y actor.
5. Las entradas del log son **inmutables**: no se permite edición ni borrado desde la UI ni la API.
6. La exportación del log a CSV está disponible para Owner y Staff (no para Admin).
7. El log conserva entradas durante un mínimo de 2 años (retención configurable por política).

---

## Apéndice A — Estados del tenant

```
          ┌─────────┐       suspender        ┌───────────┐
created ─▶│ ACTIVE  │───────────────────────▶│ SUSPENDED │
          └────┬────┘                         └─────┬─────┘
               │   ▲                                │
               │   │ reactivar                      │
               │   └────────────────────────────────┘
               │
               │ archivar
               ▼
          ┌──────────┐   restaurar (dentro retención)   ┌─────────┐
          │ ARCHIVED │◀─────────────────────────────────│ ACTIVE  │
          └────┬─────┘                                  └─────────┘
               │
               │ tras periodo de retención
               ▼
          ┌──────────┐
          │ PURGED   │  (borrado definitivo, no recuperable)
          └──────────┘
```

## Apéndice B — Estados de la invitación

```
         ┌─────────┐   aceptada   ┌──────────┐
 create ▶│ PENDING │─────────────▶│ ACCEPTED │
         └────┬────┘              └──────────┘
              │  │
     cancelar │  │ expiración (7 días)
              ▼  ▼
         ┌───────────┐          ┌─────────┐
         │ CANCELLED │          │ EXPIRED │
         └───────────┘          └─────────┘
```

---

## Siguiente paso sugerido

Una vez validadas estas historias, se generará el prototipo de pantallas como SPA HTML standalone con Tailwind, organizado por rol:

1. **Vista de Staff**: listado de tenants, ficha 360º, alta, acciones de ciclo de vida, gestión de staff.
2. **Vista de Tenant Owner**: ficha de su tenant, gestión de administradores, transferencia de propiedad, archivado.
3. **Vista de Tenant Admin**: ficha de su tenant (reducida), gestión de otros Admins (excepto Owner).
