import { useState } from 'react';
import RoleCrumb from '../../components/RoleCrumb.jsx';
import { PENDING_ORDERS, CERTIFICATES, UPLOADED_FILES, ORDER_HISTORY } from '../../data/proveedor.js';
import styles from './Proveedor.module.css';

export default function Proveedor() {
  const [orders, setOrders] = useState(PENDING_ORDERS);

  function handleConfirm(id) {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, confirmed: true } : o));
  }

  return (
    <div className={styles.root}>
      <RoleCrumb />

      <header className={styles.topbar}>
        <div className={styles['tb-inner']}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <a href="#" className={styles.brand} onClick={(e) => e.preventDefault()}>
              <span className={styles['brand-mark']}>m</span>
              <div>
                <strong>macabeo<em>.</em></strong>
                <small>portal de productoras</small>
              </div>
            </a>
            <span className={styles['ext-tag']}>acceso externo</span>
          </div>
          <nav className={styles.nav}>
            <a href="#" className={styles.active} onClick={(e) => e.preventDefault()}>Pedidos</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Catálogo</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Documentación</a>
            <a href="#" onClick={(e) => e.preventDefault()}>Facturación</a>
          </nav>
          <div className={styles.user}>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>Granxa Meixón</span>
            <div className={styles.avatar}>M</div>
          </div>
        </div>
      </header>

      <div className={styles.wrap}>
        <header className={styles.top}>
          <div>
            <div className={styles.eb}>Granxa Meixón S.L. · proveedora desde 2019</div>
            <h1>3 pedidos <em>por confirmar</em>,<br />certificado vence en 18 días.</h1>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className={`${styles.btn} ${styles['btn-ghost']}`}>Descargar histórico</button>
            <button className={`${styles.btn} ${styles['btn-primary']}`}>+ Subir albarán</button>
          </div>
        </header>

        <div className={styles.alert}>
          <div className={styles.ic}>!</div>
          <div>
            <div className={styles.t}>Tu certificado CRAEGA caduca el 8 de junio (18 días)</div>
            <div className={styles.h}>Sube la renovación antes de esa fecha para mantener tu producto activo en el catálogo.</div>
          </div>
          <a href="#" onClick={(e) => e.preventDefault()}>Subir renovación →</a>
        </div>

        <section className={styles.kpis}>
          <div className={`${styles.kpi} ${styles.dark}`}>
            <div className={styles.l}>Volumen 2026</div>
            <div className={styles.v}>6.420 <em>€</em></div>
            <div className={styles.h} style={{ opacity: .7 }}>36 pedidos · YTD</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.l}>Por confirmar</div>
            <div className={styles.v}>3 <em>pedidos</em></div>
            <div className={styles.h}>312 € pendientes</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.l}>Próxima factura</div>
            <div className={styles.v}>28/05</div>
            <div className={styles.h}>vencimiento 30 días</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.l}>Valoración interna</div>
            <div className={styles.v}>4,3 <em>/ 5</em></div>
            <div className={styles.h}>2 retrasos en abril</div>
          </div>
        </section>

        <div className={styles.split}>
          <div className={styles.panel}>
            <div className={styles['panel-h']}>
              <h3>Pedidos <em>recibidos</em></h3>
              <span style={{ fontSize: '11px', color: 'var(--mb-muted)', fontWeight: 600 }}>3 por confirmar · 5 confirmados</span>
            </div>

            {orders.map((o) => (
              <div key={o.id} className={`${styles.po}${o.confirmed ? ` ${styles.confirmed}` : ''}`}>
                <div className={styles['po-h']}>
                  <div>
                    <code>{o.id}</code>
                    <div className={styles.nm}>
                      {o.buyer} · <em>{o.buyerSub}</em>
                    </div>
                  </div>
                  <div className={styles.when}>{o.received}</div>
                </div>

                {o.lines.length > 0 && (
                  <div className={styles['po-lines']}>
                    {o.lines.map((line, i) => (
                      <div key={i} className={styles['po-line']}>
                        <div className={styles.ln}>{line.name}</div>
                        <div className={styles.qy}>{line.qty}</div>
                        <div className={styles.pr}>{line.price}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className={styles['po-foot']}>
                  <div className={styles.tot}><em>Total</em>{o.total}</div>
                  <div className={styles['po-actions']}>
                    {o.actions.includes('propose') && (
                      <button className={styles.mini}>Proponer cambio</button>
                    )}
                    {o.actions.includes('postpone') && (
                      <button className={`${styles.mini} ${styles.alt}`}>Aplazar fecha</button>
                    )}
                    {o.actions.includes('confirm') && !o.confirmed && (
                      <button className={`${styles.mini} ${styles.acc}`} onClick={() => handleConfirm(o.id)}>✓ Confirmar pedido</button>
                    )}
                    {o.actions.includes('detail') && (
                      <button className={styles.mini}>Detalle</button>
                    )}
                    {o.actions.includes('albaran') && (
                      <button className={styles.mini}>Ver albarán</button>
                    )}
                    {o.actions.includes('invoice') && (
                      <button className={`${styles.mini} ${styles.dark}`}>Subir factura</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div>
            <div className={styles.panel} style={{ marginBottom: '20px' }}>
              <div className={styles['panel-h']}>
                <h3>Mis <em>certificados</em></h3>
              </div>
              <div className={styles['cert-list']}>
                {CERTIFICATES.map((c, i) => (
                  <div key={i} className={`${styles['cert-row']} ${styles[c.status]}`}>
                    <div className={styles.ic}>{c.icon}</div>
                    <div>
                      <div className={styles.nm}>{c.name}</div>
                      <div className={styles.hh}>{c.hint}</div>
                    </div>
                    <span className={styles.st}>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.panel}>
              <div className={styles['panel-h']}>
                <h3>Subir <em>documentación</em></h3>
              </div>
              <div className={styles['upload-area']}>
                <strong>📎 Arrastra o selecciona archivo</strong>
                <span>PDF, JPG, PNG hasta 8 MB · albarán, factura o certificado</span>
              </div>
              <div className={styles['upload-list']}>
                {UPLOADED_FILES.map((f, i) => (
                  <div key={i} className={styles['up-row']}>
                    <div className={styles.doc}>{f.type}</div>
                    <div>
                      <div className={styles.nm}>{f.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--mb-muted)' }}>{f.date}</div>
                    </div>
                    <div className={styles.sz}>{f.size}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles['panel-h']}>
            <h3>Histórico <em>de pedidos</em></h3>
            <a href="#" style={{ fontSize: '12px', color: 'var(--mb-primary)', textDecoration: 'none', fontWeight: 700 }} onClick={(e) => e.preventDefault()}>Exportar CSV →</a>
          </div>
          <table className={styles.hist}>
            <thead>
              <tr>
                <th>OC</th>
                <th>Fecha</th>
                <th>Líneas</th>
                <th>Importe</th>
                <th>Estado</th>
                <th>Factura</th>
                <th>Pago</th>
              </tr>
            </thead>
            <tbody>
              {ORDER_HISTORY.map((row, i) => (
                <tr key={i}>
                  <td><code>{row.oc}</code></td>
                  <td>{row.date}</td>
                  <td>{row.lines}</td>
                  <td>{row.amount}</td>
                  <td><span className={`${styles.tag} ${styles[row.status]}`}>{row.statusLabel}</span></td>
                  <td>{row.invoice ? <code>{row.invoice}</code> : '—'}</td>
                  <td>
                    {row.payment
                      ? <span className={`${styles.tag} ${styles.paid}`}>{row.payment}</span>
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
