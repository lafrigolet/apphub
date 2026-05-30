# Macabeo — Gestión de Pedidos para Economato Ecológico
## Épicas, Historias de Usuario y Especificación de Producto

> Documento de planificación ágil (Scrum) para la aplicación de gestión de pedidos del economato ecológico **Macabeo**. Incluye identificación de roles, épicas, historias de usuario con criterios de aceptación y características de diseño y experiencia de usuario.

---

## 1. Visión del producto

Macabeo es una aplicación web y móvil para la gestión de pedidos de un economato ecológico que opera bajo modelo de consumo asociado (socios) y/o venta directa. La plataforma debe facilitar la realización de pedidos de productos ecológicos, kilómetro cero y de temporada, gestionar el stock, coordinar con proveedores locales y ofrecer una experiencia coherente con los valores de sostenibilidad, transparencia y comercio justo.

**Objetivos clave:**

- Simplificar el ciclo de pedido para socios y clientes.
- Optimizar la gestión interna de stock, lotes y caducidades.
- Garantizar trazabilidad del producto ecológico (origen, certificación, lote).
- Reducir el desperdicio mediante predicción y pedidos por unidad de venta.
- Reforzar el sentido de comunidad propio del consumo asociado.

---

## 2. Identificación de roles

| Rol | Descripción | Permisos principales |
|---|---|---|
| **Socio/a consumidor** | Persona asociada al economato que realiza pedidos periódicos. Suele tener cuota y precios preferentes. | Catálogo, pedidos propios, perfil, historial, cuota, asambleas. |
| **Cliente puntual** | Persona no asociada que compra ocasionalmente. | Catálogo limitado, pedidos puntuales, registro como socio. |
| **Administrador/a** | Persona responsable de la gestión global del economato. | Acceso total: configuración, usuarios, finanzas, reportes. |
| **Gestor/a de pedidos** | Personal que prepara, valida y cierra los pedidos. | Listas de preparación, picking, modificación de pedidos, incidencias. |
| **Responsable de almacén** | Encargado/a de stock, recepción de mercancía y control de caducidades. | Inventario, recepciones, mermas, lotes, ubicaciones. |
| **Comprador/a o gestor/a de proveedores** | Persona que negocia y realiza compras a productores. | Proveedores, órdenes de compra, costes, certificados ecológicos. |
| **Cajero/a o atención en tienda** | Atiende ventas físicas y entrega de pedidos. | TPV, cobros, entrega, devoluciones simples. |
| **Repartidor/a** | Realiza entregas a domicilio o a puntos de recogida. | Hojas de ruta, estado de entregas, firma digital. |
| **Proveedor/a (rol externo)** | Productor o distribuidor que abastece al economato. | Catálogo propio, confirmación de pedidos, facturación (solo lectura/escritura limitada). |
| **Tesorero/a o contable** | Gestión económica, cuotas y facturación. | Facturas, cuotas, conciliación, exportación contable. |
| **Invitado/a** | Visita pública del catálogo. | Solo lectura del catálogo público y página informativa. |

---

## 3. Mapa de épicas

1. **EP-01** Autenticación, registro y gestión de socios
2. **EP-02** Catálogo de productos ecológicos
3. **EP-03** Carrito y proceso de pedido
4. **EP-04** Pagos, cuotas y facturación
5. **EP-05** Entrega, recogida y logística
6. **EP-06** Gestión interna de pedidos (back office)
7. **EP-07** Inventario, lotes y trazabilidad
8. **EP-08** Gestión de proveedores y compras
9. **EP-09** Comunicación, notificaciones y comunidad
10. **EP-10** Reportes, analítica y sostenibilidad
11. **EP-11** Administración, configuración y seguridad
12. **EP-12** Diseño, accesibilidad y experiencia de usuario

---

## 4. Épicas e historias de usuario

### EP-01 — Autenticación, registro y gestión de socios

