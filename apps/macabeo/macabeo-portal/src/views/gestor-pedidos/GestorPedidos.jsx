import { useState } from 'react';
import RoleCrumb from '../../components/RoleCrumb.jsx';
import styles from './GestorPedidos.module.css';
import { QUEUE_ORDERS, ACTIVE_ORDER, PICKING_ZONES } from '../../data/gestor-pedidos.js';

export default function GestorPedidos() {
  // activeOrderId tracks which queue item has .act
  const [activeOrderId, setActiveOrderId] = useState('P-2026-0142');

  // checkedLines tracks which picking lines have been checked off (keyed by sku or zone+index)
  const [checked, setChecked] = useState(() => {
    const init = {};
    PICKING_ZONES.forEach((z) => {
      z.lines.forEach((l, i) => {
        const key = l.sku ?? `${z.zone}-${i}`;
        init[key] = l.status === 'done';
      });
    });
    return init;
  });

  function toggleCheck(key) {
    setChecked((prev) => {
      if (prev[key]) return prev; // already done, no-op (mirrors original behavior)
      return { ...prev, [key]: true };
    });
  }

  return (
    <div className={styles.root}>
      <RoleCrumb />

      <aside className={styles.side}>
        <div className={styles.brand}>
          <div className={styles['brand-mark']}>m</div>
          <div>
            <strong style={{ color: 'var(--mb-surface)' }}>macabeo<em>.</em></strong>
            <small>operación</small>
          </div>
        </div>
        <a className={`${styles['s-link']} ${styles.on}`} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◐</span>Cola de pedidos<span className={styles.num}>14</span>
        </a>
        <a className={styles['s-link']} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◑</span>Sustituciones<span className={styles.num}>3</span>
        </a>
        <a className={styles['s-link']} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◓</span>Incidencias
        </a>
        <a className={styles['s-link']} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◔</span>Cerrados hoy<span className={styles.num}>22</span>
        </a>
        <div className={styles['s-title']}>Turno</div>
        <a className={styles['s-link']} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◌</span>Mi jornada
        </a>
        <a className={styles['s-link']} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◧</span>Imprimir lista
        </a>
        <div className={styles['s-foot']}>
          <div className={styles.av}>A</div>
          <div>
            <div className={styles.nm}>Antía Recouso</div>
            <div className={styles.ro}>Gestora de pedidos</div>
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.top}>
          <div>
            <div className={styles.eb}>Turno · jueves 21 may · 16:00–20:00</div>
            <h1>14 pedidos para <em>preparar</em> antes de las 18:00.</h1>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className={`${styles.btn} ${styles['btn-ghost']}`}>Imprimir lista</button>
            <button className={`${styles.btn} ${styles['btn-primary']}`}>Cerrar lote</button>
          </div>
        </header>

        <div className={styles.progress}>
          <div className={styles.info}>
            9 de 14 pedidos <em>completados</em>
            <div className={styles.h}>Ritmo: 1 pedido cada 8 min · ETA 17:48</div>
          </div>
          <div className={styles.track}><div className={styles.fill}></div></div>
          <div className={styles.stats}>
            <div><strong>62<em>%</em></strong>preparado</div>
            <div><strong>3</strong>incidencias</div>
            <div><strong>2</strong>sustituciones</div>
          </div>
        </div>

        <div className={styles.gridb}>
          <aside className={styles.queue}>
            <div className={styles['queue-h']}>
              <h3>Cola de <em>preparación</em></h3>
              <span style={{ fontSize: '11px', color: 'var(--mb-muted)', fontWeight: 600 }}>14 pedidos</span>
            </div>
            <div className={styles['queue-list']}>
              {QUEUE_ORDERS.map((order) => (
                <div
                  key={order.id}
                  className={`${styles['q-item']}${activeOrderId === order.id ? ` ${styles.act}` : ''}`}
                  onClick={() => setActiveOrderId(order.id)}
                >
                  <div className={styles['id-row']}>
                    <code>{order.id}</code>
                    <span className={`${styles.tag} ${styles[order.status]}`}>{order.statusLabel}</span>
                  </div>
                  <div className={styles.nm}>{order.name}</div>
                  <div className={styles.meta}>
                    <span>{order.lines} líneas</span>
                    <span>{order.amount}</span>
                    <span>{order.pickup}</span>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <div className={styles.pick}>
            <div className={styles['pick-h']}>
              <div className={styles.l}>
                <div className={styles.av}>{ACTIVE_ORDER.avatar}</div>
                <div>
                  <h3>{ACTIVE_ORDER.name} · <em>{ACTIVE_ORDER.id}</em></h3>
                  <div className={styles.sub}>{ACTIVE_ORDER.sub}</div>
                </div>
              </div>
              <div className={styles.r}>
                <button className={`${styles.btn} ${styles['btn-ghost']}`} style={{ borderColor: 'rgba(255,255,255,.25)', color: '#fff' }}>Llamar</button>
                <button className={`${styles.btn} ${styles['btn-accent']}`}>Cerrar pedido →</button>
              </div>
            </div>

            <div className={styles['pick-scan']}>
              <span style={{ fontFamily: 'var(--display)', fontStyle: 'italic', fontSize: '20px', color: 'var(--mb-primary)' }}>⛒</span>
              <input placeholder="Escanea código de barras o introduce SKU…" defaultValue="" />
              <span style={{ fontSize: '11px', color: 'var(--mb-muted)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}>Lector conectado</span>
            </div>

            {PICKING_ZONES.map((zone) => (
              <div key={zone.zone}>
                <div className={styles['zone-h']}>
                  {zone.zone}<span className={styles.ct}>{zone.count} líneas</span>
                </div>
                {zone.lines.map((line, i) => {
                  const key = line.sku ?? `${zone.zone}-${i}`;
                  const isDone = checked[key] || line.status === 'done';
                  const isIssue = line.status === 'issue' && !isDone;
                  const lineClass = `${styles.line}${isDone ? ` ${styles.done}` : ''}${isIssue ? ` ${styles.issue}` : ''}`;
                  return (
                    <div key={key}>
                      <div className={lineClass}>
                        <button
                          className={`${styles.check}${isDone ? ` ${styles.on}` : ''}`}
                          onClick={() => !isDone && toggleCheck(key)}
                        >
                          {isDone ? '✓' : (isIssue ? '!' : '')}
                        </button>
                        <div>
                          <div className={styles.nm}>
                            {line.name}
                            {isIssue && (
                              <> · <span style={{ color: 'var(--mb-danger)', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase' }}>incidencia</span></>
                            )}
                          </div>
                          <div className={styles.hh}>
                            {line.sku && <code>{line.sku}</code>}
                            {line.location && <span>{line.location}</span>}
                            {line.supplier && <span>{line.supplier}</span>}
                            {line.lot && <span>{line.lot}</span>}
                            {isIssue && (
                              <span>{line.issueText}<strong>{line.issueSubstitute}</strong></span>
                            )}
                          </div>
                        </div>
                        <div className={styles.q}>{line.qty} <em>{line.unit}</em></div>
                        <div className={styles.actions}>
                          <button className={styles['act-btn']}>↻</button>
                          <button className={`${styles['act-btn']} ${styles.danger}`}>!</button>
                        </div>
                      </div>
                      {isIssue && line.subsText && (
                        <div className={styles.subs}>
                          <span style={{ fontFamily: 'var(--display)', fontStyle: 'italic', fontSize: '22px', color: '#8a6717' }}>!</span>
                          <div>
                            <strong>Sustitución propuesta:</strong> {line.subsText}
                          </div>
                          <button className={`${styles.btn} ${styles['btn-primary']}`}>Notificar y sustituir</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            <div className={styles['pick-foot']}>
              <div className={styles.stat}>
                <div><strong>5<em>/7</em></strong>líneas</div>
                <div><strong>1</strong>incidencia</div>
                <div><strong>≈3 min</strong>restantes</div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className={`${styles.btn} ${styles['btn-ghost']}`}>Pausar</button>
                <button className={`${styles.btn} ${styles['btn-accent']}`}>Cerrar y etiquetar →</button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
