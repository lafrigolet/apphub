import { useState } from 'react';
import RoleCrumb from '../../components/RoleCrumb.jsx';
import {
  sidebarLinks,
  sidebarOpsLinks,
  feeSegs,
  feeRows,
  invoices,
  producerRows,
  exportCards,
  sparkBars,
} from '../../data/tesorero.js';
import styles from './Tesorero.module.css';

export default function Tesorero() {
  const [activeSeg, setActiveSeg] = useState(0);

  return (
    <div className={styles.root}>
      <RoleCrumb />

      <aside className={styles.side}>
        <div className={styles.brand}>
          <div className={styles['brand-mark']}>m</div>
          <div>
            <strong style={{ color: 'var(--mb-surface)' }}>macabeo<em>.</em></strong>
            <small>tesorería</small>
          </div>
        </div>

        {sidebarLinks.map((lnk, i) => (
          <a
            key={i}
            className={`${styles['s-link']}${lnk.active ? ' ' + styles.on : ''}`}
            href="#"
            onClick={(e) => e.preventDefault()}
          >
            <span className={styles.ic}>{lnk.icon}</span>
            {lnk.label}
            {lnk.num !== null && (
              <span className={`${styles.num}${lnk.numClass === 'danger' ? ' ' + styles.danger : ''}`}>
                {lnk.num}
              </span>
            )}
          </a>
        ))}

        <div className={styles['s-title']}>Operaciones</div>

        {sidebarOpsLinks.map((lnk, i) => (
          <a
            key={i}
            className={styles['s-link']}
            href="#"
            onClick={(e) => e.preventDefault()}
          >
            <span className={styles.ic}>{lnk.icon}</span>
            {lnk.label}
          </a>
        ))}

        <div className={styles['s-foot']}>
          <div className={styles.av}>T</div>
          <div>
            <div className={styles.nm}>Lúa Touriño</div>
            <div className={styles.ro}>Tesorería</div>
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.top}>
          <div>
            <div className={styles.eb}>Tesorería · mayo de 2026</div>
            <h1>Cierre del mes a <em>11 días</em>, 7 impagos por gestionar.</h1>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className={`${styles.btn} ${styles['btn-ghost']}`}>Período · mayo</button>
            <button className={`${styles.btn} ${styles['btn-dark']}`}>Exportar Contasol</button>
            <button className={`${styles.btn} ${styles['btn-primary']}`}>+ Generar remesa SEPA</button>
          </div>
        </header>

        <section className={styles.kpis}>
          {/* KPI 1 — dark with sparkline */}
          <div className={`${styles.kpi} ${styles.dark}`}>
            <div className={styles.l}>Cuotas cobradas</div>
            <div className={styles.v}>2.892 <em>€</em></div>
            <div className={`${styles.delta} ${styles.up}`}>↗ 241 socias al día</div>
            <div className={styles.spark}>
              {sparkBars.map((b, i) => (
                <span key={i} style={{ height: b.height }} />
              ))}
            </div>
          </div>

          {/* KPI 2 */}
          <div className={styles.kpi}>
            <div className={styles.l}>Ventas facturadas</div>
            <div className={styles.v}>28.430 <em>€</em></div>
            <div className={`${styles.delta} ${styles.up}`}>↗ +12,4% vs mes ant.</div>
          </div>

          {/* KPI 3 — danger */}
          <div className={`${styles.kpi} ${styles.danger}`}>
            <div className={styles.l}>Impagos abiertos</div>
            <div className={styles.v}>84 <em>€</em></div>
            <div className={styles.delta}>7 socias · morosidad 0,38%</div>
          </div>

          {/* KPI 4 */}
          <div className={styles.kpi}>
            <div className={styles.l}>Pendiente productoras</div>
            <div className={styles.v}>4.842 <em>€</em></div>
            <div className={styles.delta}>18 facturas · vto. 30 d</div>
          </div>
        </section>

        {/* Row 1 */}
        <div className={styles.row}>
          {/* Cuotas panel */}
          <div className={styles.panel}>
            <div className={styles['panel-h']}>
              <h3>Cuotas <em>socias</em> · mayo 2026</h3>
              <a
                href="#"
                style={{ fontSize: '12px', color: 'var(--mb-primary)', textDecoration: 'none', fontWeight: 700 }}
                onClick={(e) => e.preventDefault()}
              >
                Ver todas →
              </a>
            </div>

            <div className={styles['fee-segs']}>
              {feeSegs.map((seg, i) => (
                <div
                  key={i}
                  className={`${styles['fee-seg']}${activeSeg === i ? ' ' + styles.on : ''}`}
                  onClick={() => setActiveSeg(i)}
                >
                  <span className={styles.n}>{seg.n}</span>
                  <div className={styles.l}>{seg.l}</div>
                </div>
              ))}
            </div>

            <table className={styles.tab}>
              <thead>
                <tr>
                  <th>Socia</th>
                  <th>Cuota</th>
                  <th>Cargo</th>
                  <th>Estado</th>
                  <th>Mandato</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {feeRows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          className={styles.av}
                          style={{ background: r.avatarBg, color: r.avatarColor }}
                        >
                          {r.avatarLetter}
                        </span>
                        {r.name}<br />
                        <code style={{ fontSize: '10px' }}>{r.id}</code>
                      </span>
                    </td>
                    <td className={styles.amt}>{r.amt}</td>
                    <td>{r.cargo}</td>
                    <td><span className={`${styles.tag} ${styles[r.tagClass]}`}>{r.tagLabel}</span></td>
                    <td><code>{r.mandato}</code></td>
                    <td>
                      {r.action && (
                        <button className={styles.mini}>{r.action}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Right column: SEPA + Facturas */}
          <div>
            <div className={styles['sepa-card']}>
              <div className={styles.eb}>próxima remesa</div>
              <h3>SEPA <em>junio</em></h3>
              <div className={styles.h}>Generación 28/05 · cargo 02/06</div>
              <div className={styles['sepa-grid']}>
                <div><div className={styles.l}>Socias</div><div className={styles.v}>253 <em>activas</em></div></div>
                <div><div className={styles.l}>Importe total</div><div className={styles.v}>3.156 <em>€</em></div></div>
                <div><div className={styles.l}>Tipo</div><div className={styles.v}>CORE <em>B2C</em></div></div>
                <div><div className={styles.l}>Acreedor</div><div className={styles.v} style={{ fontSize: '13px' }}>ES84ZZZ <em>...142</em></div></div>
              </div>
              <div className={styles['sepa-acts']}>
                <button className={styles.btn}>Previsualizar XML</button>
                <button className={`${styles.btn} ${styles.acc}`}>Generar remesa →</button>
              </div>
            </div>

            <div className={styles.panel}>
              <div className={styles['panel-h']}>
                <h3>Facturas <em>recientes</em></h3>
                <a
                  href="#"
                  style={{ fontSize: '12px', color: 'var(--mb-primary)', textDecoration: 'none', fontWeight: 700 }}
                  onClick={(e) => e.preventDefault()}
                >
                  Serie 2026-A →
                </a>
              </div>
              <div className={styles['inv-list']}>
                {invoices.map((inv, i) => (
                  <div key={i} className={styles.inv}>
                    <span className={styles.num}>{inv.num}</span>
                    <div>
                      <div className={styles.nm}>{inv.name}</div>
                      <div className={styles.h}>{inv.hint}</div>
                    </div>
                    <div
                      className={styles.am}
                      style={inv.amNeg ? { color: 'var(--mb-danger)' } : {}}
                    >
                      {inv.am}
                    </div>
                    <a className={styles.pdf} href="#" onClick={(e) => e.preventDefault()}>PDF</a>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Row 2 */}
        <div className={styles.row}>
          {/* Pagos a productoras */}
          <div className={styles.panel}>
            <div className={styles['panel-h']}>
              <h3>Pagos a <em>productoras</em></h3>
              <span style={{ fontSize: '11px', color: 'var(--mb-muted)', fontWeight: 600 }}>
                próximo lote: vie 30/05
              </span>
            </div>
            <table className={styles.tab}>
              <thead>
                <tr>
                  <th>Productora</th>
                  <th>Factura</th>
                  <th>Importe</th>
                  <th>Vencimiento</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {producerRows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          className={styles.av}
                          style={{ background: r.avatarBg, color: r.avatarColor }}
                        >
                          {r.avatarLetter}
                        </span>
                        {r.name}
                      </span>
                    </td>
                    <td><code>{r.invoice}</code></td>
                    <td className={styles.amt}>{r.amt}</td>
                    <td>{r.vto}</td>
                    <td><span className={`${styles.tag} ${styles[r.tagClass]}`}>{r.tagLabel}</span></td>
                    <td>
                      {r.tagClass === 'pend' && (
                        <button className={styles.mini}>Detalle</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Exportar contabilidad */}
          <div className={styles.panel}>
            <div className={styles['panel-h']}>
              <h3>Exportar <em>contabilidad</em></h3>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--mb-muted)', margin: '0 0 14px' }}>
              Genera ficheros para tu gestoría o sistema contable. Datos del periodo:{' '}
              <strong style={{ color: 'var(--mb-text)' }}>1 al 31 de mayo 2026</strong>.
            </p>
            <div className={styles['exp-grid']}>
              {exportCards.map((c, i) => (
                <div key={i} className={styles['exp-card']}>
                  <span className={styles.ext}>{c.ext}</span>
                  <div className={styles.nm}>{c.nm}</div>
                  <div className={styles.h}>{c.h}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
