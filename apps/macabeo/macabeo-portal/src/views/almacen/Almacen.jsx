import { useState } from 'react'
import RoleCrumb from '../../components/RoleCrumb.jsx'
import styles from './Almacen.module.css'
import { expiryItems, stockRows, zones, mermaRows } from '../../data/almacen.js'

export default function Almacen() {
  const [expiryWindow, setExpiryWindow] = useState(7)
  const [stockFilter, setStockFilter] = useState('Crítico')

  const expiryWindows = [3, 7, 15]
  const stockFilters = ['Crítico', 'Bajo', 'Todo']

  const visibleExpiry = expiryItems.filter(item => item.window <= expiryWindow)

  const visibleStock = stockRows.filter(row => {
    if (stockFilter === 'Crítico') return row.level === 'cr'
    if (stockFilter === 'Bajo') return row.level === 'lo' || row.level === 'cr'
    return true
  })

  function expiryRowClass(window) {
    if (window <= 3) return `${styles.expRow} ${styles.r3}`
    if (window <= 7) return `${styles.expRow} ${styles.r7}`
    return `${styles.expRow} ${styles.r15}`
  }

  return (
    <div className={styles.root}>
      <RoleCrumb />

      <aside className={styles.side}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>m</div>
          <div>
            <strong style={{ color: 'var(--mb-surface)' }}>macabeo<em>.</em></strong>
            <small>almacén</small>
          </div>
        </div>
        <a className={`${styles.sLink} ${styles.on}`} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◐</span>Inventario<span className={styles.num}>312</span>
        </a>
        <a className={styles.sLink} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◑</span>Caducidades<span className={`${styles.num} ${styles.danger}`}>12</span>
        </a>
        <a className={styles.sLink} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◓</span>Recepción
        </a>
        <a className={styles.sLink} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◧</span>Lotes &amp; trazabilidad
        </a>
        <a className={styles.sLink} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◔</span>Mermas<span className={styles.num}>7</span>
        </a>
        <div className={styles.sTitle}>Configuración</div>
        <a className={styles.sLink} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◌</span>Ubicaciones
        </a>
        <a className={styles.sLink} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◍</span>Alertas y umbrales
        </a>
        <div className={styles.sFoot}>
          <div className={styles.av}>B</div>
          <div>
            <div className={styles.nm}>Brais Lema</div>
            <div className={styles.ro}>Responsable almacén</div>
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.top}>
          <div>
            <div className={styles.eb}>Almacén Cambre · jueves 21 may · 10:42</div>
            <h1>312 referencias <em>activas</em>, 12 con caducidad inminente.</h1>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className={`${styles.btn} ${styles.btnGhost}`}>Inventario físico</button>
            <button className={`${styles.btn} ${styles.btnPrimary}`}>+ Registrar recepción</button>
          </div>
        </header>

        <section className={styles.kpis}>
          <div className={styles.kpi}>
            <div className={styles.l}>Valor inventario</div>
            <div className={styles.v}>18.420 <em>€</em></div>
            <div className={styles.h}>a coste · 312 SKUs</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.l}>Rotación media</div>
            <div className={styles.v}>12,4 <em>días</em></div>
            <div className={styles.h}>↘ 1,2 d vs trimestre</div>
          </div>
          <div className={`${styles.kpi} ${styles.alarm}`}>
            <div className={styles.l}>Caducidades &lt;7 días</div>
            <div className={styles.v}>12 <em>SKUs</em></div>
            <div className={styles.h}>valor 168 € · campaña?</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.l}>Merma últimos 30d</div>
            <div className={styles.v}>182 <em>€</em></div>
            <div className={styles.h}>0,98% sobre ventas</div>
          </div>
        </section>

        <div className={styles.row}>
          {/* Caducidades próximas */}
          <div className={styles.panel}>
            <div className={styles.panelH}>
              <h3>Caducidades <em>próximas</em></h3>
              <div style={{ display: 'flex', gap: '6px' }}>
                {expiryWindows.map(w => (
                  <button
                    key={w}
                    className={expiryWindow === w ? `${styles.mini} ${styles.miniOn}` : styles.mini}
                    onClick={() => setExpiryWindow(w)}
                  >
                    {w} días
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.exp}>
              {visibleExpiry.map(item => (
                <div key={item.id} className={expiryRowClass(item.window)}>
                  <div className={styles.days}>{item.days}<em>días</em></div>
                  <div>
                    <div className={styles.nm}>{item.name}</div>
                    <div className={styles.hh}>{item.lot}</div>
                  </div>
                  <div className={styles.qty}>{item.qty} <em>{item.unit}</em></div>
                  <button className={styles.mini}>Acción →</button>
                </div>
              ))}
            </div>
          </div>

          {/* Recepción de mercancía */}
          <div className={styles.panel}>
            <div className={styles.panelH}>
              <h3>Recepción de <em>mercancía</em></h3>
            </div>
            <div className={styles.formGrid}>
              <div className={`${styles.field} ${styles.full}`}>
                <label>Proveedor</label>
                <select defaultValue="Horta da Lúa — Betanzos">
                  <option>Horta da Lúa — Betanzos</option>
                  <option>Granxa Meixón — Curtis</option>
                  <option>Salgueiro Cereais — Lalín</option>
                </select>
              </div>
              <div className={styles.field}>
                <label>Producto / SKU</label>
                <input placeholder="Buscar o escanear…" defaultValue="Tomate kumato · FR-TKM-01" />
              </div>
              <div className={styles.field}>
                <label>Nº lote</label>
                <input placeholder="L26-0521" defaultValue="L26-0521" />
              </div>
              <div className={styles.field}>
                <label>Cantidad</label>
                <input placeholder="kg / uds" defaultValue="18,5" />
              </div>
              <div className={styles.field}>
                <label>Unidad</label>
                <select defaultValue="kg">
                  <option>kg</option>
                  <option>uds</option>
                  <option>litros</option>
                </select>
              </div>
              <div className={styles.field}>
                <label>Fecha caducidad</label>
                <input type="date" defaultValue="2026-05-31" />
              </div>
              <div className={styles.field}>
                <label>Ubicación</label>
                <select defaultValue="A-2-3 · Frescos huerta">
                  <option>A-2-3 · Frescos huerta</option>
                  <option>B-1-2 · Lácteo</option>
                  <option>C-3 · Granel</option>
                </select>
              </div>
              <div className={`${styles.field} ${styles.full}`}>
                <div className={styles.upload}>
                  <strong>📎 Adjuntar certificado eco / albarán</strong>
                  certificado-craega-tomate-may26.pdf · 0,8 MB
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
              <button className={`${styles.btn} ${styles.btnGhost}`}>Cancelar</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`}>Registrar recepción</button>
            </div>
          </div>
        </div>

        {/* Stock por referencia */}
        <div className={styles.panel} style={{ marginBottom: '24px' }}>
          <div className={styles.panelH}>
            <h3>Stock por <em>referencia</em></h3>
            <div style={{ display: 'flex', gap: '6px', fontSize: '11px' }}>
              <span style={{ color: 'var(--mb-muted)' }}>Mostrar:</span>
              {stockFilters.map(f => (
                <button
                  key={f}
                  className={stockFilter === f ? `${styles.mini} ${styles.miniOn}` : styles.mini}
                  onClick={() => setStockFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <table className={styles.tab}>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Producto</th>
                <th>Ubicación</th>
                <th>Lote / Cad.</th>
                <th>Stock</th>
                <th>Mínimo</th>
                <th>Nivel</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleStock.map(row => (
                <tr key={row.sku}>
                  <td><code>{row.sku}</code></td>
                  <td>
                    <div className={styles.nm}>{row.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--mb-muted)' }}>{row.supplier}</div>
                  </td>
                  <td><span className={styles.loc}>{row.loc}</span></td>
                  <td><code>{row.lot}</code></td>
                  <td>
                    <span className={`${styles.qty}${row.level === 'cr' ? ' ' + styles.cr : row.level === 'lo' ? ' ' + styles.lo : ''}`}>
                      {row.stock}
                    </span>
                  </td>
                  <td>{row.min}</td>
                  <td>
                    <div className={styles.lvl}>
                      <div className={styles.lvlBar}>
                        <div
                          className={`${styles.lvlFill} ${styles[row.level]}`}
                          style={{ width: `${row.pct}%` }}
                        ></div>
                      </div>
                      <span style={{
                        fontFamily: 'var(--mono)',
                        fontSize: '11px',
                        color: row.level === 'cr' ? 'var(--mb-danger)' : row.level === 'lo' ? '#8a6717' : 'var(--mb-success)'
                      }}>
                        {row.level === 'cr' ? 'crítico' : row.level === 'lo' ? 'bajo' : 'ok'}
                      </span>
                    </div>
                  </td>
                  <td>{row.level !== 'ok' && <button className={styles.mini}>+ Pedido</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.row}>
          {/* Ocupación por zona */}
          <div className={styles.panel}>
            <div className={styles.panelH}>
              <h3>Ocupación <em>por zona</em></h3>
            </div>
            <div className={styles.zones}>
              {zones.map(z => (
                <div key={z.key} className={styles.zone}>
                  <div className={styles.zh}>{z.title}</div>
                  <div className={styles.zs}>{z.sub}</div>
                  <div className={styles.occ}>
                    <span className={styles.n}>{z.n}</span>
                    <span className={styles.pct}>/{z.total}</span>
                  </div>
                  <div className={styles.track}>
                    <div
                      className={styles.fill}
                      style={{
                        width: `${z.pct}%`,
                        ...(z.fillColor ? { background: z.fillColor } : {})
                      }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mermas recientes */}
          <div className={styles.panel}>
            <div className={styles.panelH}>
              <h3>Mermas <em>recientes</em></h3>
              <a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: '12px', color: 'var(--mb-primary)', textDecoration: 'none', fontWeight: 700 }}>Ver todas →</a>
            </div>
            <div className={styles.mermaList}>
              {mermaRows.map((m, i) => (
                <div key={i} className={styles.mermaRow}>
                  <span className={styles.dt}>{m.date}</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{m.name}</div>
                    <div className={styles.rs}>{m.reason}</div>
                  </div>
                  <span className={styles.am}>{m.amount}</span>
                </div>
              ))}
            </div>
            <button className={`${styles.btn} ${styles.btnGhost}`} style={{ width: '100%', justifyContent: 'center', marginTop: '14px' }}>+ Registrar nueva merma</button>
          </div>
        </div>
      </main>
    </div>
  )
}
