// Contenido textual de las tres páginas legales del landing.
// Capturado del sitio público (https://www.aikikan.es/{privacy,
// avisolegal,legal/cookies-policy}) y hardcodeado para servirse desde
// modales sin salir de la SPA. Si el copy cambia en el futuro, mover
// estos JSX a una tabla en BD y leer del API igual que eventos/vídeos.

export const PRIVACY_CONTENT = (
  <>
    <h3>Información al usuario</h3>
    <h4>Responsable del tratamiento</h4>
    <p>AIKIKAN ESPAÑA es responsable del tratamiento de datos personales conforme al GDPR y la Ley Orgánica 3/2018 (LOPDGDD).</p>

    <h4>Finalidades del tratamiento</h4>
    <p>Los datos se tratan para mantener relaciones comerciales mediante:</p>
    <ul>
      <li>Envío de comunicaciones comerciales por email, SMS, redes sociales u otros medios.</li>
      <li>Estudios de mercado y análisis estadísticos.</li>
      <li>Tramitación de solicitudes y consultas del usuario.</li>
      <li>Remisión de boletín informativo sobre novedades y promociones.</li>
    </ul>

    <h4>Base legal</h4>
    <p>El tratamiento se legitima por consentimiento del usuario para comunicaciones comerciales, e interés legítimo para estudios de mercado y tramitación de solicitudes.</p>

    <h4>Período de conservación</h4>
    <p>Los datos se mantienen mientras sea necesario para la finalidad del tratamiento o mientras existan prescripciones legales, siendo eliminados posteriormente con medidas de seguridad adecuadas.</p>

    <h4>Comunicación a terceros</h4>
    <p>No se ceden datos a terceros, excepto a proveedores de servicios de comunicaciones vinculados mediante contratos de confidencialidad.</p>

    <h4>Derechos del usuario</h4>
    <ul>
      <li>Retirar el consentimiento en cualquier momento.</li>
      <li>Derecho de acceso, rectificación, portabilidad y supresión de sus datos.</li>
      <li>Presentar reclamación ante la AEPD (<a href="https://www.aepd.es" target="_blank" rel="noreferrer">www.aepd.es</a>).</li>
    </ul>

    <h4>Contacto</h4>
    <p>AIKIKAN ESPAÑA, Capitán Antoni Mena 42, 03201 Elche (Alicante).</p>

    <h3>Carácter obligatorio de la información</h3>
    <p>Los datos marcados con asterisco (*) son obligatorios para atender solicitudes. El responsable indica que todos los datos del sitio web son necesarios para la prestación óptima de servicios.</p>

    <h3>Medidas de seguridad</h3>
    <p>AIKIKAN ESPAÑA cumple las disposiciones del GDPR y la LOPDGDD, implementando políticas técnicas y organizativas para proteger los derechos y libertades de los usuarios conforme a los principios del artículo 5 del GDPR.</p>

    <h3>Cookies</h3>
    <h4>Gestión de consentimiento</h4>
    <p>Se utiliza CookieFirst (Digital Data Solutions BV, Amsterdam) para obtener consentimiento válido del usuario sobre cookies.</p>

    <h4>Datos recogidos</h4>
    <ul>
      <li>Consentimiento o retirada del mismo.</li>
      <li>Dirección IP anónima.</li>
      <li>Información del navegador y dispositivo.</li>
      <li>Fecha, hora y URL de visitas.</li>
      <li>UUID único del visitante.</li>
    </ul>

    <h4>Tipos de cookies</h4>
    <p><strong>Necesarias:</strong> mantienen sesión, carrito de compras, preferencias de idioma e inicio de sesión.</p>
    <p><strong>Funcionales:</strong> servicios de chat, vídeos, botones de redes sociales e inicio de sesión social.</p>
    <p><strong>Sin clasificar:</strong> en proceso de clasificación.</p>

    <h4>Desactivación</h4>
    <p>Los usuarios pueden optar por rechazar las cookies no necesarias en la configuración del navegador, aunque esto puede afectar a la experiencia de usuario.</p>

    <h3>Enlaces a otros sitios</h3>
    <p>Los enlaces a páginas externas no implican aprobación, asociación o afiliación con AIKIKAN ESPAÑA. El usuario accede bajo su responsabilidad.</p>
  </>
)