**Descripción de la épica:** Permitir que las personas se registren como socias o clientes puntuales, autenticarse de forma segura y mantener actualizado su perfil, incluyendo datos relevantes para el economato (preferencias alimentarias, alergias, dirección de entrega, etc.).

#### HU-01.1 Registro como socio

- **Como** persona interesada en consumir productos ecológicos
- **Quiero** poder registrarme como socio/a del economato Macabeo aportando mis datos y aceptando los estatutos
- **Para** acceder al catálogo completo, a los precios de socio y al sistema de cuotas

**Criterios de aceptación:**

- Existe un formulario con campos: nombre, apellidos, DNI/NIE, fecha de nacimiento, email, teléfono, dirección, IBAN para domiciliación de cuota.
- Se debe aceptar de forma explícita el documento de estatutos y la política de protección de datos (RGPD).
- El sistema valida que el email no esté ya registrado y que el DNI/NIE tenga formato correcto.
- Tras el envío, la solicitud queda en estado *pendiente de aprobación* hasta validación administrativa.
- El usuario recibe un correo de confirmación con su número de solicitud.

#### HU-01.2 Inicio de sesión

- **Como** usuario registrado
- **Quiero** iniciar sesión con email y contraseña, o con autenticación social/biométrica en móvil
- **Para** acceder rápidamente a mis pedidos y datos

**Criterios de aceptación:**

- Login con email + contraseña con validación de formato.
- Opción "Recordarme" mediante token seguro.
- Bloqueo temporal tras 5 intentos fallidos.
- Recuperación de contraseña vía email con enlace caducable (15 min).
- En la app móvil, soporte de Face ID / Touch ID / huella.

#### HU-01.3 Aprobación de socios

- **Como** administrador/a
- **Quiero** revisar y aprobar o rechazar las solicitudes de alta de socio
- **Para** asegurar que cumplen los requisitos de la asociación

**Criterios de aceptación:**

- Bandeja de solicitudes con filtros por fecha y estado.
- Acción de aprobar genera el número de socio y envía email de bienvenida.
- Acción de rechazar requiere motivo y notifica al solicitante.
- Cambios de estado quedan registrados en log de auditoría.

#### HU-01.4 Gestión de perfil

- **Como** socio
- **Quiero** actualizar mis datos personales, preferencias alimentarias y direcciones de entrega
- **Para** que mis pedidos se ajusten a mis necesidades

**Criterios de aceptación:**

- Sección "Mi perfil" editable.
- Campos de preferencias: vegetariano, vegano, sin gluten, sin lactosa, alergias (texto libre + multiselección).
- Soporta hasta 3 direcciones de entrega.
- Cambio de email/teléfono requiere reverificación.

---

### EP-02 — Catálogo de productos ecológicos

**Descripción de la épica:** Mostrar el catálogo de productos con información veraz, transparente y rica: origen, certificación ecológica, productor, temporada, valor nutricional, precio y disponibilidad.

#### HU-02.1 Explorar catálogo

- **Como** socio o cliente
- **Quiero** navegar el catálogo por categorías, filtros y búsqueda
- **Para** encontrar rápidamente los productos que necesito

**Criterios de aceptación:**

- Categorías jerárquicas (ej. *Frescos > Verduras > Hoja*).
- Filtros: ecológico certificado, kilómetro cero, de temporada, sin gluten, vegano, granel, precio, alérgenos.
- Búsqueda con autocompletado y tolerancia a errores tipográficos.
- Resultados paginados o con scroll infinito.
- Indicación visual clara cuando un producto está agotado o fuera de temporada.

#### HU-02.2 Ver ficha de producto

- **Como** socio o cliente
- **Quiero** ver la ficha completa de un producto con su origen y certificaciones
- **Para** tomar una decisión de compra informada y coherente con mis valores

**Criterios de aceptación:**

