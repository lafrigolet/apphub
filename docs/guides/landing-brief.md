# Brief de landing page — guía para describir un portal nuevo

Plantilla para describir una landing de forma que el asistente pueda construirla
de una pasada con el flujo opendragon (`/opendragon-bootstrap-app` →
`/opendragon-importa` → `/opendragon-implementa`). Copia las secciones, rellena
lo que sepas y borra lo que no aplique.

**Mínimo viable**: con las secciones 1–4 hay suficiente para una V1 razonable;
el resto afina el resultado. Todo lo que no especifiques se decidirá con
defaults sensatos y quedará marcado para revisión.

---

## 1. Identidad

- **Nombre del app / subdominio**: `<nombre>` → `<nombre>.hulkstein.com`
- **Qué es** (1–3 frases): a qué se dedica, qué ofrece, dónde opera.
- **Idioma(s)** de la web: (es / es+en / …)
- **Tono**: cercano · institucional · premium · juvenil · técnico…
- **Marca**: ¿hay logo, paleta de colores, tipografías? ¿Dónde están los
  archivos? Si no hay, indica 2–3 adjetivos ("cálido, artesanal, verde") o una
  web de referencia visual.

## 2. Objetivo de conversión

¿Qué quieres que haga el visitante? Elige el principal (y secundarios si los
hay) — esto decide qué módulos de plataforma se reutilizan:

| Objetivo | Módulo que lo cubre |
|---|---|
| Dejar sus datos / pedir info | `platform/leads` (global) o `platform/inquiries` (por tenant) |
| Reservar cita o clase | `platform/bookings` + `availability` + `services` |
| Comprar producto | `platform/catalog` + `basket` + `orders` |
| Donar | `platform/donations` |
| Inscribirse a un curso/evento | `platform/leads` con `source` dedicado (patrón grafocaligrafía) |
| Reservar mesa | `platform/reservations` |

## 3. Audiencia

- ¿Quién visita la página? (edad, perfil, qué busca, qué le frena)
- ¿Llegan desde móvil sobre todo? ¿Desde anuncios, boca a boca, Google?

## 4. Estructura — secciones en orden

Lista las secciones de arriba a abajo. Por cada una: **título**, **contenido**
(texto real, o "redáctalo tú a partir de esto: …"), **imagen** (archivo
disponible / placeholder) y **CTA** si lo hay. Secciones típicas:

1. **Hero** — titular + subtítulo + CTA principal + imagen/fondo
2. Problema → solución / propuesta de valor
3. Servicios o features (¿cuántos? ¿con icono, foto, precio?)
4. Cómo funciona (pasos)
5. Sobre nosotros / equipo (¿fotos y bios reales?)
6. Testimonios (¿hay reales? ¿cuántos?)
7. Precios / tarifas (¿se editan desde el admin? → sección 8)
8. FAQ (lista de preguntas o "genera 6 típicas del sector")
9. CTA final / formulario
10. Footer (datos de contacto, redes, legal)

> No hace falta usar todas — di cuáles y en qué orden. Si tienes un boceto,
> captura o web parecida, referencia el archivo/URL aquí.

## 5. Contenido y assets

- **Textos**: ¿los proporcionas tú, los redacto yo desde tus notas, o mezcla?
- **Imágenes**: ruta a las disponibles; el resto, ¿placeholders o sugerencias
  de stock? Los descargables >10 MB van a storage/MinIO (patrón
  `public_download`), el resto como estáticos del portal.
- **Vídeos**: URLs de YouTube (se integran con facade click-to-load, sin coste
  de carga).

## 6. Formulario público (si el objetivo es captar datos)

- **Campos**: nombre, email… ¿teléfono? ¿mensaje? ¿selector de interés?
- **Destino**: ¿lead global de la plataforma (`leads`, prospectos pre-tenant) o
  consulta del tenant (`inquiries`, llega al buzón del admin con acuse al
  visitante)? Si dudas: leads para "quiero info del producto", inquiries para
  "contactar con este centro concreto".
- **RGPD**: texto de consentimiento propio o el estándar de la plataforma.
- **Auto-respuesta**: ¿email de acuse al visitante? ¿Con qué texto?

## 7. Páginas adicionales

- ¿One-page o multi-página? (rutas: `/`, `/servicios`, `/sobre-nosotros`…)
- Legales: aviso legal, privacidad, cookies — ¿textos propios o plantilla?

## 8. Parámetros editables desde el admin

