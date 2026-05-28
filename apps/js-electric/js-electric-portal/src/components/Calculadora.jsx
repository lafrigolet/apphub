import { useEffect, useState } from 'react'
import { Arrow, Check } from './icons.jsx'
import BudgetRequestModal from './BudgetRequestModal.jsx'

// Defaults — DEBEN coincidir con SOLAR_CALCULATOR_DEFAULTS en
// platform/tenant-config/src/services/solar-calculator.service.js. Sirven
// como fallback si la API falla (sigue funcionando offline o sin
// platform-core arrancado).
const DEFAULT_CONFIG = {
  irradianceHours:   1650,
  pricePerKwh:       0.18,
  installCostPerKwp: 1200,
  co2KgPerKwh:       0.27,
  m2PerKwp:          5,
  monthlyBillPerKwp: 25,
  installations: {
    residential: { label: 'Residencial',          billUplift: 1.0, selfConsumption: 0.75 },
    business:    { label: 'Empresa / Industrial', billUplift: 1.4, selfConsumption: 0.85 },
  },
  orientations: [
    { label: 'Este',  factor: 0.85 },
    { label: 'Sur',   factor: 1.00 },
    { label: 'Oeste', factor: 0.85 },
    { label: 'Plana', factor: 0.60 },
  ],
}

// Lógica pura del simulador. Toma todos los parámetros físico-económicos
// del config (que viene de apps.metadata.solarCalculator vía la API), y
// el estado interactivo (bill/area + install/orient seleccionados).
function solarCalc({ bill, area, install, orient, config }) {
  const maxByArea = area / config.m2PerKwp
  const maxByBill = (bill / config.monthlyBillPerKwp) * install.billUplift
  const power     = Math.max(1, Math.min(maxByArea, maxByBill))
  const yearGen   = power * config.irradianceHours * orient.factor
  const yearSaving = yearGen * config.pricePerKwh * install.selfConsumption
  const cost = power * config.installCostPerKwp
  const roi  = cost / yearSaving
  const co2  = (yearGen * config.co2KgPerKwh) / 1000      // kg → toneladas
  const fmt  = (n, d = 0) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })
  return {
    display: {
      power:  fmt(power, 1).replace('.', ','),
      saving: fmt(yearSaving, 0),
      roi:    fmt(roi, 1).replace('.', ','),
      co2:    fmt(co2, 1).replace('.', ','),
      cost:   fmt(cost, 0) + '€',
    },
    raw: { power, yearSaving, roi, co2, cost },
  }
}

const sliderStyle = (v, min, max) => ({ '--val': `${((v - min) / (max - min)) * 100}%` })

