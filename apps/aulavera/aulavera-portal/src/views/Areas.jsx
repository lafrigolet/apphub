import Poem from '../components/Poem'

const taoTeChing = `Un árbol enorme
crece de un tierno retoño.
Un camino de mil pasos
comienza en un solo paso.`

export default function Areas() {
  return (
    <>
      <header className="page-header">
        <span className="eyebrow">Las 4 áreas estatutarias</span>
        <h1>Cuatro <em>hilos conductores</em> que tejen el proyecto.</h1>
        <p className="page-lead">
          Cada área se aplica a través de la granja-escuela, con tres principios transversales:
          creatividad, contacto con la naturaleza y convivencia.
        </p>
      </header>

      <section className="section section-narrow">
        <article className="area-detail" id="educacion">
          <div>
            <div className="num">01</div>
            <div className="area-meta">— educación &amp; inclusión</div>
            <h2>Educación, desarrollo<br />personal e <em>inclusión</em></h2>
          </div>
          <div className="body">
            <p>
              De forma vocacional, en AulaVera estamos muy concienciados con las situaciones
              vulnerables en las que a menudo se encuentran niños y adolescentes con dificultades
              motoras, psíquicas o de aprendizaje. <strong>Para cruzar este río</strong>, tendemos
              un puente a través de actividades en la naturaleza, cuidando a los animales,
              desarrollando valores personales, nuevas destrezas, competencias emocionales y
              aptitud humana.
            </p>
            <p>
              Apostamos por <strong>talleres, charlas y terapias integrativas</strong>, impartidos
              por expertos creativos o de diferentes disciplinas — desde alimentación y agricultura
              a literatura y escritura creativa, pasando por toda expresión artística — para que
              cada persona descubra sus capacidades y avance en su integración social o adaptación familiar.
            </p>
            <div className="tags">
              <span className="tag featured">Convivencias</span>
              <span className="tag">Terapias integrativas</span>
              <span className="tag">Talleres creativos</span>
              <span className="tag">Escritura</span>
              <span className="tag">Animales</span>
              <span className="tag">Naturaleza</span>
            </div>
          </div>
        </article>

        <article className="area-detail" id="agronomia">
          <div>
            <div className="num">02</div>
            <div className="area-meta">— tierra &amp; cuidado</div>
            <h2>Agronomía y <em>agricultura</em><br />sostenible</h2>
          </div>
          <div className="body">
            <p>
              Para traer <strong>a tierra</strong> la creación de una granja-escuela resulta de
              inestimable valor contar con huertos y animales, para reconectar con las bondades y
              usos de una producción agrícola respetuosa y de apoyo a la región cacereña, su industria
              y compañeros del sector primario.
            </p>
            <p>
              La <strong>ecología, la permacultura y la agricultura regenerativa</strong> son pilares
              fundamentales. Poco a poco, cada planta que germina, cada ser que crece aquí, van
              enraizando este tejido con fines educativos y creativos — nunca de explotación comercial —,
              abonando el terreno con una educación basada en la sostenibilidad y el respeto.
            </p>
            <div className="tags">
              <span className="tag">Ecología</span>
              <span className="tag">Permacultura</span>
              <span className="tag">Agricultura regenerativa</span>
              <span className="tag">Huertos</span>
              <span className="tag">Animales</span>
            </div>
          </div>
        </article>

        <article className="area-detail" id="investigacion">
          <div>
            <div className="num">03</div>
            <div className="area-meta">— estudio &amp; medición</div>
            <h2>Investigación <em>I+D</em></h2>
          </div>
          <div className="body">
            <p>
              En estos tiempos en los que soplan vientos de cambio, apostamos por la
              <strong> colaboración con universidades y centros de I+D</strong> para realizar estudios
              respaldados por expertos: psicólogos, pedagogos, antropólogos, médicos y profesores.
            </p>
            <p>
              El entorno y las actividades que organizamos son puro aire fresco para esta tarea:
              permitirán mediciones y cálculos sobre la creatividad y autoestima de los niños o
              personas en riesgo de exclusión, sobre alimentación y agricultura ecológica, y sobre
              otras líneas que se vayan abriendo. Todos los cursillos y eventos que se organicen en
              el futuro ayudarán a financiar esta investigación.
            </p>
            <div className="tags">
              <span className="tag">Universidades</span>
              <span className="tag">Convenios</span>
              <span className="tag">Pedagogía</span>
              <span className="tag">Antropología</span>
              <span className="tag">Salud</span>
              <span className="tag">Sostenibilidad</span>
            </div>
          </div>
        </article>

        <article className="area-detail" id="arte">
          <div>
            <div className="num">04</div>
            <div className="area-meta">— historia &amp; memoria</div>
            <h2>Arte y cultura<br />en el <em>mundo rural</em></h2>
          </div>
          <div className="body">
            <p>
              La cultura, el arte y las tradiciones de una sociedad son la <strong>llama que mantiene
              viva su historia</strong>. En AulaVera queremos rescatar y divulgar costumbres,
              gastronomía y prácticas artesanales — tradicionales o novedosas — que coincidan en
              la sostenibilidad y el respeto al medio ambiente.
            </p>
            <p>
              Cocinamos a fuego lento el desarrollo integral del mundo rural, la conservación del
              patrimonio histórico, cultural, artístico y natural. Potenciamos la cultura local —
              arte, tradiciones culinarias, artesanías, música, danza — y <strong>apoyamos a los
              artistas del territorio</strong>. ¡Esto está que echa chispas!
            </p>
            <div className="tags">
              <span className="tag">Artesanías</span>
              <span className="tag">Música</span>
              <span className="tag">Danza</span>
              <span className="tag">Gastronomía</span>
              <span className="tag">Patrimonio</span>
              <span className="tag">Artistas locales</span>
            </div>
          </div>
        </article>
      </section>

      <Poem text={taoTeChing} author="Tao Te Ching" source="Lao Tzu" />
    </>
  )
}
