import { useState } from 'react'
import RoleCrumb from '../../components/RoleCrumb.jsx'
import { useToast } from '../../hooks/index.js'
import { products } from '../../data/invitado.js'
import styles from './Invitado.module.css'

const FILTERS = [
  { key: 'todo',   label: 'Todo' },
  { key: 'frescos', label: 'Frescos' },
  { key: 'lacteo',  label: 'Lácteo & huevos' },
  { key: 'legum',   label: 'Legumbres & cereal' },
  { key: 'despen',  label: 'Despensa' },
  { key: 'bebida',  label: 'Bebidas' },
  { key: 'granel',  label: 'Granel' },
]

export default function Invitado() {
  const [activeFilter, setActiveFilter] = useState('todo')
  const [toastVisible, showToast] = useToast(1800)

  const visible = products.filter(
    (p) => activeFilter === 'todo' || p.cat === activeFilter
  )

  return (
    <>
      <RoleCrumb />

      <header className={styles.topbar}>
        <div className={styles['topbar-inner']}>
          <a href="#" className={styles.brand} onClick={(e) => e.preventDefault()}>
            <span className={styles['brand-mark']}>m</span>
            <strong>macabeo<em>.</em></strong>
          </a>
          <nav className={styles.nav}>
            <a href="#" className={styles.active} onClick={(e) => e.preventDefault()}>Catálogo</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Productores</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Manifiesto</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Recetas</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Asambleas</a>
          </nav>
          <div style={{ display: 'flex', gap: '8px' }}>
            <a href="#" className={`${styles.btn} ${styles['btn-ghost']}`} onClick={(e) => e.preventDefault()}>Entrar</a>
            <a href="#" className={`${styles.btn} ${styles['btn-primary']}`} onClick={(e) => e.preventDefault()}>Hazte socio/a</a>
          </div>
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles['hero-inner']}>
          <div>
            <div className={styles.eyebrow}>Economato cooperativo · Galicia</div>
            <h1>Comer cerca, <em>comer</em><br /><span className={styles.accent}>en consciencia.</span></h1>
            <p className={styles.lead}>Macabeo es un economato ecológico autogestionado por sus socios. Producto de temporada, kilómetro corto y trato directo con productoras de la tierra.</p>
            <div className={styles['hero-cta']}>
              <a className={`${styles.btn} ${styles['btn-primary']}`} href="#" onClick={(e) => e.preventDefault()}>Explorar catálogo →</a>
              <a className={`${styles.btn} ${styles['btn-ghost']}`} href="#" onClick={(e) => e.preventDefault()}>Cómo funciona la cooperativa</a>
            </div>
            <div className={styles['hero-stats']}>
              <div className={styles.stat}><span className={styles.n}><em>248</em></span><span className={styles.l}>Socias activas</span></div>
              <div className={styles.stat}><span className={styles.n}><em>34</em></span><span className={styles.l}>Productoras locales</span></div>
              <div className={styles.stat}><span className={styles.n}><em>91%</em></span><span className={styles.l}>Producto km 0</span></div>
            </div>
          </div>
          <div className={styles['hero-visual']}>
            <div className={`${styles['hv-card']} ${styles.hv1}`}>
              <div className={styles.ttl}>de temporada</div>
              <div className={styles.sub}>mayo · 18 productos</div>
            </div>
            <div className={`${styles['hv-card']} ${styles.hv2}`}>
              <div className={styles.row}>
                <div>
                  <div className={styles.qty}>12<em>kg</em></div>
                  <div className={styles.lbl}>eco esta semana</div>
                </div>
                <div style={{ fontFamily: 'var(--display)', fontStyle: 'italic', opacity: '.4', fontSize: '40px' }}>↗</div>
              </div>
            </div>
            <div className={`${styles['hv-card']} ${styles.hv3}`}>
              <div className={styles.ico}>✻</div>
              <div className={styles.txt}>Tu cesta,<br />tu impacto</div>
            </div>
            <div className={`${styles['hv-card']} ${styles.hv4}`}>
              <div className={styles.sm}>Tomate kumato · 500g</div>
              <div className={styles.pr}>3,40<em>€</em></div>
              <div className={styles.dot}><span></span><span></span><span></span><span></span></div>
            </div>
          </div>
        </div>
      </section>

      <div className={styles.strip}>
        <span>kilómetro corto</span><span>certificado CRAEGA</span><span>sin envases inútiles</span><span>productor con nombre</span><span>de temporada</span>
        <span>kilómetro corto</span><span>certificado CRAEGA</span><span>sin envases inútiles</span><span>productor con nombre</span><span>de temporada</span>
      </div>

      <section className={styles.block}>
        <div className={styles['section-head']}>
          <div>
            <div className={styles.eyebrow}>Catálogo público · Esta semana</div>
            <h2>Lo que está <em>en su momento</em>, ahora mismo.</h2>
          </div>
          <a className={`${styles.btn} ${styles['btn-ghost']}`} href="#" onClick={(e) => e.preventDefault()}>Ver catálogo completo →</a>
        </div>

        <div className={styles.filters}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`${styles.chip}${activeFilter === f.key ? ' ' + styles.on : ''}`}
              data-f={f.key}
              onClick={() => setActiveFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className={styles['prod-grid']}>
          {visible.map((p, i) => (
            <article key={i} className={styles.prod}>
              <div className={styles['prod-img']} style={{ background: p.col }}>
                <div className={styles['prod-badges']}>
                  {p.b.includes('eco') && <span className={`${styles.bdg} ${styles.eco}`}>eco</span>}
                  {p.b.includes('km0') && <span className={`${styles.bdg} ${styles.km0}`}>km 0</span>}
                  {p.b.includes('season') && <span className={`${styles.bdg} ${styles.season}`}>temporada</span>}
                </div>
                {p.ini}
              </div>
              <div className={styles['prod-body']}>
                <div className={styles['prod-prod']}>{p.pr}</div>
                <div className={styles['prod-name']}>{p.n}</div>
                <div style={{ fontSize: '12px', color: 'var(--mb-muted)' }}>{p.u}</div>
                <div className={styles['prod-meta']}>
                  <div className={styles['prod-price']}>{p.pri.toFixed(2).replace('.', ',')}<em>€</em></div>
                  <button className={styles['prod-add']} aria-label="Añadir" onClick={showToast}>+</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.block}>
        <div className={styles.manifesto}>
          <div>
            <div className={styles.eyebrow} style={{ color: 'rgba(255,255,255,.6)' }}>Manifiesto</div>
            <h2>No vendemos<br />comida. <em>Cuidamos</em><br />una manera<br />de comer.</h2>
          </div>
          <ul>
            <li>Solo trabajamos con productoras que conocemos por su nombre.</li>
            <li>Si no es de temporada, no está en el lineal. Y lo decimos.</li>
            <li>El precio es transparente: cuánto al campo, cuánto al economato.</li>
            <li>Las decisiones importantes se votan en asamblea, no en despacho.</li>
            <li>El envase es el último recurso; el granel, el primero.</li>
          </ul>
        </div>
      </section>

      <section className={styles.block}>
        <div className={styles['section-head']}>
          <div>
            <div className={styles.eyebrow}>Quien hace lo que comes</div>
            <h2>Productoras <em>con nombre</em>.</h2>
          </div>
        </div>
        <div className={styles['prods-row']}>
          <div className={styles.producer}>
            <div className={styles.av}>L</div>
            <h4>Horta da Lúa</h4>
            <div className={styles.loc}>Betanzos · 18 km</div>
            <p>Tres hectáreas de huerta familiar gestionadas por Lúa y su madre. Especializadas en hortaliza de hoja y kumato de verano.</p>
            <div className={styles.certs}><span className={styles.cert}>CRAEGA</span><span className={styles.cert}>Km 0</span></div>
          </div>
          <div className={styles.producer}>
            <div className={styles.av}>M</div>
            <h4>Granxa Meixón</h4>
            <div className={styles.loc}>Curtis · 32 km</div>
            <p>Ganadería extensiva de rubia gallega. Producen queso curado, yogur natural y mantequilla. Pasto rotativo y certificado ecológico.</p>
            <div className={styles.certs}><span className={styles.cert}>CRAEGA</span><span className={styles.cert}>Bienestar</span></div>
          </div>
          <div className={styles.producer}>
            <div className={styles.av}>S</div>
            <h4>Salgueiro Cereais</h4>
            <div className={styles.loc}>Lalín · 64 km</div>
            <p>Recuperación de variedades locales: trigo caaveiro, centeno, alforfón. Molino propio y harinas de piedra a baja temperatura.</p>
            <div className={styles.certs}><span className={styles.cert}>CRAEGA</span><span className={styles.cert}>Variedad local</span></div>
          </div>
        </div>
      </section>

      <footer className={styles.foot}>
        <div className={styles['foot-inner']}>
          <div>
            <div className={styles.brand}>
              <span className={styles['brand-mark']}>m</span>
              <strong style={{ color: 'var(--mb-surface)' }}>macabeo<em style={{ color: 'var(--mb-accent)' }}>.</em></strong>
            </div>
            <p style={{ marginTop: '14px', opacity: '.7', fontSize: '14px', maxWidth: '34ch' }}>Sociedade cooperativa galega de consumo responsable. Aberto a socias e visitas con cita.</p>
          </div>
          <div>
            <h5>Cooperativa</h5>
            <a href="#" onClick={(e) => e.preventDefault()}>Estatutos</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Asambleas</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Hazte socia</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Voluntariado</a>
          </div>
          <div>
            <h5>Tienda</h5>
            <a href="#" onClick={(e) => e.preventDefault()}>Catálogo</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Productoras</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Recetas</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Recogida</a>
          </div>
          <div>
            <h5>Visítanos</h5>
            <a href="#" onClick={(e) => e.preventDefault()}>Rúa do Forno 14</a>
            <a href="#" onClick={(e) => e.preventDefault()}>15660 Cambre</a>
            <a href="#" onClick={(e) => e.preventDefault()}>hola@macabeo.gal</a>
            <a href="#" onClick={(e) => e.preventDefault()}>+34 981 00 00 00</a>
          </div>
          <div className={styles.copy}>
            <span>© 2026 Macabeo S.Coop.G · CIF F-70000000</span>
            <span>RGPD · Política de cookies · Aviso legal</span>
          </div>
        </div>
      </footer>

      <div className={`${styles.toast}${toastVisible ? ' ' + styles.on : ''}`}>
        Producto añadido a la cesta
      </div>
    </>
  )
}