¿Qué querrá cambiar el dueño sin tocar código? (precios, horarios, teléfono,
textos del hero, cupos…) — se exponen en `/admin/<feature>` vía
`/opendragon-add-admin-config`. Si no lo sabes aún, déjalo: se puede añadir
después.

## 9. SEO

- **Title** y **meta description** deseados (o "propón").
- 3–5 búsquedas en las que debería aparecer ("granja escuela Cáceres"…).
- ¿Migra contenido de una web existente? → indica el dominio viejo para
  preservar URLs/redirects.

## 10. Referencias y vetos

- 1–3 webs que te gustan (y qué de ellas: estructura, colores, animaciones).
- Qué NO quieres (carruseles, popups, fondos oscuros…).

---

## Ejemplo mínimo rellenado

> **1.** `vivero-luz` — vivero familiar en Plasencia, venta de planta autóctona.
> Español. Tono cercano. Sin logo: "verde, artesanal, luminoso".
> **2.** Objetivo: que pidan presupuesto → leads con `source: vivero-luz/presupuesto`.
> **3.** Particulares 30–60 con jardín, llegan por Instagram, casi todo móvil.
> **4.** Hero (foto invernadero, "Planta autóctona criada en La Vera", CTA
> "Pide presupuesto") · 3 servicios (venta, diseño de jardín, mantenimiento) ·
> Sobre nosotros (2 bios, tengo fotos) · 4 testimonios reales · FAQ (genera 5) ·
> Formulario · Footer.
> **6.** Nombre, email, teléfono, mensaje; RGPD estándar; acuse sí.

Con eso se construye la V1 completa; el resto de secciones afinan.

---

## Cómo usarlo

1. Rellena el brief (en un mensaje, o como archivo `docs/briefs/<app>.md`).
2. Pídelo: *"construye la landing según este brief"* — el flujo será
   `/opendragon-bootstrap-app <app>` y, con el JSX a mano, `/opendragon-importa`
   + `/opendragon-implementa` (REUSE de los módulos de la sección 2).
3. Itera: los cambios de contenido van a `src/data/`; los de configuración
   runtime, al admin.

---

## Anexo — catálogo de objetos de diseño

Vocabulario para la sección 4 del brief: nombra el objeto y di dónde va.
Ej.: *"Servicios como **cards con icono** en grid de 3; testimonios en
**carousel** sin autoplay; FAQ en **accordion**"*. Los marcados ⚡ ya tienen
implementación en algún portal del repo (se reutiliza el patrón).

### Héroes
| Objeto | Qué es / cuándo usarlo |
|---|---|
| Hero full-screen | Imagen o vídeo de fondo a pantalla completa + titular + CTA. Impacto máximo; necesita una foto buena. |
| Hero split | Texto a un lado, imagen al otro. El más versátil; bueno en móvil. |
| Hero con formulario | El form de captación embebido en el hero. Para conversión agresiva (presupuestos). |
| Hero slider/carousel | Varias imágenes rotando. **Caveat**: penaliza CWV y casi nadie ve el slide 2; mejor una sola imagen fuerte. |
| Hero con vídeo facade ⚡ | Miniatura que carga el vídeo solo al click (patrón grafocaligrafía). Cero coste de carga. |
| Hero con badge | Pildorita encima del titular ("Nuevo: curso 2026"). |

### Galerías y media
| Objeto | Qué es / cuándo usarlo |
|---|---|
| Image grid | Cuadrícula regular de fotos (2/3/4 columnas). |
| Masonry | Cuadrícula tipo Pinterest, alturas variables. Para fotos heterogéneas. |
| Carousel / slider | Elementos deslizables con flechas/dots. Indica: ¿autoplay? ¿cuántos visibles? |
| Lightbox | Click en foto → ampliada en overlay. Combina con grid/masonry. |
| Before / after | Slider comparador de dos imágenes. Reformas, tratamientos, restauración. |
| Galería filtrable | Grid con botones de categoría que filtran. |
| Logo cloud / marquee | Logos de clientes/prensa, estáticos o en cinta deslizante. |
| Vídeo embebido facade ⚡ | YouTube con click-to-load. Siempre preferible al iframe directo. |
| Mockup de dispositivo | Captura dentro de un marco de móvil/portátil. Para apps. |