export const LEGAL_NOTICE_CONTENT = (
  <>
    <h3>Ley de los Servicios de la Sociedad de la Información (LSSI)</h3>
    <p>AIKIKAN ESPAÑA, como responsable del sitio web, publica este documento para cumplir con la Ley 34/2002, de 11 de julio, sobre Servicios de la Sociedad de la Información y Comercio Electrónico. Los usuarios que accedan al sitio se comprometen a observar las disposiciones aquí establecidas y la legislación aplicable.</p>
    <p>La organización se reserva el derecho de modificar cualquier información del sitio sin obligación de previo aviso.</p>

    <h3>1. Datos identificativos</h3>
    <ul>
      <li><strong>Nombre de dominio:</strong> www.aikikan.es</li>
      <li><strong>Nombre comercial:</strong> AIKIKAN</li>
      <li><strong>Denominación social:</strong> AIKIKAN ESPAÑA</li>
      <li><strong>NIF:</strong> G54744685</li>
      <li><strong>Domicilio:</strong> C/ Capitán Antonio Mena, 42, 03201 Elche (Alicante)</li>
      <li><strong>Teléfono:</strong> 672368699</li>
      <li><strong>Email:</strong> secretaria@aikikan.es</li>
    </ul>

    <h3>2. Derechos de propiedad intelectual e industrial</h3>
    <p>La programación, diseños, logotipos, textos y gráficos son propiedad del responsable o dispone de licencia autorizada. Requieren autorización escrita previa para cualquier reproducción, distribución o comercialización.</p>
    <p>Los contenidos ajenos pertenecen a sus respectivos propietarios. Se autoriza expresamente la redirección a contenidos específicos del sitio.</p>
    <p>Para notificar incumplimientos de derechos, contactar a <a href="mailto:secretaria@aikikan.es">secretaria@aikikan.es</a>.</p>

    <h3>3. Exención de responsabilidades</h3>
    <p><strong>Uso de cookies:</strong> el sitio utiliza cookies técnicas para funcionamiento óptimo. Estas son temporales y desaparecen al terminar la sesión. Los usuarios pueden configurar su navegador para rechazarlas.</p>
    <p><strong>Política de enlaces:</strong> el responsable no asume responsabilidad por contenidos de terceros sitios enlazados. Procederá a retirar inmediatamente enlaces que contravengan la legislación o el orden público.</p>
    <p><strong>Disponibilidad:</strong> se garantiza funcionamiento 365 días, 24 horas diarias, sin descartar errores técnicos o circunstancias de fuerza mayor.</p>
    <p><strong>Direcciones IP:</strong> los servidores detectan automáticamente direcciones IP y dominios para obtener mediciones únicamente estadísticas sobre navegación.</p>

    <h3>4. Ley aplicable y jurisdicción</h3>
    <p>Rige la legislación española. Los juzgados competentes serán los del domicilio del usuario o lugar de cumplimiento de la obligación.</p>
  </>
)

export const COOKIES_CONTENT = (
  <>
    <p className="legal-meta">Actualizado: 28/02/2025, 11:07</p>

    <h3>¿Qué son las cookies?</h3>
    <p>Las cookies son pequeños documentos de texto que contienen códigos identificadores únicos. Cuando visitas un sitio web, solicita permiso para guardar estos archivos en tu dispositivo y acceder a la información. Esta información puede incluir la fecha, hora de visita y cómo utilizas el sitio.</p>

    <h3>¿Por qué utilizamos cookies?</h3>
    <p>Las cookies aseguran que permanezcas conectado durante tu visita, mantengan los artículos en tu carrito de compras y que puedas comprar de forma segura. También permiten al sitio funcionar correctamente, mejorarlo mediante análisis de uso y presentarte anuncios personalizados según tus intereses.</p>

    <h3>¿Qué tipo de cookies utilizamos?</h3>
    <h4>Cookies necesarias</h4>
    <p>Necesarias para que el sitio web funcione correctamente. Permiten almacenar artículos en el carrito de compras, guardar preferencias de cookies e idioma e iniciar sesión en el portal.</p>

    <h4>Cookies funcionales</h4>
    <p>Proporcionan mayor funcionalidad establecidas por proveedores externos o el sitio. Incluyen servicios de chat en vivo, reproducción de vídeos, botones para redes sociales e inicio de sesión con redes sociales.</p>

    <h4>Sin clasificar</h4>
    <p>Estas cookies están todavía en proceso de clasificación. Aparecerán en categorías: necesarias, de rendimiento, funcionales o de publicidad.</p>

    <h3>¿Cómo puedo desactivar o eliminar las cookies?</h3>
    <p>Puedes rechazar todas las cookies excepto las necesarias mediante la configuración del navegador. Sin embargo, bloquear cookies puede afectar negativamente tu experiencia de usuario y las características técnicas disponibles.</p>
  </>
)