- La ficha muestra: foto (mínimo 1, hasta 5), nombre, productor, localidad de origen, distancia al economato, sello ecológico (CRAEGA, CCPAE, Demeter, etc.), ingredientes, alérgenos, valor nutricional, formato (peso o unidad), precio socio y precio no socio.
- Se indica si el producto es de temporada y los meses recomendados.
- Incluye un selector de cantidad con incremento adecuado (ej. 100 g, 250 g, unidad).
- Acción "Añadir al carrito" deshabilitada si no hay stock o si el usuario no es socio en productos exclusivos.

#### HU-02.3 Productos a granel

- **Como** socio
- **Quiero** poder pedir productos a granel indicando el peso exacto y, si quiero, traer mi propio envase
- **Para** reducir residuos y comprar solo lo que necesito

**Criterios de aceptación:**

- Productos marcados como "granel" permiten introducir peso libre dentro de un mínimo/máximo configurable.
- Casilla opcional "Traigo mi envase" que descuenta el coste del envase si procede.
- Precio se recalcula en tiempo real al ajustar el peso.
- En la preparación, se imprime una etiqueta con el peso real (puede diferir levemente, dentro de tolerancia configurable).

#### HU-02.4 Productos de temporada destacados

- **Como** socio
- **Quiero** ver en portada los productos de temporada y novedades de productores locales
- **Para** descubrir productos frescos y apoyar a la red local

**Criterios de aceptación:**

- Home con sección "De temporada" actualizada automáticamente según calendario configurable.
- Sección "Nuevos productores" con hasta 6 fichas breves.
- Banner editable por el administrador para campañas (ej. *Semana de las legumbres*).

---

### EP-03 — Carrito y proceso de pedido

**Descripción de la épica:** Permitir que el usuario componga su pedido, lo revise, lo guarde y lo confirme, con soporte para pedidos recurrentes (cestas semanales).

#### HU-03.1 Añadir al carrito

- **Como** socio o cliente
- **Quiero** añadir productos al carrito y modificar cantidades antes de confirmar
- **Para** ajustar mi pedido con flexibilidad

**Criterios de aceptación:**

- Botón "Añadir" visible en listado y ficha.
- Mini-carrito accesible desde cualquier pantalla mostrando número de líneas y total estimado.
- Modificación de cantidad o eliminación en un solo gesto.
- Persistencia del carrito entre sesiones (asociado al usuario o cookie en invitados).

#### HU-03.2 Cesta recurrente

- **Como** socio
- **Quiero** configurar una cesta recurrente semanal o quincenal con productos habituales
- **Para** no tener que repetir el pedido cada vez

**Criterios de aceptación:**

- Sección "Mis cestas" donde el socio puede crear, editar y nombrar cestas.
- Frecuencia configurable: semanal, quincenal, mensual.
- Notificación 48 h antes del cierre del pedido para revisar y modificar.
- Si un producto no está disponible, se sugiere sustituto o se omite avisando.

#### HU-03.3 Confirmar pedido

- **Como** socio o cliente
- **Quiero** revisar el resumen del pedido y confirmarlo seleccionando entrega y pago
- **Para** completar mi compra con confianza

**Criterios de aceptación:**

- Pantalla resumen con líneas, subtotales, impuestos desglosados, descuento de socio si aplica y total final.
- Selección de modo de entrega (recogida en tienda, punto de recogida, domicilio) y franja horaria.
- Selección de método de pago.
- Casilla opcional "Quiero compensar la huella de carbono del pedido" (aporta una cantidad simbólica a un proyecto).
- Confirmación final con número de pedido y email al usuario.

#### HU-03.4 Pedido mínimo y ventanas de pedido

- **Como** administrador
- **Quiero** configurar pedidos mínimos y ventanas semanales de apertura/cierre
- **Para** que la logística sea viable con productores locales

**Criterios de aceptación:**

