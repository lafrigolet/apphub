import RoleCrumb from '../../components/RoleCrumb.jsx'
import styles from './Comprador.module.css'
import { pipelineColumns, providers, suggestions, comparators } from '../../data/comprador.js'

export default function Comprador() {
  return (
    <div className={styles.root}>
      <RoleCrumb />

      <aside className={styles.side}>
        <div className={styles.brand}>
          <div className={styles['brand-mark']}>m</div>
          <div>
            <strong style={{ color: 'var(--mb-surface)' }}>macabeo<em>.</em></strong>
            <small>compras</small>
          </div>
        </div>
        <a className={`${styles['s-link']} ${styles.on}`} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◐</span>Pipeline OC<span className={styles.num}>18</span>
        </a>
        <a className={styles['s-link']} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◑</span>Proveedoras<span className={styles.num}>34</span>
        </a>
        <a className={styles['s-link']} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◓</span>Sugerencias<span className={styles.num}>7</span>
        </a>
        <a className={styles['s-link']} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◧</span>Certificados
        </a>
        <a className={styles['s-link']} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◔</span>Comparador
        </a>
        <div className={styles['s-title']}>Histórico</div>
        <a className={styles['s-link']} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◌</span>Compras 2026
        </a>
        <a className={styles['s-link']} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◍</span>Por productora
        </a>
        <div className={styles['s-foot']}>
          <div className={styles.av}>S</div>
          <div>
            <div className={styles.nm}>Sabela Riveiro</div>
            <div className={styles.ro}>Compras</div>
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.top}>
          <div>
            <div className={styles.eb}>Compras · semana 21 · jueves 21 may</div>
            <h1>18 órdenes <em>activas</em>, 7 sugerencias por revisar.</h1>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className={`${styles.btn} ${styles['btn-ghost']}`}>Ver calendario</button>
            <button className={`${styles.btn} ${styles['btn-primary']}`}>+ Nueva OC</button>
          </div>
        </header>

        <section className={styles.pipeline}>
          {pipelineColumns.map((col) => (
            <div key={col.label} className={styles.pcol}>
              <div className={styles['pcol-h']}>
                <h3>{col.label}</h3>
                <span className={styles.ct}>{col.count}</span>
              </div>
              {col.cards.map((card) => (
                <div
                  key={card.code}
                  className={
                    card.variant
                      ? `${styles.pcard} ${styles[card.variant]}`
                      : styles.pcard
                  }
                >
                  <code>{card.code}</code>
                  <div className={styles.nm}>{card.name}</div>
                  <div className={styles.mm}>
                    <span>{card.meta}</span>
                    <strong>{card.amount}</strong>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </section>

        <div className={styles.row}>
          <div className={styles.panel}>
            <div className={styles['panel-h']}>
              <h3>Productoras <em>activas</em></h3>
              <a
                href="#"
                onClick={(e) => e.preventDefault()}
                style={{ fontSize: '12px', color: 'var(--mb-primary)', textDecoration: 'none', fontWeight: 700 }}
              >
                Ver fichas →
              </a>
            </div>
            <div className={styles['prov-grid']}>
              {providers.map((p) => (
                <div key={p.name} className={styles.prov}>
                  <div className={styles['prov-h']}>
                    <div
                      className={styles.av}
                      style={{ background: p.avatarBg, color: p.avatarColor }}
                    >
                      {p.letter}
                    </div>
                    <div>
                      <div className={styles.nm}>{p.name}</div>
                      <div className={styles.ct}>{p.location}</div>
                    </div>
                  </div>
                  <div className={styles.stars}>
                    {'★'.repeat(p.stars)}
                    {p.stars < 5 && <span>{'★'.repeat(5 - p.stars)}</span>}
                  </div>
                  <div className={styles['prov-certs']}>
                    {p.certs.map((c) => (
                      <span
                        key={c.label}
                        className={c.expiring ? `${styles.cert} ${styles.expiring}` : styles.cert}
                      >
                        {c.label}
                      </span>
                    ))}
                  </div>
                  <div className={styles['prov-data']}>
                    <div>vol. anual<strong>{p.annual}</strong></div>
                    <div>pedidos<strong>{p.orders}</strong></div>
                    <div>retraso<strong>{p.delay}</strong></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles['panel-h']}>
              <h3>Sugerencias <em>auto</em></h3>
              <span style={{ fontSize: '11px', color: 'var(--mb-muted)', fontWeight: 600 }}>según stock mín.</span>
            </div>
            <div className={styles.sug}>
              {suggestions.map((s) => (
                <div key={s.name} className={styles['sug-row']}>
                  <div className={styles.ic}>!</div>
                  <div>
                    <div className={styles.nm}>{s.name}</div>
                    <div className={styles.hh}>{s.hint}</div>
                  </div>
                  <div className={styles.qty}>{s.qty} <em>{s.unit}</em></div>
                  <button className={styles.mini}>Crear OC</button>
                </div>
              ))}
            </div>
            <button
              className={`${styles.btn} ${styles['btn-ghost']}`}
              style={{ width: '100%', justifyContent: 'center', marginTop: '14px' }}
            >
              Agrupar en OC consolidada ({suggestions.length} líneas) →
            </button>
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles['panel-h']}>
            <h3>Comparador <em>de costes</em> · garbanzo castellano</h3>
            <span style={{ fontSize: '11px', color: 'var(--mb-muted)', fontWeight: 600 }}>€/kg · datos de los últimos 6 meses</span>
          </div>
          <div className={styles.compare}>
            {comparators.map((c) => (
              <div
                key={c.name}
                className={c.win ? `${styles.cmp} ${styles.win}` : styles.cmp}
              >
                <div className={styles.nm}>{c.name}</div>
                <div className={styles.pr}>{c.price} <em>{c.unit}</em></div>
                <div className={styles.h}>{c.note}</div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