### Bloques de contenido
| Objeto | Qué es / cuándo usarlo |
|---|---|
| Feature cards | Icono + título + 2 líneas, en grid. El estándar para servicios. |
| Zigzag (alternating) | Filas imagen-texto alternando lados. Para explicar 3–5 cosas con calma. |
| Steps numerados | "Cómo funciona" en 3–4 pasos con número grande. |
| Timeline | Hitos en línea vertical/horizontal. Historia de la empresa, programa de un curso. |
| Stats / counters | Cifras grandes ("+500 alumnos"), opcionalmente animadas al entrar en viewport. |
| Bento grid | Cuadrícula asimétrica de celdas de distinto tamaño. Look moderno/tech. |
| Accordion ⚡ | Preguntas que despliegan respuesta. El estándar para FAQ. |
| Tabs | Contenido conmutable en pestañas. Para variantes de un mismo tema. |
| Pricing cards | Columnas de precio con una destacada ("popular"). Indica si los precios se editan desde admin (sección 8). |
| Tabla comparativa | Filas de características × columnas de planes/opciones. |
| Banner CTA | Franja de color a ancho completo con titular + botón. Entre secciones o pre-footer. |
| Quote / pull-quote | Cita grande tipográfica. Manifiesto, filosofía. |

### Social proof
| Objeto | Qué es / cuándo usarlo |
|---|---|
| Testimonios en cards | 2–4 visibles en grid, con foto/nombre. |
| Testimonios en carousel | Si hay >4. Sin autoplay agresivo. |
| Wall of love | Muro masonry de muchas citas cortas. Solo si hay volumen real. |
| Estrellas / rating | Junto a testimonios o agregado ("4,9 ★ en Google"). |
| Caso de éxito | Mini-historia con resultado medible. B2B sobre todo. |

### Navegación
| Objeto | Qué es / cuándo usarlo |
|---|---|
| Navbar sticky | Fija al hacer scroll; variante transparente-sobre-hero que se vuelve sólida. |
| Anchor nav (one-page) | Enlaces que hacen scroll a secciones, con resaltado de la activa (scroll-spy). |
| Drawer móvil | Menú hamburguesa lateral. El estándar móvil. |
| Sticky CTA móvil | Botón de conversión fijo abajo en móvil ("Reservar", "WhatsApp"). Muy eficaz en local business. |
| Breadcrumbs | Solo multi-página con jerarquía (p.ej. /grafocaligrafia/metodo). |
| Back to top | Botoncito flotante. Páginas largas. |

### Formularios e interacción
| Objeto | Qué es / cuándo usarlo |
|---|---|
| Form simple ⚡ | 3–5 campos + RGPD (patrón leads/inquiries ya cableado). |
| Form multi-step | Wizard por pasos. Cuando hay >6 campos; sube conversión. |
| Newsletter inline | Solo email + botón, en footer o banner. |
| Calculadora interactiva ⚡ | Inputs → resultado en vivo (precedente: calculadora js-electric, configurable desde admin). |
| Mapa embebido | Ubicación física. Lazy-load para no penalizar carga. |
| Selector fecha/hora | Solo si el objetivo es reserva (bookings/reservations). |
| Modal / popup | **Veto frecuente** — indícalo explícitamente si lo quieres. |
| Botón WhatsApp flotante | Contacto directo. Muy usado en negocio local. |

### Efectos y movimiento
| Objeto | Qué es / cuándo usarlo |
|---|---|
| Fade-up on scroll ⚡ | Elementos que aparecen suavemente al entrar en viewport (clase `.fade-up` ya existe). Default sensato. |
| Parallax | Fondo a distinta velocidad que el contenido. Con moderación: coste en CWV. |
| Sticky section | Elemento que se queda fijo mientras el resto scrollea. Storytelling. |
| Hover effects | Zoom de imagen, elevación de card. Barato y agradecido. |
| Texto animado | Palabra del titular que rota/se escribe. Look startup. |
| Marquee de texto | Cinta de texto en movimiento. Decorativo. |

### Footers
| Objeto | Qué es / cuándo usarlo |
|---|---|
| Footer simple | Logo + 1 línea + legal. One-pages pequeñas. |
| Footer multi-columna | Columnas de enlaces + contacto + redes + newsletter. El estándar. |
| Footer con CTA final | Banner de conversión encima del footer ("¿Hablamos?"). Recomendado casi siempre. |

> **Regla de oro**: si no especificas nada, los defaults son hero split,
> feature cards, accordion para FAQ, form simple, footer multi-columna y
> fade-up — los patrones con mejor relación conversión/coste/CWV del repo.
