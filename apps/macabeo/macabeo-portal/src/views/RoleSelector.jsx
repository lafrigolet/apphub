import { Link } from 'react-router-dom'
import { roles, pillLabel, pillClass } from '../data/roles.js'
import styles from './RoleSelector.module.css'

// Prototype role hub (index.html): selector grid of the 11 role SPAs.
export default function RoleSelector() {
  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <div className={styles.brand}>
          <div className={styles['brand-mark']}>m</div>
          <div>
            <h1>macabeo<em>.</em></h1>
            <p>Economato ecológico · Prototipo navegable</p>
          </div>
        </div>
        <span className={styles.tag}>Versión de revisión · v0.1</span>
      </header>

      <section className={styles.intro}>
        <h2>Selecciona un <em>rol</em> para verificar su interfaz antes de implementarla.</h2>
        <p>Cada vista es una SPA autónoma con datos simulados, pensada para validar la propuesta de valor, los flujos clave y la coherencia visual del sistema antes del desarrollo.</p>
      </section>

      <div className={styles.legend}>
        <span>11 roles</span>
        <span>Front office</span>
        <span>Back office</span>
        <span>Portales externos</span>
      </div>

      <div className={styles.grid}>
        {roles.map((r) => (
          <Link key={r.to} className={styles.card} to={r.to}>
            <div className={styles.num}>{r.num}</div>
            <h3>{r.title.a}<em>{r.title.em}</em>{r.title.b}</h3>
            <p>{r.desc}</p>
            <div className={styles.meta}>
              <span className={`${styles.pill} ${styles[pillClass[r.pill]]}`}>{pillLabel[r.pill]}</span>
              <span className={styles.arrow}>→</span>
            </div>
          </Link>
        ))}
      </div>

      <footer className={styles.footer}>
        <span>Macabeo · Economato ecológico</span>
        <span>Prototipo navegable · <code>React + Vite</code></span>
      </footer>
    </div>
  )
}
