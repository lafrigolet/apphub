# Arquitectura de Microservicios · YogaStudio App

> Versión 1.0 · Documento de referencia técnica

---

## Índice

1. [Visión general](#visión-general)
2. [API Gateway](#1-api-gateway)
3. [Auth Service](#2-auth-service)
4. [User Service](#3-user-service)
5. [Class Service](#4-class-service)
6. [Booking Service](#5-booking-service)
7. [Bonus Service](#6-bonus-service)
8. [Payment Service](#7-payment-service)
9. [Notification Service](#8-notification-service)
10. [Reporting Service](#9-reporting-service)
11. [Message Bus](#10-message-bus-kafka--rabbitmq)
12. [Infraestructura compartida](#infraestructura-compartida)
13. [Integraciones externas](#integraciones-externas)
14. [Catálogo de eventos](#catálogo-de-eventos-del-bus)
15. [Principios de diseño](#principios-de-diseño)

---

## Visión general

YogaStudio App se estructura en **9 microservicios de negocio** más un **API Gateway** y un **Message Bus** transversal. Cada servicio es autónomo: tiene su propia base de datos, se despliega de forma independiente y se comunica con el resto a través de API REST síncrona (para operaciones que requieren respuesta inmediata) o mediante eventos asíncronos publicados en el bus de mensajería (para operaciones que no bloquean al cliente).

```
Clientes (SPA · App móvil · Panel admin · APIs externas)
        │
        ▼
   API Gateway  ──── JWT validation ──── Rate limiting
        │
        ├── Auth Service          ├── Bonus Service
        ├── User Service          ├── Payment Service
        ├── Class Service         ├── Notification Service
        └── Booking Service       └── Reporting Service
                    │
                    ▼
          Message Bus (Kafka / RabbitMQ)
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
  Notification  Reporting  Waiting List
```

---

## 1. API Gateway

| Atributo | Detalle |
|---|---|
| **Responsabilidad** | Punto de entrada único para todos los clientes |
| **Tecnología sugerida** | Kong, AWS API Gateway, Nginx + Lua |
| **Puerto expuesto** | `443` (HTTPS) |
| **Base de datos propia** | No (sin estado) |

### Funciones principales

- **Enrutamiento**: redirige cada petición entrante al microservicio correspondiente según el path (`/api/v1/bookings` → Booking Service, `/api/v1/classes` → Class Service, etc.).
- **Autenticación JWT**: valida el token en cada petición antes de reenviarla al servicio de destino. Si el token no es válido o ha expirado, devuelve `401 Unauthorized` sin llegar al servicio.
- **Autorización por rol**: comprueba que el rol del usuario (alumno, instructor, admin) tiene permiso sobre el endpoint solicitado.
- **Rate limiting**: limita el número de peticiones por IP y por usuario para proteger los servicios de abusos.
- **Load balancing**: distribuye el tráfico entre las instancias activas de cada microservicio.
- **Logging centralizado**: registra todas las peticiones entrantes con trazas para facilitar la observabilidad.
- **Caché de respuestas**: almacena en caché las respuestas del catálogo público de clases (sin autenticación) para reducir la carga en Class Service.

### Endpoints de entrada principales

```
GET    /api/v1/classes            → Class Service
POST   /api/v1/bookings           → Booking Service
GET    /api/v1/users/me           → User Service
POST   /api/v1/auth/login         → Auth Service
POST   /api/v1/payments/checkout  → Payment Service
GET    /api/v1/reports/attendance → Reporting Service
```

---

## 2. Auth Service

| Atributo | Detalle |
|---|---|
| **Responsabilidad** | Gestión de identidad, sesiones y control de acceso |
| **Tecnología sugerida** | Node.js / Python FastAPI |
| **Base de datos propia** | PostgreSQL (credenciales) + Redis (sesiones, tokens revocados) |
| **Historias de usuario** | HU-01, HU-02 |

### Funciones principales

- **Registro de usuarios**: crea la cuenta con nombre, email y contraseña hasheada (bcrypt, coste ≥ 12). Valida unicidad del email. Envía evento `user.registered` al bus para que Notification Service envíe el email de confirmación.
- **Login**: autentica con email + contraseña, emite un **JWT de acceso** (15 min) y un **refresh token** (30 días, almacenado en Redis con el `user_id` como clave).
- **Refresco de token**: intercambia un refresh token válido por un nuevo JWT de acceso sin necesidad de volver a autenticarse.
- **Bloqueo por intentos fallidos**: tras 5 intentos fallidos consecutivos en 10 minutos bloquea la cuenta durante 10 minutos (contador en Redis con TTL).
- **Recuperación de contraseña**: genera un token de un solo uso (UUID v4, TTL 1 h) y publica `password.reset.requested` en el bus.
- **Validación de JWT**: endpoint interno `/internal/validate` consumido por el API Gateway en cada petición.
- **OAuth2**: integración con Google y Apple como proveedores de identidad externos (flujo PKCE).
- **Gestión de roles**: cada JWT incluye el claim `role` (alumno | instructor | admin) y el `user_id`.

### Estructura del JWT

```json
{
  "sub": "usr_abc123",
  "role": "alumno",
  "email": "alumno@yoga.es",
  "iat": 1744300800,
  "exp": 1744301700
}
```

### Eventos publicados

| Evento | Trigger |
|---|---|
| `user.registered` | Registro completado |
| `user.email.confirmed` | Alumno confirma su correo |
| `password.reset.requested` | Solicitud de recuperación |
| `user.login.blocked` | 5 intentos fallidos |

---

## 3. User Service

| Atributo | Detalle |
|---|---|
| **Responsabilidad** | Perfiles de usuario, preferencias y historial de actividad |
| **Tecnología sugerida** | Node.js / Django REST Framework |
| **Base de datos propia** | PostgreSQL |
| **Historias de usuario** | HU-03 |

### Funciones principales

- **CRUD de perfil**: lectura y actualización de nombre, foto de perfil (referencia a S3), teléfono y preferencias de estilos de yoga.
- **Historial de clases**: mantiene un log de las últimas 20 clases asistidas por alumno, actualizado al recibir el evento `booking.attended`.
- **Preferencias de notificación**: almacena la configuración de recordatorios (24h, 2h, ninguno) y el opt-out de comunicados comerciales.
- **Gestión de instructores**: perfiles extendidos de instructores (certificaciones, especialidades, bio) consultados por Class Service y por la landing page.
- **Endpoint de búsqueda (Admin)**: búsqueda y filtrado de alumnos por nombre, estado de bono o actividad.

### Modelo de datos principal

```
users
  id            UUID PK
  name          VARCHAR(100)
  email         VARCHAR(255) UNIQUE
  phone         VARCHAR(20)
  avatar_url    TEXT
  role          ENUM(alumno, instructor, admin)
  preferences   JSONB          -- estilos preferidos, notificaciones
  created_at    TIMESTAMP
  updated_at    TIMESTAMP

class_history
  id            UUID PK
  user_id       UUID FK → users
  booking_id    UUID
  class_name    VARCHAR(100)
  instructor    VARCHAR(100)
  attended_at   TIMESTAMP
```

### Eventos consumidos

| Evento | Acción |
|---|---|
| `booking.attended` | Añade entrada al historial del alumno |
| `user.registered` | Crea el perfil inicial en la tabla `users` |

---

## 4. Class Service

| Atributo | Detalle |
|---|---|
| **Responsabilidad** | Catálogo de clases, horarios y gestión de salas |
| **Tecnología sugerida** | Python FastAPI / Spring Boot |
| **Base de datos propia** | PostgreSQL + Redis (caché del catálogo público) |
| **Historias de usuario** | HU-04, HU-05, HU-06 |

### Funciones principales

- **Catálogo público**: lista de clases con filtros por nivel, tipo y día. Resultado cacheado en Redis con TTL de 5 minutos. No requiere autenticación.
- **Gestión de clases (Admin)**: creación, edición y eliminación de clases. Al crear una clase recurrente genera automáticamente todas las sesiones del mes.
- **Control de capacidad**: mantiene el contador de plazas ocupadas por sesión. Expone endpoint `/classes/{id}/availability` consultado por Booking Service.
- **Agenda del instructor**: filtrado de clases por `instructor_id` con datos de asistentes y materiales necesarios.
- **Notificación de cambios**: al modificar o cancelar una clase con reservas activas, publica `class.modified` o `class.cancelled` en el bus para que Booking Service y Notification Service actúen.
- **Material necesario**: campo `equipment` por clase (colchoneta, bloques, cinturón…) visible en la agenda del instructor.

### Modelo de datos principal

```
classes
  id              UUID PK
  name            VARCHAR(100)
  type            ENUM(hatha, vinyasa, yin, restaurativo, power, mindfulness)
  instructor_id   UUID FK → users
  room            VARCHAR(20)
  start_time      TIME
  duration_min    INT
  max_capacity    INT
  level           ENUM(todos, principiante, intermedio, avanzado)
  recurrence      ENUM(none, weekly, biweekly)
  equipment       TEXT[]
  is_active       BOOLEAN
  created_at      TIMESTAMP

sessions
  id              UUID PK
  class_id        UUID FK → classes
  date            DATE
  spots_taken     INT DEFAULT 0
  is_cancelled    BOOLEAN
```

### Eventos publicados

| Evento | Trigger |
|---|---|
| `class.cancelled` | Admin cancela una clase con reservas |
| `class.modified` | Admin modifica horario o instructor |

---

## 5. Booking Service

| Atributo | Detalle |
|---|---|
| **Responsabilidad** | Reservas, cancelaciones, lista de espera y no-shows |
| **Tecnología sugerida** | Node.js / Go |
| **Base de datos propia** | PostgreSQL + Redis (timers de lista de espera) |
| **Historias de usuario** | HU-07, HU-08, HU-09, HU-16, HU-19 |

### Funciones principales

- **Crear reserva**: flujo síncrono que verifica créditos en Bonus Service y plazas en Class Service antes de confirmar. Operación atómica: si falla cualquier verificación, no se crea la reserva ni se descuenta crédito.
- **Cancelar reserva**: comprueba que queden más de 2 horas para el inicio. Si se cancela en plazo, publica `booking.cancelled` para que Bonus Service devuelva el crédito y Notification Service avise al siguiente en lista de espera.
- **Lista de espera**: al intentar reservar una clase llena, añade al usuario a la cola. Cuando una plaza se libera, notifica al primero de la cola y crea un timer Redis de 30 minutos. Si transcurre ese tiempo sin confirmación, pasa al siguiente.
- **Reservas recurrentes (HU-16)**: calcula todas las sesiones del mes, verifica el total de créditos necesarios de una vez y crea las reservas en un batch atómico.
- **Gestión de no-show (HU-19)**: un job programado (cron cada 15 min) detecta reservas de sesiones finalizadas sin asistencia confirmada y publica `no-show.detected`.
- **Confirmación de asistencia**: el instructor marca la asistencia real al finalizar la clase; genera el evento `booking.attended`.

### Modelo de datos principal

```
bookings
  id              UUID PK
  user_id         UUID
  session_id      UUID
  status          ENUM(confirmed, cancelled, attended, no_show, waiting)
  is_recurrent    BOOLEAN
  recurrent_grp   UUID              -- agrupa reservas del mismo mes
  booked_at       TIMESTAMP
  cancelled_at    TIMESTAMP
  cancellation_reason  TEXT

waiting_list
  id              UUID PK
  user_id         UUID
  session_id      UUID
  position        INT
  notified_at     TIMESTAMP         -- cuándo se avisó al alumno
  expires_at      TIMESTAMP         -- 30 min tras la notificación
```

### Eventos publicados

| Evento | Trigger |
|---|---|
| `booking.created` | Reserva confirmada |
| `booking.cancelled` | Reserva cancelada por el alumno |
| `booking.attended` | Instructor confirma asistencia |
| `no-show.detected` | Job detecta ausencia injustificada |
| `waitinglist.spot.available` | Plaza liberada en lista de espera |

---

## 6. Bonus Service

| Atributo | Detalle |
|---|---|
| **Responsabilidad** | Gestión de bonos, créditos y activación de compras |
| **Tecnología sugerida** | Python FastAPI / Spring Boot |
| **Base de datos propia** | PostgreSQL |
| **Historias de usuario** | HU-10, HU-11 |

### Funciones principales

- **Verificación de créditos**: endpoint síncrono `/bonuses/{user_id}/check` consultado por Booking Service antes de confirmar cualquier reserva. Devuelve créditos disponibles y fecha de caducidad.
- **Deducción atómica**: actualiza los créditos con un `SELECT FOR UPDATE` para evitar condiciones de carrera en reservas simultáneas.
- **Devolución de créditos**: al recibir `booking.cancelled` dentro del plazo, incrementa el contador de créditos del bono activo.
- **Activación de bono**: al recibir `payment.completed`, activa el bono con fecha de inicio y vencimiento.
- **Gestión admin**: creación de tipos de bono, asignación manual a alumnos, ajuste de créditos con registro del motivo, desactivación.
- **Alertas de caducidad**: job diario que detecta bonos con ≤ 2 clases restantes o que vencen en los próximos 7 días y publica `bonus.expiring-soon`.
- **Prioridad de consumo**: si el alumno tiene varios bonos activos, se consume primero el que caduca antes.

### Modelo de datos principal

```
bonus_types
  id              UUID PK
  name            VARCHAR(100)
  type            ENUM(sessions, monthly_unlimited)
  sessions_count  INT               -- null si es mensual
  validity_days   INT
  price_eur       DECIMAL(8,2)

bonuses
  id              UUID PK
  user_id         UUID
  bonus_type_id   UUID FK
  sessions_used   INT DEFAULT 0
  sessions_total  INT
  starts_at       DATE
  expires_at      DATE
  is_active       BOOLEAN
  activated_by    ENUM(payment, manual)

credit_log
  id              UUID PK
  bonus_id        UUID FK
  delta           INT               -- positivo: añadir · negativo: consumir
  reason          TEXT
  booking_id      UUID
  created_at      TIMESTAMP
```

### Eventos consumidos y publicados

| Dirección | Evento | Acción |
|---|---|---|
| Consume | `payment.completed` | Activa el bono comprado |
| Consume | `booking.cancelled` | Devuelve crédito si procede |
| Consume | `no-show.detected` | Descuenta crédito por no-show |
| Publica | `bonus.expiring-soon` | Aviso con 7 días de antelación |
| Publica | `bonus.depleted` | Bono sin créditos restantes |

---

## 7. Payment Service

| Atributo | Detalle |
|---|---|
| **Responsabilidad** | Procesamiento de pagos, facturas y registro de transacciones |
| **Tecnología sugerida** | Node.js / Python |
| **Base de datos propia** | PostgreSQL |
| **Historias de usuario** | HU-18 |
| **Cumplimiento** | PCI DSS (datos de tarjeta nunca almacenados en servidor propio) |

### Funciones principales

- **Inicio de checkout**: crea una sesión de pago en Stripe/PayPal y devuelve la URL de pago al cliente. El alumno completa el pago en el entorno seguro del proveedor.
- **Webhook de confirmación**: recibe el webhook de Stripe/PayPal tras el pago exitoso, verifica la firma del webhook y publica `payment.completed`.
- **Generación de factura PDF**: al confirmar el pago, genera la factura con los datos fiscales del alumno y del estudio, la almacena en S3 y publica `invoice.generated`.
- **Historial de pagos**: registro inmutable de todas las transacciones con su estado (pending, completed, failed, refunded).
- **Reembolsos**: endpoint admin para iniciar un reembolso en Stripe. Publica `payment.refunded` para que Bonus Service desactive el bono correspondiente.

### Modelo de datos principal

```
transactions
  id                  UUID PK
  user_id             UUID
  bonus_type_id       UUID
  provider            ENUM(stripe, paypal)
  provider_tx_id      VARCHAR(100)    -- ID de Stripe/PayPal
  amount_eur          DECIMAL(8,2)
  status              ENUM(pending, completed, failed, refunded)
  invoice_url         TEXT            -- URL S3 del PDF
  created_at          TIMESTAMP
  completed_at        TIMESTAMP
```

### Eventos publicados

| Evento | Trigger |
|---|---|
| `payment.completed` | Webhook de pago exitoso recibido |
| `payment.failed` | Fallo en el procesamiento |
| `payment.refunded` | Reembolso procesado |
| `invoice.generated` | Factura PDF generada y subida a S3 |

---

## 8. Notification Service

| Atributo | Detalle |
|---|---|
| **Responsabilidad** | Envío de todos los mensajes salientes: email, push y SMS |
| **Tecnología sugerida** | Node.js / Python (worker asíncrono) |
| **Base de datos propia** | PostgreSQL (historial de envíos) + Redis (cola de reintentos) |
| **Historias de usuario** | HU-12, HU-13 |

### Funciones principales

- **Suscriptor del bus**: consume eventos del Message Bus y genera el mensaje correspondiente según plantillas predefinidas.
- **Envío multicanal**: email vía SendGrid, push vía Firebase Cloud Messaging (Android) y APNs (iOS), SMS vía Twilio (opcional).
- **Respeto al opt-out**: antes de enviar cualquier comunicado comercial comprueba la preferencia del destinatario en User Service. No envía si el usuario ha hecho opt-out.
- **Recordatorios programados**: job que consulta las reservas del día siguiente y programa el envío a las 8:00 del día anterior (o con 2h de antelación según preferencia).
- **Comunicados del admin (HU-13)**: endpoint para enviar mensajes segmentados a grupos de alumnos. Soporta programación de envío a fecha futura.
- **Historial de envíos**: registro de cada mensaje enviado con estado (sent, failed, bounced) y timestamp.
- **Reintentos**: cola Redis con backoff exponencial para mensajes fallidos (máximo 3 intentos).

### Plantillas de mensajes gestionadas

| Plantilla | Trigger |
|---|---|
| Confirmación de reserva | `booking.created` |
| Cancelación de reserva | `booking.cancelled` |
| Recordatorio 24h / 2h | Job programado |
| Plaza disponible (lista espera) | `waitinglist.spot.available` |
| Bono próximo a vencer | `bonus.expiring-soon` |
| Bono agotado | `bonus.depleted` |
| Clase cancelada | `class.cancelled` |
| Bienvenida + confirmación email | `user.registered` |
| Recuperación de contraseña | `password.reset.requested` |
| Factura disponible | `invoice.generated` |
| Descuento por no-show | `no-show.detected` |
| Comunicado del estudio | Petición directa del admin |

---

## 9. Reporting Service

| Atributo | Detalle |
|---|---|
| **Responsabilidad** | Métricas en tiempo real, reportes de asistencia y análisis de valoraciones |
| **Tecnología sugerida** | Python (pandas + FastAPI) / Node.js |
| **Base de datos propia** | PostgreSQL (agregados) + ClickHouse o TimescaleDB (series temporales, opcional) |
| **Historias de usuario** | HU-14, HU-15, HU-17, HU-19 |

### Funciones principales

- **Dashboard en tiempo real**: mantiene agregados actualizados (clases del día, reservas activas, plazas ocupadas, alumnos activos del mes) actualizados al consumir eventos del bus. El endpoint de dashboard no hace queries en tiempo real: sirve los agregados precalculados.
- **Exportación CSV (HU-15)**: genera un fichero CSV con asistencia real vs. esperada por clase, instructor o sala en un rango de fechas. Se genera en background y se notifica al admin cuando está listo.
- **Valoraciones e índice de satisfacción (HU-17)**: recibe las valoraciones enviadas por los alumnos, calcula el promedio por instructor y por clase, y detecta tendencias de bajada.
- **Estadísticas de no-show**: tasa de no-show por alumno, por clase y por periodo. Disponible para el admin desde el panel de reportes.
- **Alertas automáticas**: detecta clases con tasa de ocupación inferior al 30% y bonos masivos a punto de vencer, y publica alertas para el dashboard del admin.

### Modelo de datos principal

```
daily_metrics
  date            DATE PK
  classes_count   INT
  total_bookings  INT
  total_attended  INT
  total_no_show   INT
  active_users    INT

ratings
  id              UUID PK
  booking_id      UUID
  user_id         UUID
  class_id        UUID
  instructor_id   UUID
  stars           SMALLINT       -- 1 a 5
  comment         TEXT
  created_at      TIMESTAMP

instructor_ratings_summary
  instructor_id   UUID PK
  avg_rating      DECIMAL(3,2)
  total_ratings   INT
  updated_at      TIMESTAMP
```

### Eventos consumidos

| Evento | Acción |
|---|---|
| `booking.created` | Incrementa reservas del día |
| `booking.cancelled` | Decrementa reservas activas |
| `booking.attended` | Incrementa asistencia real |
| `no-show.detected` | Incrementa contador de no-shows |
| `class.cancelled` | Ajusta métricas del día |

---

## 10. Message Bus (Kafka / RabbitMQ)

| Atributo | Detalle |
|---|---|
| **Responsabilidad** | Desacoplamiento asíncrono entre servicios |
| **Tecnología sugerida** | Apache Kafka (alto volumen) o RabbitMQ (menor complejidad) |
| **Patrón** | Publish/Subscribe con topics por dominio |

### Topics principales

| Topic | Productores | Consumidores |
|---|---|---|
| `bookings` | Booking Service | Notification, Reporting, Bonus |
| `payments` | Payment Service | Bonus, Notification, Reporting |
| `users` | Auth Service | User, Notification |
| `classes` | Class Service | Notification, Booking |
| `bonuses` | Bonus Service | Notification |
| `ratings` | Reporting Service | Reporting |

### Garantías

- **At-least-once delivery**: los mensajes se reintentan si el consumidor no confirma la recepción.
- **Dead letter queue**: mensajes que fallan tras N reintentos van a una cola de errores para revisión manual.
- **Orden dentro del topic**: Kafka garantiza orden por partición (clave = `user_id` o `session_id`).

---

## Infraestructura compartida

| Componente | Tecnología | Uso |
|---|---|---|
| **Bases de datos** | PostgreSQL 15 | Base de datos relacional por servicio (patrón Database per Service) |
| **Caché** | Redis 7 | Sesiones, tokens, contadores de rate limit, timers de lista de espera |
| **File storage** | AWS S3 / MinIO | Fotos de perfil, facturas PDF, exportaciones CSV |
| **Observabilidad** | Prometheus + Grafana + Jaeger | Métricas, trazas distribuidas y alertas |
| **Logs** | ELK Stack (Elasticsearch + Logstash + Kibana) | Centralización y búsqueda de logs |
| **Service discovery** | Kubernetes + CoreDNS | Resolución de nombres entre servicios |
| **Config y secrets** | HashiCorp Vault / AWS Secrets Manager | Variables de entorno, claves API, certificados |
| **CI/CD** | GitHub Actions + Docker + Kubernetes | Build, test y despliegue automatizado por servicio |

---

## Integraciones externas

| Servicio | Proveedor | Uso |
|---|---|---|
| **Pasarela de pago** | Stripe / PayPal | Cobro de bonos, reembolsos, webhooks de confirmación |
| **Email transaccional** | SendGrid | Confirmaciones, recordatorios, comunicados, facturas |
| **Push notifications** | Firebase Cloud Messaging + APNs | Notificaciones en app móvil (Android e iOS) |
| **OAuth2 social login** | Google Identity, Sign in with Apple | Registro e inicio de sesión sin contraseña |
| **Mapas** | Google Maps Embed API | Ubicación del estudio en la landing page |
| **CDN** | Cloudflare / AWS CloudFront | Servicio de assets estáticos de la SPA y la landing |

---

## Catálogo de eventos del bus

| Evento | Productor | Consumidores | Descripción |
|---|---|---|---|
| `user.registered` | Auth Service | User, Notification | Nuevo usuario creado |
| `user.email.confirmed` | Auth Service | User | Email verificado |
| `password.reset.requested` | Auth Service | Notification | Solicitud de recuperación |
| `booking.created` | Booking Service | Notification, Reporting, Bonus | Reserva confirmada |
| `booking.cancelled` | Booking Service | Notification, Reporting, Bonus | Reserva cancelada |
| `booking.attended` | Booking Service | User, Reporting | Asistencia confirmada |
| `no-show.detected` | Booking Service | Bonus, Notification, Reporting | Ausencia injustificada |
| `waitinglist.spot.available` | Booking Service | Notification | Plaza liberada en lista espera |
| `class.cancelled` | Class Service | Booking, Notification, Reporting | Clase cancelada con reservas activas |
| `class.modified` | Class Service | Notification | Cambio de horario o instructor |
| `payment.completed` | Payment Service | Bonus, Notification, Reporting | Pago procesado con éxito |
| `payment.failed` | Payment Service | Notification | Error en el pago |
| `payment.refunded` | Payment Service | Bonus, Notification | Reembolso procesado |
| `invoice.generated` | Payment Service | Notification | Factura PDF lista |
| `bonus.expiring-soon` | Bonus Service | Notification | Bono caduca en 7 días o ≤ 2 clases |
| `bonus.depleted` | Bonus Service | Notification | Bono sin créditos restantes |

---

## Principios de diseño

### Database per Service
Cada microservicio es el único propietario de su base de datos. Ningún servicio hace queries directas a la base de datos de otro. La consistencia entre servicios se gestiona mediante eventos asíncronos (eventual consistency).

### Comunicación síncrona vs. asíncrona
- **Síncrona (REST)**: operaciones que requieren respuesta inmediata para el usuario (verificar créditos antes de reservar, consultar disponibilidad de plazas).
- **Asíncrona (eventos)**: operaciones que no bloquean la experiencia del usuario (enviar email de confirmación, actualizar métricas, devolver créditos tras cancelación).

### Resiliencia
- **Circuit breaker**: si Bonus Service o Class Service no responden en < 500 ms, Booking Service devuelve un error controlado al cliente en lugar de esperar indefinidamente.
- **Timeouts**: todas las llamadas síncronas entre servicios tienen un timeout máximo de 1 segundo.
- **Idempotencia**: los handlers de eventos comprueban si ya procesaron ese `event_id` antes de actuar (tabla `processed_events` por servicio).

### Seguridad
- Comunicación interna entre servicios por red privada (no expuesta al exterior).
- Todos los endpoints internos requieren un header `X-Internal-Token` además del JWT del usuario.
- Los datos de tarjeta nunca tocan los servidores propios (Stripe.js / PayPal SDK los cifran en el navegador).

---

*Documento generado para YogaStudio App · Arquitectura de microservicios v1.0*
