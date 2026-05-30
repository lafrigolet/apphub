import { useState } from 'react'
import RoleCrumb from '../../components/RoleCrumb.jsx'
import styles from './Administrador.module.css'
import {
  sidebarGroups,
  kpis,
  chartBars,
  alerts,
  orders,
  permCards,
} from '../../data/administrador.js'

const PERIODS = ['7d', '17d', '30d', '90d']

export default function Administrador() {
  const [activePeriod, setActivePeriod] = useState('17d')

  return (
    <div className={styles.root}>
      <RoleCrumb />

      <aside className={styles.side}>
        <div className={styles.brand}>
          <div className={styles['brand-mark']}>m</div>
          <div>
            <strong style={{ color: 'var(--mb-surface)' }}>
              macabeo<em>.</em>
            </strong>
            <small>admin · v0.1</small>
          </div>
        </div>

        {sidebarGroups.map((group) => (
          <div key={group.title} className={styles['s-group']}>
            <div className={styles['s-title']}>{group.title}</div>
            {group.links.map((link) => (
              <a
                key={link.label}
                href="#"
                onClick={(e) => e.preventDefault()}
                className={link.active ? `${styles['s-link']} ${styles.on}` : styles['s-link']}
              >
                <span className={styles.ic}>{link.icon}</span>
                {link.label}
                {link.num != null && (
                  <span className={styles.num}>{link.num}</span>
                )}
              </a>
            ))}
          </div>
        ))}

        <div className={styles['s-foot']}>
          <div className={styles.av}>X</div>
          <div>
            <div className={styles.nm}>Xoán Pereira</div>
            <div className={styles.ro}>Administrador</div>
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.top}>
          <div>
            <div className={styles.eb}>Cuadro de mando · 1 al 17 de mayo de 2026</div>
            <h1>Una visión <em>completa</em> del economato.</h1>
          </div>
          <div className={styles.acts}>
            <button className={`${styles.btn} ${styles['btn-ghost']}`}>Periodo · 17 d</button>
            <button className={`${styles.btn} ${styles['btn-ghost']}`}>Exportar CSV</button>
            <button className={`${styles.btn} ${styles['btn-primary']}`}>+ Nueva campaña</button>
          </div>
        </header>

        <section className={styles.kpis}>
          {kpis.map((kpi) => (
            <div
              key={kpi.label}
              className={kpi.dark ? `${styles.kpi} ${styles.dark}` : styles.kpi}
            >
              <div className={styles.l}>{kpi.label}</div>
              <div className={styles.v}>
                {kpi.value} <em>{kpi.unit}</em>
              </div>
              <div
                className={
                  kpi.deltaDir === 'up'
                    ? `${styles.delta} ${styles.up}`
                    : `${styles.delta} ${styles.down}`
                }
              >
                {kpi.delta}
              </div>
            </div>
          ))}
        </section>

        <div className={styles.row}>
          <div className={styles.panel}>
            <div className={styles['panel-h']}>
              <h3>Ventas <em>diarias</em></h3>
              <div className={styles.filters}>
                {PERIODS.map((p) => (
                  <button
                    key={p}
                    className={activePeriod === p ? styles.on : undefined}
                    onClick={() => setActivePeriod(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.chart} data-l="3.200 €">
              {chartBars.map((bar, i) => {
                let cls = styles.bar
                if (bar.extra === 'acc') cls = `${styles.bar} ${styles.acc}`
                else if (bar.extra === 'on') cls = `${styles.bar} ${styles.on}`
                return (
                  <div
                    key={i}
                    className={cls}
                    style={{ height: bar.height }}
                    data-l={bar.label}
                  />
                )
              })}
            </div>
            <div className={styles['chart-foot']}>
              <span>Media diaria <strong>1.672 €</strong></span>
              <span>Pico el jue 14 (cierre semanal): <strong>2.890 €</strong></span>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles['panel-h']}>
              <h3>Alertas <em>activas</em></h3>
              <span style={{ fontSize: '11px', color: 'var(--mb-muted)', fontWeight: 600 }}>
                7 sin resolver
              </span>
            </div>
            <div className={styles.alerts}>
              {alerts.map((alert, i) => (
                <div key={i} className={`${styles.alert} ${styles[alert.type]}`}>
                  <div className={styles.ic}>{alert.icon}</div>
                  <div>
                    <div className={styles.t}>{alert.title}</div>
                    <div className={styles.h}>{alert.hint}</div>
                  </div>
                  <a href="#" onClick={(e) => e.preventDefault()}>{alert.cta}</a>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.panel} style={{ marginBottom: '26px' }}>
          <div className={styles['panel-h']}>
            <h3>Últimos <em>pedidos</em></h3>
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              style={{ fontSize: '12px', color: 'var(--mb-primary)', textDecoration: 'none', fontWeight: 700 }}
            >
              Ver todos →
            </a>
          </div>
          <table className={styles.t}>
            <thead>
              <tr>
                <th>#</th>
                <th>Socia/Cliente</th>
                <th>Líneas</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Recogida</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td><code>{order.id}</code></td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        className={styles.av}
                        style={{ background: order.avatarBg, color: order.avatarColor }}
                      >
                        {order.avatarLetter}
                      </span>
                      {order.name}
                    </span>
                  </td>
                  <td>{order.lines}</td>
                  <td>{order.totalBold ? <strong>{order.total}</strong> : order.total}</td>
                  <td>
                    <span className={`${styles.tag} ${styles[order.tagClass]}`}>
                      {order.tagLabel}
                    </span>
                  </td>
                  <td>{order.pickup}</td>
                  <td>
                    <a
                      href="#"
                      onClick={(e) => e.preventDefault()}
                      style={{ fontSize: '11px', color: 'var(--mb-primary)', fontWeight: 700 }}
                    >
                      →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.panel}>
          <div className={styles['panel-h']}>
            <h3>Roles y <em>cobertura</em> del equipo</h3>
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              style={{ fontSize: '12px', color: 'var(--mb-primary)', textDecoration: 'none', fontWeight: 700 }}
            >
              Gestionar permisos →
            </a>
          </div>
          <div className={styles['perm-row']}>
            {permCards.map((card) => (
              <div key={card.role} className={styles['perm-card']}>
                <div className={styles.role}>
                  {card.roleEm ? (
                    <>{card.role} <em>{card.roleEm}</em></>
                  ) : (
                    card.role
                  )}
                </div>
                <div className={styles.ct}>
                  {card.warning ? (
                    <>
                      {card.ctPrefix}
                      <span style={{ color: 'var(--mb-warning)' }}>{card.ctWarning}</span>
                    </>
                  ) : (
                    card.ct
                  )}
                </div>
                <div className={styles.dots}>
                  {Array.from({ length: card.total }, (_, idx) => (
                    <span key={idx} className={idx < card.filled ? styles.f : undefined} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