- Posibilidad de definir por canal (domicilio, recogida) un importe o peso mínimo.
- Calendario semanal con días y horas de apertura y cierre de pedidos.
- Mensaje claro en la UI si el pedido está fuera de ventana o por debajo del mínimo.

---

### EP-04 — Pagos, cuotas y facturación

**Descripción de la épica:** Soportar diferentes medios de pago, gestionar la cuota de socios y emitir facturas conforme a la normativa.

#### HU-04.1 Pago online

- **Como** socio o cliente
- **Quiero** pagar mi pedido con tarjeta, Bizum o domiciliación bancaria
- **Para** elegir el medio que más me conviene

**Criterios de aceptación:**

- Integración con pasarela compatible PSD2/SCA.
- Pago con tarjeta (Visa, Mastercard), Bizum y domiciliación SEPA para socios.
- Mensajes claros de éxito, pendiente y error.
- Reintento manual desde "Mis pedidos" si el pago falla.

#### HU-04.2 Cuota de socio

- **Como** tesorero/a
- **Quiero** gestionar las cuotas periódicas de los socios
- **Para** asegurar el sostenimiento económico de la asociación

**Criterios de aceptación:**

- Configuración de cuotas (importe, periodicidad, exenciones).
- Generación automática de recibos SEPA en lote.
- Marcado de impagos con flujo de aviso al socio.
- Histórico consultable por el socio en su perfil.

#### HU-04.3 Facturación

- **Como** contable
- **Quiero** emitir facturas en PDF y exportarlas para la contabilidad
- **Para** cumplir con la normativa fiscal

**Criterios de aceptación:**

- Numeración correlativa por serie configurable.
- Datos fiscales completos (emisor, receptor, base, IVA, total).
- Descarga de PDF y exportación CSV / formato compatible con software contable (ej. Facturae, Contasol).
- Posibilidad de emitir factura rectificativa.

---

### EP-05 — Entrega, recogida y logística

**Descripción de la épica:** Coordinar la entrega del pedido por los distintos canales disponibles y mantener informada a la persona socia del estado.

#### HU-05.1 Selección de punto de recogida

- **Como** socio
- **Quiero** elegir un punto de recogida cercano y franja horaria
- **Para** recoger mi pedido cuando me convenga

**Criterios de aceptación:**

- Mapa con puntos de recogida y horarios.
- Búsqueda por código postal.
- Restricción de franjas según capacidad configurada.
- Recordatorio 24 h antes de la recogida.

#### HU-05.2 Entrega a domicilio

- **Como** repartidor/a
- **Quiero** tener una hoja de ruta optimizada con los pedidos del día
- **Para** entregar de forma eficiente y reducir emisiones

**Criterios de aceptación:**

- Vista lista y mapa con orden sugerido de entregas.
- Estado por entrega: pendiente, en camino, entregado, incidencia.
- Captura de firma o foto del paquete como prueba de entrega.
- Sincronización en tiempo real con el back office.

#### HU-05.3 Seguimiento del pedido por el socio

- **Como** socio
- **Quiero** ver el estado de mi pedido en tiempo real
- **Para** estar tranquilo y planificar la recepción

**Criterios de aceptación:**

- Estados visibles: recibido, en preparación, listo, en reparto, entregado.
- Notificaciones por email y push en cada cambio relevante.
- Detalle de la persona repartidora cuando esté en reparto (nombre y teléfono de contacto, sin datos sensibles).

---

### EP-06 — Gestión interna de pedidos (back office)

**Descripción de la épica:** Dotar al equipo del economato de herramientas eficientes para preparar, validar y resolver incidencias de los pedidos.

#### HU-06.1 Lista de preparación (picking)

- **Como** gestor/a de pedidos
- **Quiero** generar listas de picking agrupadas por ubicación de almacén
- **Para** preparar los pedidos rápidamente y minimizar desplazamientos

**Criterios de aceptación:**