export default function Calculadora({ showToast }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG)

  // Fetch on mount — si la API responde, sobreescribe defaults. Fallback
  // silencioso (no toast — el visitante no debería ver errores de
  // infra). Una calculadora que no carga es preferible a una calculadora
  // con números aleatorios.
  useEffect(() => {
    let cancelled = false
    fetch('/api/apps/js-electric/solar-calculator')
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (!cancelled && j) setConfig(j) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const installKeys = Object.keys(config.installations)         // ['residential', 'business']
  const [bill, setBill]             = useState(120)
  const [area, setArea]             = useState(30)
  const [installKey, setInstallKey] = useState(installKeys[0])
  const [orientIdx, setOrientIdx]   = useState(() => {
    // Defaultea a la orientación 'sur' (factor 1) si existe; si no, la primera.
    const idx = DEFAULT_CONFIG.orientations.findIndex((o) => o.factor === 1)
    return idx >= 0 ? idx : 0
  })
  const [showBudget, setShowBudget] = useState(false)

  // Si el config carga después con installKeys distintas o menos orientations,
  // saneamos los índices para no crashear.
  const install = config.installations[installKey] ?? config.installations[installKeys[0]]
  const orient  = config.orientations[orientIdx] ?? config.orientations[0]
  const { display: calc, raw } = solarCalc({ bill, area, install, orient, config })

  // Snapshot que viaja al backend en metadata.simulation.
  const simulation = {
    facturaMensual: bill,
    area,
    tipo:        install.label,
    orientacion: orient.label,
    potencia:    raw.power,
    ahorroAnual: raw.yearSaving,
    roi:         raw.roi,
    co2:         raw.co2,
    coste:       raw.cost,
  }

  // Bullets informativos derivados del config — antes eran texto estático
  // en data/mock.js. Si el admin cambia el precio o la irradiación, los
  // valores aquí también se actualizan, manteniendo coherencia con la
  // simulación.
  const infoLines = [
    `Cálculo basado en ${config.irradianceHours.toLocaleString('es-ES')}h equivalentes/año de irradiación`,
    `Precio orientativo de instalación: ${config.installCostPerKwp.toLocaleString('es-ES')}€/kWp llave en mano`,
    'Resultado estimativo. Para presupuesto exacto, contacta con nosotros',
  ]

  return (
    <section id="calculadora" className="relative py-24 sm:py-32">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="grid lg:grid-cols-12 gap-12 items-start">
          <div className="lg:col-span-5 lg:sticky lg:top-28 reveal">
            <div className="text-xs uppercase tracking-[0.2em] text-electric-600 font-mono mb-4">— 03 / Simulador</div>
            <h2 className="display text-4xl sm:text-5xl font-semibold leading-[1.02] mb-6">
              ¿Cuánto puedes <em>ahorrar</em> con placas solares?
            </h2>
            <p className="text-ink-700 leading-relaxed mb-8">
              Mueve los selectores y descubre tu ahorro estimado anual, el periodo de
              amortización y el CO₂ que dejarías de emitir. Sin compromiso.
            </p>
            <div className="space-y-3 text-sm text-ink-700">
              {infoLines.map((line) => (
                <div key={line} className="flex items-start gap-3">
                  <Check className="w-5 h-5 mt-0.5 text-electric-600 flex-shrink-0" />
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7 reveal reveal-delay-1">
            <div className="bg-white rounded-3xl shadow-lift border border-ink-900/5 p-8 sm:p-10">

              <div className="mb-8">
                <label className="text-xs uppercase tracking-wider text-ink-700 font-medium block mb-3">Tipo de instalación</label>
                <div className="grid grid-cols-2 gap-2">
                  {installKeys.map((key) => {
                    const active = installKey === key
                    return (
                      <button key={key} type="button" onClick={() => setInstallKey(key)}
                        className={`px-4 py-3 rounded-xl border-2 font-medium text-sm transition ${active ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-900/10 bg-white text-ink-700 hover:border-ink-900/30'}`}>
                        {config.installations[key].label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="mb-8">
                <div className="flex items-baseline justify-between mb-3">
                  <label className="text-xs uppercase tracking-wider text-ink-700 font-medium">Factura mensual de luz</label>
                  <span className="font-display text-2xl font-semibold text-ink-900">{bill}€</span>
                </div>
                <input type="range" min={40} max={600} step={10} value={bill}
                  onChange={(e) => setBill(+e.target.value)}
                  className="calc-slider"
                  style={sliderStyle(bill, 40, 600)} />
                <div className="flex justify-between text-[10px] text-ink-700/60 mt-2 font-mono"><span>40€</span><span>600€</span></div>
              </div>

              <div className="mb-8">
                <div className="flex items-baseline justify-between mb-3">
                  <label className="text-xs uppercase tracking-wider text-ink-700 font-medium">Superficie disponible (cubierta)</label>
                  <span className="font-display text-2xl font-semibold text-ink-900">{area} m²</span>
                </div>
                <input type="range" min={10} max={300} step={5} value={area}
                  onChange={(e) => setArea(+e.target.value)}
                  className="calc-slider"
                  style={sliderStyle(area, 10, 300)} />
                <div className="flex justify-between text-[10px] text-ink-700/60 mt-2 font-mono"><span>10 m²</span><span>300 m²</span></div>
              </div>

              <div className="mb-8">
                <label className="text-xs uppercase tracking-wider text-ink-700 font-medium block mb-3">Orientación</label>
                <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${config.orientations.length}, minmax(0, 1fr))` }}>
                  {config.orientations.map((o, idx) => {
                    const isActive = orientIdx === idx
                    return (
                      <button key={`${o.label}-${idx}`} type="button" onClick={() => setOrientIdx(idx)}
                        className={`px-3 py-2.5 rounded-lg font-medium text-xs transition ${isActive ? 'border-2 border-ink-900 bg-ink-900 text-white' : 'border border-ink-900/10 bg-white text-ink-700 hover:border-ink-900/30'}`}>
                        {o.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="hairline mb-8"></div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-ink-700/70 mb-1.5">Potencia</div>
                  <div className="font-display text-2xl sm:text-3xl font-semibold text-ink-900">{calc.power}<span className="text-base text-ink-700 ml-0.5">kWp</span></div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-ink-700/70 mb-1.5">Ahorro anual</div>
                  <div className="font-display text-2xl sm:text-3xl font-semibold text-electric-700">{calc.saving}<span className="text-base ml-0.5">€</span></div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-ink-700/70 mb-1.5">Amortización</div>
                  <div className="font-display text-2xl sm:text-3xl font-semibold text-ink-900">{calc.roi}<span className="text-base text-ink-700 ml-0.5">años</span></div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-ink-700/70 mb-1.5">CO₂ evitado</div>
                  <div className="font-display text-2xl sm:text-3xl font-semibold text-ink-900">{calc.co2}<span className="text-base text-ink-700 ml-0.5">t/año</span></div>
                </div>
              </div>

              <div className="bg-ink-900 text-white rounded-2xl p-6 grid-bg relative overflow-hidden">
                <div className="absolute -right-12 -top-12 w-44 h-44 rounded-full bg-electric-500/30 blur-3xl"></div>
                <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <div className="text-xs text-white/70 mb-1">Inversión estimada</div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-3xl font-semibold tracking-tight">{calc.cost}</span>
                      <span className="text-xs text-white/60">llave en mano</span>
                    </div>
                  </div>
                  <button type="button" onClick={() => setShowBudget(true)}
                    className="btn-primary inline-flex items-center justify-center gap-2 bg-electric-500 text-white px-6 py-3 rounded-full font-semibold text-sm shadow-electric">
                    Pedir presupuesto exacto<Arrow />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <BudgetRequestModal
        open={showBudget}
        onClose={() => setShowBudget(false)}
        simulation={simulation}
        showToast={showToast}
      />
    </section>
  )
}
