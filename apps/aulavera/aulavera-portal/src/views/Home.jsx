import { Link } from 'react-router-dom'
import { Campsite, Arrow, Olives, Cow, River, Workshop, Vega, Frog } from '../components/svg/Illustrations'
import Poem from '../components/Poem'

const desiderata = `Tú eres una criatura del universo,
no menos que los árboles y las estrellas,
tienes derecho a existir,
y sea que te resulte claro o no,
indudablemente el universo marcha como debiera.`

export default function Home() {
  return (
    <>
      <section className="section">
        <div className="hero">
          <div className="hero-left">
            <span className="hero-eyebrow">Losar de la Vera · Cáceres</span>
            <h1 className="hero-title">
              Una <em>granja-escuela</em><br />
              entre <span className="script-accent">olivos</span> y<br />
              música <em>al aire libre</em>
            </h1>
            <p className="hero-lead">
              Educación medioambiental, creativa y de desarrollo personal — especialmente
              para niños, adolescentes y personas con dificultades de integración.
              Aprendemos cuidando: a la tierra, a los animales, a quienes nos preceden y a nosotros mismos.
            </p>
            <div className="hero-actions">
              <Link to="/areas" className="btn btn-primary">Conoce las 4 áreas →</Link>
              <Link to="/donar" className="btn btn-ghost">Apoyar el proyecto</Link>
            </div>

            <div className="stat-band">
              <div className="stat-item">
                <span className="stat-num">2013<small>·</small></span>
                <span className="stat-lbl">Fundadas como SmileStone</span>
              </div>
              <div className="stat-item">
                <span className="stat-num">4</span>
                <span className="stat-lbl">áreas estatutarias</span>
              </div>
              <div className="stat-item">
                <span className="stat-num">1</span>
                <span className="stat-lbl">finca en la Vera</span>
              </div>
              <div className="stat-item">
                <span className="stat-num">∞</span>
                <span className="stat-lbl">caminos posibles</span>
              </div>
            </div>
          </div>
          <div className="hero-right">
            <div className="hero-illustration"><Campsite /></div>
            <div className="hero-tag hero-tag-1">~ vivencia ~</div>
            <div className="hero-tag hero-tag-2">naturaleza &amp; comunidad</div>
          </div>
        </div>
      </section>

      <section className="section" id="que-es">
        <div className="about">
          <aside className="about-aside">
            <div className="label">— Sobre nosotros</div>
            <div className="script">Qué es AulaVera</div>
            <p style={{ color: 'var(--ink-mute)', fontStyle: 'italic', fontSize: '0.95rem' }}>
              Una fundación con 12 años de historia que abre nueva etapa
              como granja-escuela en una finca rústica de la Vera.
            </p>
          </aside>
          <div className="about-text">
            <h2>Aprender <em>reconectando</em> con la naturaleza.</h2>
            <p>
              La <strong>Fundación AulaVera</strong> fue constituida bajo otra denominación —
              Fundación SmileStone — el 30 de julio de 2013. Su propósito es promover la
              <strong> educación creativa, artística y cultural</strong> como instrumento para
              favorecer la integración social de las personas participantes en sus actividades.
            </p>
            <p>
              12 años después, en una finca rústica de Losar de la Vera, se inicia una nueva
              etapa con la renovación del Patronato y la actualización de sus objetivos. La
              Fundación orienta ahora su acción a facilitar una educación medioambiental,
              creativa y de desarrollo personal, dirigida especialmente a personas con
              discapacidad u otras dificultades de adaptación e integración.
            </p>
            <p>
              Como eje principal se prevé la creación de una <strong>granja-escuela concebida
              como un espacio educativo, terapéutico y comunitario</strong> en contacto directo
              con la Naturaleza: tareas del campo, cuidado de los animales y del medio, refuerzan
              la sensibilización medioambiental y consolidan valores de respeto, sostenibilidad
              y cooperación.
            </p>

            <div className="timeline">
              <div className="timeline-item">
                <div className="year">2013</div>
                <div className="what">Constitución como Fundación SmileStone</div>
              </div>
              <div className="timeline-item">
                <div className="year">2025</div>
                <div className="what">Nueva etapa en Losar de la Vera, renovación del Patronato</div>
              </div>
              <div className="timeline-item">
                <div className="year">Hoy</div>
                <div className="what">Granja-escuela en construcción y primeros talleres con Servimayor</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="areas-section" id="areas-preview">
        <div className="areas-section-wrap">
          <div className="areas-head">
            <div>
              <span className="eyebrow"><span className="rule"></span>Las 4 áreas de aplicación</span>
              <h2>Cuatro caminos, <em>un solo lugar</em>.</h2>
            </div>
            <p>
              Cuatro áreas estatutarias atraviesan todo lo que hacemos. Cada una con
              su propia voz, todas en diálogo con la tierra, la comunidad y la convivencia.
            </p>
          </div>

          <div className="compass">
            <Link to="/areas" className="compass-cell">
              <div className="arrow"><Arrow /></div>
              <div className="compass-num">01</div>
              <h3>Educación, desarrollo<br />personal e <em>inclusión</em></h3>
              <p>Tendemos un puente a través de actividades en la naturaleza, terapias integrativas
              y convivencias para personas con dificultades motoras, psíquicas o de aprendizaje.</p>
            </Link>
            <Link to="/areas" className="compass-cell">
              <div className="arrow"><Arrow /></div>
              <div className="compass-num">02</div>
              <h3>Agronomía y <em>agricultura</em> sostenible</h3>
              <p>Huertos, animales, ecología, permacultura y agricultura regenerativa.
              Producción con fines educativos y creativos, no de explotación comercial.</p>
            </Link>
            <Link to="/areas" className="compass-cell">
              <div className="arrow"><Arrow /></div>
              <div className="compass-num">03</div>
              <h3>Arte y cultura<br />en el <em>mundo rural</em></h3>
              <p>Rescate de costumbres, gastronomía, artesanías, música y danza locales,
              siempre en sintonía con la sostenibilidad y el apoyo a artistas del territorio.</p>
            </Link>
            <Link to="/areas" className="compass-cell">
              <div className="arrow"><Arrow /></div>
              <div className="compass-num">04</div>
              <h3>Investigación <em>I+D</em></h3>
              <p>Colaboración con universidades y centros de I+D para estudios respaldados
              por psicólogos, pedagogos, antropólogos, médicos y profesores.</p>
            </Link>
            <div className="compass-center"><span>A</span></div>
          </div>

          <div className="servimayor-band">
            <div className="badge">Una colaboración querida</div>
            <p>
              <strong>Residencia Servimayor</strong>, ubicada en un espacio contiguo, comparte con nosotros
              la convicción de que aprender a tratar con dignidad a quienes nos preceden es aprender,
              también, a relacionarnos así con todas las personas.
            </p>
            <Link to="/proyectos" className="btn btn-terra">Ver el taller juntos →</Link>
          </div>
        </div>
      </section>

      <section className="section gallery-section">
        <div className="gallery-head">
          <div>
            <span className="eyebrow">Fotos y vídeos</span>
            <h2>El lugar, <em>despacio</em>.</h2>
          </div>
          <p style={{ color: 'var(--ink-soft)', maxWidth: 380, fontStyle: 'italic' }}>
            Imágenes de la finca, los animales y las primeras actividades — algunas propias,
            otras de uso libre mientras se sustituyen progresivamente.
          </p>
        </div>
        <div className="gallery">
          <div className="g-card g-1"><Vega /><span className="cap">La Vera al amanecer</span></div>
          <div className="g-card g-2"><Olives /><span className="cap">Olivar centenario</span></div>
          <div className="g-card g-3"><Cow /><span className="cap">Vacas</span></div>
          <div className="g-card g-4"><Frog /><span className="cap">El charco</span></div>
          <div className="g-card g-5"><River /><span className="cap">Garganta cercana</span></div>
          <div className="g-card g-6"><Workshop /><span className="cap">Taller en Servimayor</span></div>
        </div>
      </section>

      <Poem text={desiderata} author="Desiderata" source="Max Ehrmann, 1927" />
    </>
  )
}