- Generación por turno, ruta o conjunto de pedidos.
- Orden por zona y estantería.
- Marcado de cada línea como recogida o incidencia.
- Soporte para lector de código de barras o introducción manual.

#### HU-06.2 Gestión de incidencias

- **Como** gestor/a de pedidos
- **Quiero** marcar productos sin stock o defectuosos y proponer sustitución
- **Para** que el socio tenga su pedido lo más completo posible

**Criterios de aceptación:**

- Acción "Reportar incidencia" en cada línea con motivo.
- Propuesta automática de sustituto si está configurada en ficha de producto.
- Notificación inmediata al socio si su preferencia es "siempre avisar antes de sustituir".
- Ajuste automático del importe a cobrar.

#### HU-06.3 Cierre de pedido y etiquetado

- **Como** gestor/a de pedidos
- **Quiero** cerrar el pedido e imprimir la etiqueta del bulto
- **Para** que la logística lo recoja sin error

**Criterios de aceptación:**

- Generación de etiqueta con código QR único.
- Resumen del pedido por bulto si va en varios.
- Bloqueo de la edición tras el cierre, salvo permiso administrativo.

---

### EP-07 — Inventario, lotes y trazabilidad

**Descripción de la épica:** Controlar stock real, lotes, caducidades y trazabilidad de los productos ecológicos, requisito frecuente de la normativa de productos eco.

#### HU-07.1 Recepción de mercancía

- **Como** responsable de almacén
- **Quiero** registrar la recepción de mercancía indicando lote, caducidad y peso
- **Para** mantener el inventario actualizado y trazable

**Criterios de aceptación:**

- Pantalla de recepción con escaneo de albarán o introducción manual.
- Campos obligatorios: producto, lote, caducidad, cantidad recibida.
- Comparación con orden de compra y registro de diferencias.
- Posibilidad de adjuntar foto de certificado ecológico del lote.

#### HU-07.2 Control de caducidades

- **Como** responsable de almacén
- **Quiero** ver alertas de productos próximos a caducar
- **Para** rotar el stock y reducir mermas

**Criterios de aceptación:**

- Panel con productos por caducar en 3, 7 y 15 días configurables.
- Sugerencia de campañas (ej. -20% últimos días).
- Registro de mermas con motivo cuando finalmente se retira un producto.

#### HU-07.3 Trazabilidad del producto

- **Como** socio
- **Quiero** poder consultar el origen y lote del producto que he recibido
- **Para** saber qué consumo y de dónde viene

**Criterios de aceptación:**

- En el detalle del pedido entregado, cada línea muestra lote y productor.
- Acceso a una página pública por lote (vía QR) con productor, fecha de cosecha/elaboración y certificación.

---

### EP-08 — Gestión de proveedores y compras

**Descripción de la épica:** Gestionar el ciclo de compras con productores y distribuidores ecológicos.

#### HU-08.1 Ficha de proveedor

- **Como** comprador/a
- **Quiero** mantener una ficha completa por proveedor
- **Para** evaluar y trabajar con productores afines a nuestros valores

**Criterios de aceptación:**

- Campos: razón social, persona de contacto, datos fiscales, condiciones de pago, certificaciones, distancia, valoración interna.
- Adjuntos de certificados con fecha de validez y alerta antes de caducar.
- Histórico de pedidos y volumen.

#### HU-08.2 Orden de compra

- **Como** comprador/a
- **Quiero** generar órdenes de compra a partir de previsiones o stock mínimo
- **Para** asegurar el abastecimiento sin sobrestock

**Criterios de aceptación:**

- Sugerencia automática según punto de pedido configurado por producto.
- Envío de la orden al proveedor por email o portal.
- Confirmación, modificación y cierre de la orden con registro de tiempos.

#### HU-08.3 Portal de proveedor

- **Como** proveedor/a externo
- **Quiero** acceder a un portal donde ver mis pedidos pendientes y subir facturas
- **Para** simplificar la operativa con el economato

