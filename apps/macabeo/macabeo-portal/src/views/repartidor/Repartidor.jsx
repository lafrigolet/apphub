import { useState } from 'react'
import RoleCrumb from '../../components/RoleCrumb.jsx'
import styles from './Repartidor.module.css'
import { routeStops, mapPins } from '../../data/repartidor.js'

export default function Repartidor() {
  const [view, setView] = useState('mapa') // 'mapa' | 'lista'

  return (
    <div className={styles.root}>
      <RoleCrumb />

      <aside className={styles.side}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>m</div>
          <div>
            <strong style={{ color: 'var(--mb-surface)' }}>
              macabeo<em>.</em>
            </strong>
            <small>reparto</small>
          </div>
        </div>
        <a className={`${styles.sLink} ${styles.on}`} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◐</span>Ruta de hoy<span className={styles.num}>9</span>
        </a>
        <a className={styles.sLink} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◑</span>Próximas rutas
        </a>
        <a className={styles.sLink} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◓</span>Incidencias<span className={styles.num}>1</span>
        </a>
        <a className={styles.sLink} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◧</span>Mi vehículo
        </a>
        <div className={styles.sTitle}>Histórico</div>
        <a className={styles.sLink} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◌</span>Esta semana
        </a>
        <a className={styles.sLink} href="#" onClick={(e) => e.preventDefault()}>
          <span className={styles.ic}>◍</span>Resumen mensual
        </a>
        <div className={styles.sFoot}>
          <div className={styles.av}>D</div>
          <div>
            <div className={styles.nm}>Diego Mariño</div>
            <div className={styles.ro}>Reparto</div>
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.top}>
          <div>
            <div className={styles.eb}>Ruta jueves 21 may · salida 17:30</div>
            <h1>9 entregas, <em>42 km</em> de ruta optimizada.</h1>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => setView(v => v === 'mapa' ? 'lista' : 'mapa')}
            >
              {view === 'mapa' ? 'Cambiar a vista lista' : 'Cambiar a vista mapa'}
            </button>
            <button className={`${styles.btn} ${styles.btnPrimary}`}>Iniciar ruta →</button>
          </div>
        </header>

        <section className={styles.kpis}>
          <div className={`${styles.kpi} ${styles.dark}`}>
            <div className={styles.l}>Avance</div>
            <div className={styles.v}>4 <em>/ 9 paradas</em></div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.l}>Km recorridos</div>
            <div className={styles.v}>18,2 <em>/ 42</em></div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.l}>Tiempo</div>
            <div className={styles.v}>1h 12<em>min</em></div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.l}>Próxima</div>
            <div className={styles.v}>Brais <em>· 6min</em></div>
          </div>
        </section>

        <div className={styles.curPanel}>
          <div className={styles.eb}>parada en curso · #4</div>
          <h2>Brais <em>Lema</em></h2>
          <div className={styles.ad}>📍 Rúa Travesa 22, 4ºB · 15660 Cambre · timbre "Lema-Souto"</div>
          <div className={styles.curGrid}>
            <div className={styles.curCell}>
              <div className={styles.l}>Pedido</div>
              <div className={styles.v}>P-2026-<em>0140</em></div>
            </div>
            <div className={styles.curCell}>
              <div className={styles.l}>Bultos</div>
              <div className={styles.v}>3 <em>cajas</em></div>
            </div>
            <div className={styles.curCell}>
              <div className={styles.l}>Importe</div>
              <div className={styles.v}>62,80 <em>€</em></div>
            </div>
            <div className={styles.curCell}>
              <div className={styles.l}>Pago</div>
              <div className={styles.v}><em>cobrado</em></div>
            </div>
          </div>
          <div className={styles.curActs}>
            <button className={`${styles.btn} ${styles.acc}`}>✓ Marcar como entregada</button>
            <button className={styles.btn}>📞 Llamar a la socia</button>
            <button className={styles.btn}>🗺 Abrir en mapas</button>
            <button className={`${styles.btn} ${styles.danger}`}>! Reportar incidencia</button>
          </div>
        </div>

        <div className={styles.split}>
          <div className={styles.panel}>
            <div className={styles.panelH}>
              <h3>Mapa <em>de la ruta</em></h3>
              <span style={{ fontSize: '11px', color: 'var(--mb-muted)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}>
                trayecto optimizado · −18%
              </span>
            </div>
            <div className={styles.map}>
              <svg className={styles.mpRoute} viewBox="0 0 400 400" preserveAspectRatio="none">
                <path d="M50 360 Q90 320 130 280 T220 200 T320 130 T360 60" stroke="#4F6B2F" strokeWidth="3" strokeDasharray="6 4" fill="none" opacity=".5" />
              </svg>
              {mapPins.map((pin) => (
                <div
                  key={pin.n}
                  className={`${styles.mpPin}${pin.status ? ` ${styles[pin.status]}` : ''}`}
                  style={{ left: pin.left, top: pin.top }}
                >
                  <span>{pin.n}</span>
                </div>
              ))}
              <div className={styles.mpL}>
                <em>Próxima</em>
                <strong>Sabela Riveiro · #5</strong>
                1,2 km · 6 min
              </div>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelH}>
              <h3>Hoja de <em>ruta</em></h3>
              <span style={{ fontSize: '11px', color: 'var(--mb-muted)', fontWeight: 600 }}>9 paradas · 42 km</span>
            </div>
            <div className={styles.route}>
              {routeStops.map((stop) => (
                <div key={stop.n} className={`${styles.stop}${stop.status === 'cur' ? ` ${styles.cur}` : ''}`}>
                  <div className={`${styles.stopN} ${styles[stop.status]}`}>{stop.n}</div>
                  <div>
                    <div className={styles.nm}>
                      {stop.name}
                      <span className={`${styles.tag} ${styles[stop.status]}`}>{stop.tag}</span>
                    </div>
                    <div className={styles.ad}>{stop.address}</div>
                    <div className={styles.mm}>
                      <span>{stop.pedido}</span>
                      <span>{stop.bultos}</span>
                      <span>{stop.time}</span>
                    </div>
                  </div>
                  <div className={styles.stopT}>
                    {stop.importe}<em>{stop.pago}</em>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelH}>
            <h3>Prueba de <em>entrega</em></h3>
            <span style={{ fontSize: '11px', color: 'var(--mb-muted)', fontWeight: 600 }}>se adjuntará al pedido P-0140</span>
          </div>
          <div style={{ padding: '20px' }}>
            <div className={styles.sigRow}>
              <div className={styles.sigBox}>
                <div>
                  <strong>Firma</strong>
                  Toca y firma con el dedo
                </div>
              </div>
              <div className={styles.sigBox}>
                <div>
                  <strong>Foto del paquete</strong>
                  📷 capturar
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px' }}>
              <button className={`${styles.btn} ${styles.btnGhost}`}>Saltar</button>
              <button className={`${styles.btn} ${styles.btnAccent}`}>✓ Confirmar entrega</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
