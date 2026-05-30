import { useState } from 'react'
import RoleCrumb from '../../components/RoleCrumb.jsx'
import styles from './Cajero.module.css'
import { CATEGORIES, PRODUCTS, INITIAL_LINES } from '../../data/cajero.js'

const DISCOUNT = 0.12
const VAT_RATE = 0.0869 // derived: 2.68 / (33.54 - 4.02) ≈ 9%

function fmtEur(n) {
  return n.toFixed(2).replace('.', ',')
}

export default function Cajero() {
  const [activeCategory, setActiveCategory] = useState('Todo')
  const [lines, setLines] = useState(INITIAL_LINES)

  // Add a product card click → add 1 unit (or +1 qty if already in ticket)
  function handleAddProduct(product) {
    setLines((prev) => {
      const existing = prev.find((l) => l.id === product.id)
      if (existing) {
        return prev.map((l) =>
          l.id === product.id ? { ...l, qty: l.qty + 1 } : l
        )
      }
      return [
        ...prev,
        {
          id: product.id,
          ini: product.ini,
          nm: product.nm,
          ph: product.ph,
          col: product.col,
          qty: 1,
          prUnit: product.pr,
          granel: product.granel,
          granelLabel: null,
        },
      ]
    })
  }

  function handleQty(lineId, delta) {
    setLines((prev) =>
      prev
        .map((l) => (l.id === lineId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0)
    )
  }

  // Derived totals
  const subtotal = lines.reduce((sum, l) => sum + l.prUnit * l.qty, 0)
  const discount = subtotal * DISCOUNT
  const discounted = subtotal - discount
  const vat = discounted * VAT_RATE
  const total = discounted

  const granelCount = lines.filter((l) => l.granel).length
  const lineCount = lines.length

  return (
    <div className={styles.root}>
      <RoleCrumb />

      <header className={styles.topbar}>
        <div className={styles['tb-l']}>
          <div className={styles['brand-mark']}>m</div>
          <div>
            <strong>macabeo<em>.</em></strong>
            <small>caja · terminal 01</small>
          </div>
        </div>
        <div className={styles['tb-c']}>
          <div className={styles['tb-stat']}>
            <span className={styles.dot}></span>turno abierto
            <strong>10:00 — 14:30</strong>
          </div>
          <div className={styles['tb-stat']}>
            caja del día<strong>847,40 €</strong>
          </div>
          <div className={styles['tb-stat']}>
            tickets<strong>32</strong>
          </div>
        </div>
        <div className={styles['tb-r']}>
          <div className={styles.av}>N</div>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>Noa Ferreiro</span>
        </div>
      </header>

      <div className={styles.layout}>
        {/* LEFT — product grid */}
        <div className={styles.left}>
          <div className={styles.search}>
            <input defaultValue="" placeholder="Buscar o escanear: SKU, nombre, código de barras…" />
          </div>
          <div className={styles.qchip}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                className={activeCategory === cat ? styles.on : undefined}
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className={styles['tpv-grid']}>
            {PRODUCTS.map((p) => {
              const emStyle = p.col
                ? { background: p.col }
                : {
                    background: 'var(--mb-surface)',
                    color: 'var(--mb-text)',
                    border: '1px solid var(--mb-line)',
                  }
              const prUnit = p.granel ? '€/kg' : '€'
              return (
                <button
                  key={p.id}
                  className={`${styles['tpv-card']}${p.granel ? ` ${styles.granel}` : ''}`}
                  onClick={() => handleAddProduct(p)}
                >
                  <div className={styles.em} style={emStyle}>{p.ini}</div>
                  <div className={styles.nm}>{p.nm}</div>
                  <div className={styles.ph}>{p.ph}</div>
                  <div className={styles.pr}>
                    {fmtEur(p.pr)} <em>{prUnit}</em>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* RIGHT — ticket */}
        <aside className={styles.right}>
          <div className={styles.member}>
            <div className={styles.av}>M</div>
            <div>
              <div className={styles.nm}>Marta Vilar</div>
              <div className={styles.ct}>socia #042 · activa</div>
            </div>
            <span className={styles['tag-s']}>precio socia</span>
          </div>

          <div className={styles['cart-h']}>
            <h3>Ticket <em>en curso</em></h3>
            <span className={styles.ct}>
              {lineCount} {lineCount === 1 ? 'línea' : 'líneas'}
              {granelCount > 0 ? ` · ${granelCount} granel` : ''}
            </span>
          </div>

          <div className={styles['cart-list']}>
            {lines.map((line) => {
              const emStyle = line.col
                ? { background: line.col }
                : {
                    background: 'var(--mb-surface)',
                    color: 'var(--mb-text)',
                    border: '1px solid var(--mb-line)',
                  }
              const lineTotal = line.prUnit * line.qty
              const qtyLabel = line.granelLabel ? line.granelLabel : String(line.qty)
              return (
                <div key={line.id} className={styles['cart-line']}>
                  <div className={styles.em} style={emStyle}>{line.ini}</div>
                  <div>
                    <div className={styles.nm}>{line.nm}</div>
                    <div className={styles.ph}>{line.ph}</div>
                  </div>
                  <div className={styles['q-ctrl']}>
                    <button onClick={() => handleQty(line.id, -1)}>−</button>
                    <span>{qtyLabel}</span>
                    <button onClick={() => handleQty(line.id, 1)}>+</button>
                  </div>
                  <div className={styles.pr}>{fmtEur(lineTotal)} €</div>
                </div>
              )
            })}
          </div>

          <div className={styles.tot}>
            <div className={styles['tot-r']}>
              <span>Subtotal</span>
              <span>{fmtEur(subtotal)} €</span>
            </div>
            <div className={styles['tot-r']}>
              <span>Descuento socia (−12%)</span>
              <span style={{ color: 'var(--mb-success)' }}>−{fmtEur(discount)} €</span>
            </div>
            <div className={styles['tot-r']}>
              <span>IVA incluido</span>
              <span>{fmtEur(vat)} €</span>
            </div>
            <div className={`${styles['tot-r']} ${styles.big}`}>
              <span>Total</span>
              <span>{fmtEur(total)} <em>€</em></span>
            </div>
            <div className={styles.save}>✓ Ahorrado como socia {fmtEur(discount)} €</div>
          </div>

          <div className={styles.pay}>
            <button onClick={(e) => e.preventDefault()}>
              <small>F1</small><span>Efectivo</span>
            </button>
            <button onClick={(e) => e.preventDefault()}>
              <small>F2</small><span>Tarjeta</span>
            </button>
            <button onClick={(e) => e.preventDefault()}>
              <small>F3</small><span>Bizum</span>
            </button>
            <button onClick={(e) => e.preventDefault()}>
              <small>F4</small><span>Cuenta socia</span>
            </button>
            <button
              className={styles.primary}
              onClick={(e) => e.preventDefault()}
            >
              <small>↵ Cobrar</small>
              <span className={styles.l}>{fmtEur(total)} €</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}