**Criterios de aceptación:**

- Acceso seguro con credenciales propias.
- Visualización de órdenes y posibilidad de confirmar o proponer cambios.
- Subida de albaranes y facturas en PDF.

---

### EP-09 — Comunicación, notificaciones y comunidad

**Descripción de la épica:** Reforzar el sentido de comunidad propio del consumo asociado, mediante comunicaciones útiles y un canal de participación.

#### HU-09.1 Notificaciones personalizadas

- **Como** socio
- **Quiero** decidir qué notificaciones recibir y por qué canal
- **Para** estar informado sin sentirme saturado

**Criterios de aceptación:**

- Centro de preferencias con tipos: pedido, cuota, asambleas, campañas, novedades de productores.
- Canales: email, push, SMS opcional.
- Doble opt-in para canales comerciales.

#### HU-09.2 Asambleas y participación

- **Como** socio
- **Quiero** ver la convocatoria de asambleas y votar en línea las decisiones
- **Para** participar en la vida del economato aunque no pueda asistir

**Criterios de aceptación:**

- Calendario de asambleas con orden del día.
- Votaciones con identificación de socio y resultado anónimo.
- Histórico de actas consultables.

#### HU-09.3 Blog de productores y recetas

- **Como** socio o cliente
- **Quiero** leer contenidos sobre productores y recetas
- **Para** conocer mejor lo que consumo y aprovecharlo

**Criterios de aceptación:**

- Sección editorial con etiquetas.
- Enlace cruzado: una receta enlaza con sus productos en el catálogo.
- Posibilidad de compartir en redes sociales.

---

### EP-10 — Reportes, analítica y sostenibilidad

**Descripción de la épica:** Aportar datos útiles para la gestión y para comunicar el impacto positivo.

#### HU-10.1 Cuadro de mando administrativo

- **Como** administrador/a
- **Quiero** un cuadro de mando con ventas, socios activos, mermas y rotación
- **Para** tomar decisiones basadas en datos

**Criterios de aceptación:**

- KPIs configurables y filtrables por fecha.
- Exportación a CSV / Excel.
- Gráficos accesibles con descripciones alternativas.

#### HU-10.2 Impacto sostenible

- **Como** socio
- **Quiero** ver el impacto positivo de mis compras (km recorridos, kg ecológicos, residuos evitados)
- **Para** reforzar mi motivación y compartirlo

**Criterios de aceptación:**

- Dashboard personal con indicadores estimados.
- Comparativa anual y respecto a la media del economato.
- Posibilidad de compartir tarjeta resumen en redes (sin datos personales).

---

### EP-11 — Administración, configuración y seguridad

**Descripción de la épica:** Gestionar permisos, parametrización general y seguridad de la plataforma.

#### HU-11.1 Gestión de roles y permisos

- **Como** administrador/a
- **Quiero** definir roles con permisos granulares
- **Para** que cada persona acceda solo a lo necesario

**Criterios de aceptación:**

- Matriz de permisos por módulo y acción (ver, crear, editar, borrar).
- Asignación de uno o varios roles por usuario.
- Log de auditoría de accesos y cambios sensibles.

#### HU-11.2 Configuración general

- **Como** administrador/a
- **Quiero** configurar parámetros generales (IVA, tipos de pago, ventanas, calendario)
- **Para** adaptar la plataforma sin intervención técnica

**Criterios de aceptación:**

- Panel de configuración con secciones claras.
- Cambios versionados y reversibles.
- Validación previa que evite configuraciones incoherentes.

#### HU-11.3 Cumplimiento RGPD

- **Como** socio
- **Quiero** ejercer mis derechos de acceso, rectificación, supresión y portabilidad
- **Para** mantener el control de mis datos personales

**Criterios de aceptación:**

