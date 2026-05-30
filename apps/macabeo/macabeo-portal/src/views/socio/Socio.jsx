import RoleCrumb from '../../components/RoleCrumb.jsx'
import { useCountdown } from '../../hooks/index.js'
import { products, cart } from '../../data/socio.js'
import styles from './Socio.module.css'

export default function Socio() {
  const { h, m, s } = useCountdown(9 * 3600 + 14 * 60 + 38)

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
            <a href="#" className={styles.active} onClick={(e) => e.preventDefault()}>Inicio</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Catálogo</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Mis cestas</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Mis pedidos</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Comunidad</a>
          </nav>
          <div className={styles.user}>
            <button className={styles['cart-btn']}>🛒<span className={styles.bb}>7</span></button>
            <div className={styles.avatar} title="Marta Vilar">M</div>
          </div>
        </div>
      </header>

      <div className={styles.wrap}>

        <section className={styles.welcome}>
          <div className={styles['welcome-l']}>
            <div className={styles.eb}>socia nº 042 · activa desde 2021</div>
            <h2>Bos días, <em>Marta</em>.<br />Tu cesta semanal cierra hoy a las <em>22:00</em>.</h2>
            <p>Esta semana hemos incorporado albaricoque de Pomares do Sil y queso curado nuevo de Granxa Meixón. Revisa tu cesta recurrente antes del cierre.</p>
            <div className={styles.actions}>
              <a className={`${styles.btn} ${styles['btn-accent']}`} href="#" onClick={(e) => e.preventDefault()}>Revisar mi cesta →</a>
              <a className={`${styles.btn} ${styles['btn-ghost']}`} href="#" onClick={(e) => e.preventDefault()}>Ver novedades</a>
            </div>
          </div>
          <div className={styles.window}>
            <div className={styles.eb}>Cierre del pedido</div>
            <h3>Quedan <em>{h}h {m}m</em> para validar la cesta.</h3>
            <div className={styles.countdown}>
              <div className={styles['cd-cell']}><span className={styles.n}>{h}</span><span className={styles.l}>horas</span></div>
              <div className={styles['cd-cell']}><span className={styles.n}>{m}</span><span className={styles.l}>min</span></div>
              <div className={styles['cd-cell']}><span className={styles.n}>{s}</span><span className={styles.l}>seg</span></div>
            </div>
            <div className={styles['window-foot']}>
              <span className={styles.sm}>Recogida: <strong>jue 21 may, 18:00–20:00</strong> · Local Cambre</span>
              <a href="#" style={{ fontSize: '12px', color: 'var(--mb-primary)', textDecoration: 'none', fontWeight: 600 }} onClick={(e) => e.preventDefault()}>Cambiar →</a>
            </div>
          </div>
        </section>

        <div className={styles.main}>
          <div>

            <section className={styles.sec}>
              <div className={styles['sec-h']}>
                <h3>Tu cesta <em>recurrente</em></h3>
                <a href="#" onClick={(e) => e.preventDefault()}>Configurar cestas →</a>
              </div>
              <div className={styles['basket-rec']}>
                <div className={styles.ico}>↻</div>
                <div>
                  <h4>Cesta verde · semanal</h4>
                  <p>12 productos habituales · 38,40 € · próxima: 21 mayo · 2 productos no disponibles esta semana, te proponemos sustitutos.</p>
                </div>
                <div className={styles['b-actions']}>
                  <a className={`${styles.btn} ${styles['btn-ghost-d']}`} href="#" onClick={(e) => e.preventDefault()}>Ver detalle</a>
                  <a className={`${styles.btn} ${styles['btn-primary']}`} href="#" onClick={(e) => e.preventDefault()}>Aprobar</a>
                </div>
              </div>
            </section>

            <section className={styles.sec}>
              <div className={styles['sec-h']}>
                <h3>De <em>temporada</em> esta semana</h3>
                <a href="#" onClick={(e) => e.preventDefault()}>Ver catálogo →</a>
              </div>
              <div className={styles['prod-grid']}>
                {products.map((p) => (
                  <article className={styles.prod} key={p.n}>
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
                      <div style={{ fontSize: '11px', color: 'var(--mb-muted)' }}>{p.u}</div>
                      <div className={styles['prod-meta']}>
                        <div className={styles['prod-price']}>
                          <span className={styles.strike}>{(p.pri * 1.12).toFixed(2).replace('.', ',')}€</span>
                          {p.pri.toFixed(2).replace('.', ',')}
                          <em style={{ fontSize: '11px', color: 'var(--mb-primary)', fontStyle: 'normal', fontFamily: 'var(--body)', fontWeight: 600 }}>€ socia</em>
                        </div>
                        <button className={styles['prod-add']}>+</button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className={styles.sec}>
              <div className={styles['sec-h']}>
                <h3>Tu <em>huella</em></h3>
                <a href="#" onClick={(e) => e.preventDefault()}>Detalle anual →</a>
              </div>
              <div className={styles.impact}>
                <div className={styles.eb}>Tus 12 pedidos del último trimestre</div>
                <h3>Has consumido <em>78 kg</em> ecológicos de cercanía.</h3>
                <div className={styles['impact-grid']}>
                  <div className={styles['imp-cell']}><span className={styles.n}>78<em>kg</em></span><span className={styles.l}>producto ecológico</span></div>
                  <div className={styles['imp-cell']}><span className={styles.n}>2.140<em>km</em></span><span className={styles.l}>km ahorrados vs supermercado medio</span></div>
                  <div className={styles['imp-cell']}><span className={styles.n}>34<em>uds</em></span><span className={styles.l}>envases evitados (granel)</span></div>
                  <div className={styles['imp-cell']}><span className={styles.n}>12</span><span className={styles.l}>productoras apoyadas</span></div>
                </div>
                <div className={styles['imp-bar']}>
                  <div className={styles.lbl}><span>Objetivo anual de granel</span><span>62%</span></div>
                  <div className={styles['imp-track']}><div className={styles['imp-fill']}></div></div>
                </div>
              </div>
            </section>

            <section className={styles.sec}>
              <div className={styles.asm}>
                <h3>Vida <em style={{ fontStyle: 'italic', color: 'var(--mb-primary)' }}>cooperativa</em></h3>
                <div className={styles['asm-row']}>
                  <div className={styles['asm-date']}><span className={styles.d}>24</span><span className={styles.m}>May</span></div>
                  <div className={styles['asm-info']}>
                    <div className={styles.t}>Asamblea ordinaria de primavera</div>
                    <div className={styles.h}>19:00 · Local Cambre y streaming · Aprobación de cuentas y nueva línea de cereal local</div>
                  </div>
                  <span className={`${styles['asm-action']} ${styles.vote}`}>Votar online</span>
                </div>
                <div className={styles['asm-row']}>
                  <div className={styles['asm-date']}><span className={styles.d}>06</span><span className={styles.m}>Jun</span></div>
                  <div className={styles['asm-info']}>
                    <div className={styles.t}>Visita a Granxa Meixón</div>
                    <div className={styles.h}>10:00 · Curtis · Recorrido por la quesería y comida campestre · 12 plazas</div>
                  </div>
                  <span className={`${styles['asm-action']} ${styles.info}`}>Apuntarme</span>
                </div>
                <div className={styles['asm-row']}>
                  <div className={styles['asm-date']}><span className={styles.d}>14</span><span className={styles.m}>Jun</span></div>
                  <div className={styles['asm-info']}>
                    <div className={styles.t}>Comisión de productores locales</div>
                    <div className={styles.h}>18:00 · Online · Revisión de candidaturas de tres productoras nuevas</div>
                  </div>
                  <span className={`${styles['asm-action']} ${styles.info}`}>Detalle</span>
                </div>
              </div>
            </section>

          </div>

          <aside className={styles['cart-side']}>
            <h3>Tu <em>cesta</em></h3>
            <div className={styles.small}>Pedido para el jueves 21 de mayo</div>
            <div>
              {cart.map((c) => (
                <div className={styles['cart-line']} key={c.n}>
                  <div
                    className={styles['cart-thumb']}
                    style={
                      c.col === '#FBF9F3'
                        ? { background: c.col, color: 'var(--mb-text)', border: '1px solid var(--mb-line)' }
                        : { background: c.col }
                    }
                  >{c.ini}</div>
                  <div className={styles['cart-info']}>
                    <div className={styles['cart-name']}>{c.n}</div>
                    <div className={styles['cart-q']}>{c.q}</div>
                  </div>
                  <div className={styles['cart-pr']}>{c.pri.toFixed(2).replace('.', ',')} €</div>
                </div>
              ))}
            </div>
            <div className={styles.tot}>
              <div className={styles['tot-r']}><span>Subtotal</span><span>43,80 €</span></div>
              <div className={styles['tot-r']}><span>Descuento socia</span><span style={{ color: 'var(--mb-success)' }}>−5,40 €</span></div>
              <div className={styles['tot-r']}><span>IVA incluido</span><span>3,18 €</span></div>
              <div className={`${styles['tot-r']} ${styles.big}`}><span>Total socia</span><span>38,40 <em>€</em></span></div>
            </div>
            <div className={styles['member-save']}>Como socia ahorras 5,40 € en este pedido</div>
            <button className={styles.go}>Confirmar pedido →</button>
          </aside>
        </div>

      </div>
    </>
  )
}
