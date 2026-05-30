import RoleCrumb from '../../components/RoleCrumb.jsx';
import { products, cart } from '../../data/cliente.js';
import styles from './Cliente.module.css';

export default function Cliente() {
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
            <a href="#" onClick={(e) => e.preventDefault()}>Productoras</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Mis pedidos</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Hazte socia</a>
          </nav>
          <div className={styles.user}>
            <button className={styles['cart-btn']}>🛒<span className={styles.bb}>3</span></button>
            <div className={styles.avatar} title="Iria Carballo">IC</div>
          </div>
        </div>
      </header>

      <div className={styles.wrap}>

        <div className={styles['cta-banner']}>
          <div>
            <div style={{fontSize:'11px',textTransform:'uppercase',letterSpacing:'.16em',opacity:.85,marginBottom:'6px',position:'relative'}}>Cliente puntual · sin cuota</div>
            <h2>Únete como socia y ahorrarás <em>≈14%</em> en cada pedido.</h2>
            <p>Acceso a precios de cooperativa, cestas recurrentes y voto en asamblea. Cuota desde 12 €/mes, reembolsable al darse de baja.</p>
          </div>
          <a className={`${styles.btn} ${styles['btn-light']}`} href="#" onClick={(e) => e.preventDefault()}>Quiero hacerme socia →</a>
        </div>

        <div className={styles.heading}>
          <div>
            <div className={styles.eyebrow}>Catálogo abierto</div>
            <h1>Compra <em>sin cuota</em>,<br />cuando lo necesites.</h1>
            <p>Algunos productos están reservados a socias. Te indicamos cuáles y por qué.</p>
          </div>
        </div>

        <div className={styles['search-row']}>
          <input placeholder="Buscar productos, productoras…" defaultValue="" />
          <select defaultValue="Todo">
            <option>Todo</option>
            <option>Frescos</option>
            <option>Lácteo</option>
            <option>Despensa</option>
            <option>Granel</option>
          </select>
        </div>

        <div className={styles.notice}>Los productos con candado están reservados a socias para garantizar el abastecimiento prioritario. Hazte socia para acceder a todo el catálogo.</div>

        <div className={styles.layout}>
          <div className={styles['prod-grid']}>
            {products.map((p, i) => (
              <article key={i} className={`${styles.prod} ${p.lk ? styles.locked : ''}`}>
                <div
                  className={styles['prod-img']}
                  style={{
                    background: p.col,
                    ...(p.col === '#FBF9F3' ? { color: 'var(--mb-text)' } : {}),
                  }}
                >
                  <div className={styles['prod-badges']}>
                    {p.b.includes('eco') && <span className={`${styles.bdg} ${styles.eco}`}>eco</span>}
                    {p.b.includes('km0') && <span className={`${styles.bdg} ${styles.km0}`}>km 0</span>}
                    {p.b.includes('season') && <span className={`${styles.bdg} ${styles.season}`}>temporada</span>}
                    {p.b.includes('lock') && <span className={`${styles.bdg} ${styles.lock}`}>🔒 socias</span>}
                  </div>
                  {p.ini}
                  {p.lk && <div className={styles['lock-ovl']}>Reservado<br />a socias</div>}
                </div>
                <div className={styles['prod-body']}>
                  <div className={styles['prod-prod']}>{p.pr}</div>
                  <div className={styles['prod-name']}>{p.n}</div>
                  <div style={{fontSize:'11px',color:'var(--mb-muted)'}}>{p.u}</div>
                  <div className={styles['prod-meta']}>
                    <div className={styles['prod-price']}>{p.pri.toFixed(2).replace('.', ',')} €</div>
                    <button className={styles['prod-add']} disabled={p.lk}>+</button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <aside className={styles.side}>
            <h3>Tu <em>cesta</em></h3>
            <div className={styles.pic}>Recogida en local · jueves 21 may 18:00</div>
            <div>
              {cart.map((c, i) => (
                <div key={i} className={styles['cart-line']}>
                  <div
                    className={styles['cart-thumb']}
                    style={{
                      background: c.col,
                      ...(c.col === '#FBF9F3'
                        ? { color: 'var(--mb-text)', border: '1px solid var(--mb-line)' }
                        : {}),
                    }}
                  >
                    {c.ini}
                  </div>
                  <div className={styles['cart-info']}>
                    <div className={styles['cart-name']}>{c.n}</div>
                    <div className={styles['cart-q']}>{c.q}</div>
                  </div>
                  <div className={styles['cart-pr']}>{c.pri.toFixed(2).replace('.', ',')} €</div>
                </div>
              ))}
            </div>
            <div className={styles.tot}>
              <div className={styles['tot-r']}><span>Subtotal</span><span>21,40 €</span></div>
              <div className={styles['tot-r']}><span>IVA incluido</span><span>1,52 €</span></div>
              <div className={`${styles['tot-r']} ${styles.big}`}><span>Total</span><span>21,40 €</span></div>
            </div>
            <div className={styles.could}>Como socia este pedido te costaría <strong>18,80 €</strong>. Ahorrarías 2,60 € hoy.</div>
            <button className={styles.go}>Pagar pedido</button>
            <div className={styles['go-sub']}>Pago con tarjeta o Bizum · sin registro obligatorio</div>
          </aside>
        </div>
      </div>
    </>
  );
}