- Sección "Mis datos" con descarga de mi información en formato estándar.
- Solicitud de baja con plazo legal y anonimización posterior.
- Banner de cookies con consentimiento granular.

---

### EP-12 — Diseño, accesibilidad y experiencia de usuario

**Descripción de la épica:** Construir una experiencia coherente con la identidad de Macabeo: cercana, transparente, sostenible y accesible para todas las personas.

#### HU-12.1 Identidad visual y sistema de diseño

- **Como** equipo de producto
- **Quiero** disponer de un sistema de diseño consistente
- **Para** garantizar coherencia visual y agilidad de desarrollo

**Criterios de aceptación:**

- Guía de estilos con tokens (colores, tipografías, espacios, radios, sombras).
- Librería de componentes documentada (botones, formularios, tarjetas de producto, modales, tablas).
- Modo claro y modo oscuro.

#### HU-12.2 Diseño responsive y mobile-first

- **Como** persona usuaria
- **Quiero** que la aplicación funcione bien en móvil, tablet y escritorio
- **Para** poder hacer pedidos desde cualquier dispositivo

**Criterios de aceptación:**

- Diseño mobile-first con breakpoints definidos.
- Navegación adaptada (bottom bar en móvil, menú lateral o superior en escritorio).
- Pruebas en dispositivos reales más populares antes de cada release.

#### HU-12.3 Accesibilidad

- **Como** persona con diversidad funcional
- **Quiero** que la app cumpla los criterios de accesibilidad WCAG 2.2 nivel AA
- **Para** poder utilizarla sin barreras

**Criterios de aceptación:**

- Contrastes mínimos AA en todos los componentes.
- Navegación completa por teclado y compatibilidad con lectores de pantalla.
- Etiquetas ARIA correctas en componentes interactivos.
- Posibilidad de aumentar el tamaño del texto hasta 200% sin pérdida de funcionalidad.

#### HU-12.4 Microcopia y tono de voz

- **Como** equipo de producto
- **Quiero** un manual de microcopia y tono de voz
- **Para** comunicar de forma cercana, clara y coherente con los valores del economato

**Criterios de aceptación:**

- Documento con principios del tono (cercano, transparente, sin tecnicismos innecesarios, lenguaje inclusivo).
- Plantillas de mensajes (errores, vacíos, éxito, confirmaciones).
- Soporte multilingüe (al menos castellano y gallego; inglés deseable).

---

## 5. Características de diseño y aspecto

### 5.1 Principios de diseño

1. **Naturalidad**: estética que evoque lo orgánico, evitando excesos digitales o artificiales.
2. **Transparencia**: la información del producto (origen, productor, lote) debe ser fácil de encontrar.
3. **Calma**: jerarquías claras, espacios respirados, sin saturación visual.
4. **Comunidad**: presencia de personas, productores y testimonios, no solo producto.
5. **Accesibilidad**: cumplimiento WCAG 2.2 AA como mínimo.

### 5.2 Paleta cromática propuesta

| Token | Uso | Color sugerido |
|---|---|---|
| `--mb-primary` | Principal, llamadas a la acción | Verde oliva profundo (#4F6B2F) |
| `--mb-primary-soft` | Fondos suaves, hover | Verde salvia (#A6B89A) |
| `--mb-accent` | Acentos, etiquetas de temporada | Terracota (#C76E4A) |
| `--mb-bg` | Fondo principal | Crudo cálido (#F5F1E8) |
| `--mb-surface` | Tarjetas, contenedores | Blanco roto (#FBF9F3) |
| `--mb-text` | Texto principal | Marrón oscuro (#2B2218) |
| `--mb-muted` | Texto secundario | Marrón medio (#7A6F5C) |
| `--mb-success` | Confirmaciones | Verde hoja (#5B8F3A) |
| `--mb-warning` | Avisos (caducidad) | Mostaza (#D5A021) |
| `--mb-danger` | Errores / impagos | Rojo terroso (#9E3B23) |

> Todos los pares de color de fondo/texto deben superar el ratio de contraste 4.5:1 para texto normal y 3:1 para texto grande.

### 5.3 Tipografía

- **Titulares**: tipografía serif humanista (ej. *Source Serif*, *Lora*) para evocar tradición y oficio.
- **Cuerpo**: tipografía sans-serif legible (ej. *Inter*, *Nunito Sans*).
- **Escala modular** basada en 1.25 (mayor menor): 12, 14, 16, 20, 24, 32, 40, 56.
- **Interlineado** de 1.5 en cuerpo, 1.2 en titulares.

### 5.4 Iconografía e imaginería

- Iconos lineales de trazo medio (1.5 px) con esquinas suavemente redondeadas.
- Fotografía real de productores y producto, evitando bancos de imágenes genéricos.
- Ilustraciones planas con grano sutil para empty states y secciones explicativas.
- Sellos ecológicos oficiales bien visibles en fichas de producto.

### 5.5 Componentes clave

- **Tarjeta de producto**: foto cuadrada o 4:3, nombre, productor, precio socio / no socio, badges (eco, temporada, km 0, granel), botón "Añadir".
- **Mini-carrito persistente**: visible en todas las pantallas, con número de líneas y total.
- **Filtros laterales** en escritorio, modal de filtros en móvil.
- **Indicador de impacto** acumulado del pedido (kg eco, km ahorrados).
- **Empty states** ilustrados con tono cercano: *"Tu cesta está más vacía que la huerta en enero"*.

### 5.6 Patrones de interacción

- Confirmaciones no destructivas con opción de "deshacer" durante 5 segundos para acciones reversibles.
- Estados de carga con skeletons en lugar de spinners siempre que sea posible.
- Feedback háptico ligero en móvil para acciones clave.
- Modo offline básico que permita revisar el último pedido y catálogo cacheado.

### 5.7 Plataformas y stack sugerido

- Web responsive (PWA) como punto de entrada principal.
- Apps nativas o híbridas (iOS / Android) opcionales en una fase posterior.
- Back office web optimizado para tablets en tienda.
- Integraciones: pasarela de pago PSD2, mensajería (email transaccional), contabilidad, etiquetado y escaneo de códigos.

---

## 6. Definición de Listo (DoR) y Definición de Hecho (DoD)

### Definición de Listo (Definition of Ready)

Una historia de usuario está lista para entrar en sprint cuando:

- Tiene los campos *como/quiero/para* completos y comprensibles.
- Tiene al menos 3 criterios de aceptación verificables.
- Ha sido estimada por el equipo.
- Se han identificado dependencias y se han mitigado.
- Tiene wireframes o referencias visuales si aplica.

### Definición de Hecho (Definition of Done)

Una historia se considera hecha cuando:

- Cumple todos los criterios de aceptación.
- Tiene cobertura de pruebas automatizadas (unitarias y, donde aplique, e2e).
- Ha pasado revisión de código por al menos un par.
- Cumple los estándares de accesibilidad AA.
- Está documentada en la guía interna y, si aplica, en la ayuda al usuario.
- Ha sido validada por la persona responsable de producto en entorno de preproducción.

---

## 7. Próximos pasos sugeridos

1. Priorizar épicas mediante MoSCoW o WSJF junto con el equipo y los socios fundadores.
2. Construir un prototipo navegable (Figma) de los flujos críticos: registro, catálogo, pedido y back office de preparación.
3. Validar el prototipo con 5–8 socios reales mediante test de usabilidad.
4. Definir el MVP centrado en EP-01, EP-02, EP-03, EP-05 (recogida) y EP-06.
5. Iterar a partir del MVP con métricas de uso, satisfacción y reducción de mermas.

---

*Documento de planificación — versión inicial. Sujeto a revisión continua según la realimentación del equipo y de los socios del economato Macabeo.*
