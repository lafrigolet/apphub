import { useEffect, useState } from 'react'
import { api } from '../../lib/api.js'
import { APP_ID } from '../../lib/tenant.js'

// Editor de los parámetros físico-económicos de la calculadora solar
// (apps.metadata.solarCalculator). El form siempre manda el snapshot
// completo: simplifica la API (sin merge) y elimina shape inconsistente.
//
// Tier 1 (constantes globales) — inputs numéricos sueltos.
// Tier 2 (installations + orientations) — listas editables.
const TIER1_FIELDS = [
  { key: 'irradianceHours',   label: 'Irradiación equivalente',     unit: 'h/año',         step: 10,    help: 'Horas pico equivalentes/año. Peninsular medio ≈ 1.650 · sur España ≈ 1.800 · norte ≈ 1.200.' },
  { key: 'pricePerKwh',       label: 'Precio luz',                  unit: '€/kWh',         step: 0.01,  help: 'Tarifa media de venta a red (sin impuestos).' },
  { key: 'installCostPerKwp', label: 'Coste instalación',           unit: '€/kWp',         step: 50,    help: 'Llave en mano (panel + inversor + estructura + legalización).' },
  { key: 'co2KgPerKwh',       label: 'CO₂ evitado',                 unit: 'kg/kWh',        step: 0.01,  help: 'Mix eléctrico nacional. España 2024 ≈ 0,27.' },
  { key: 'm2PerKwp',          label: 'm² por kWp',                  unit: 'm²/kWp',        step: 0.5,   help: 'Depende de eficiencia del panel. Paneles 2025 ≈ 4–5.' },
  { key: 'monthlyBillPerKwp', label: 'Factura/mes por kWp',         unit: '€/mes',         step: 1,     help: 'Cuánta factura mensual justifica 1 kWp instalado.' },
]

export default function CalculadoraConfig() {
  const [config, setConfig]     = useState(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [savedAt, setSavedAt]   = useState(null)

  useEffect(() => {
    api('GET', `/api/apps/${APP_ID}/solar-calculator`)
      .then((data) => setConfig(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function onSave() {
    setSaving(true)
    setError('')
    try {
      const updated = await api('PATCH', `/api/apps/${APP_ID}/solar-calculator`, config)
      setConfig(updated ?? config)
      setSavedAt(new Date())
      setTimeout(() => setSavedAt(null), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function updateTier1(key, value) {
    setConfig({ ...config, [key]: value })
  }

  function updateInstallation(kind, field, value) {
    setConfig({
      ...config,
      installations: {
        ...config.installations,
        [kind]: { ...config.installations[kind], [field]: value },
      },
    })
  }

  function updateOrientation(idx, field, value) {
    const next = config.orientations.map((o, i) => i === idx ? { ...o, [field]: value } : o)
    setConfig({ ...config, orientations: next })
  }

  function addOrientation() {
    setConfig({ ...config, orientations: [...config.orientations, { label: 'Nueva', factor: 1 }] })
  }

  function removeOrientation(idx) {
    if (config.orientations.length <= 1) return  // siempre al menos 1
    setConfig({ ...config, orientations: config.orientations.filter((_, i) => i !== idx) })
  }

  if (loading) return <p className="text-ink-700/60">Cargando…</p>
  if (!config) return <p className="text-red-700">No se pudo cargar la configuración: {error}</p>

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-semibold">Calculadora solar</h1>
        <p className="text-sm text-ink-700 mt-1">
          Parámetros físico-económicos que usa el simulador del landing. Los cambios afectan al siguiente visitante que abra la página.
        </p>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">{error}</div>
      )}

      {/* Tier 1 — Constantes globales */}
      <section className="bg-white rounded-2xl border border-ink-900/5 shadow-soft p-7 mb-5">
        <h2 className="font-display text-lg font-semibold mb-1">Constantes físico-económicas</h2>
        <p className="text-sm text-ink-700 mb-5">Cambian con el tiempo y por geografía.</p>
        <div className="grid sm:grid-cols-2 gap-5">
          {TIER1_FIELDS.map((f) => (
            <NumberField key={f.key} field={f} value={config[f.key]} onChange={(v) => updateTier1(f.key, v)} />
          ))}
        </div>
      </section>

      {/* Tier 2a — Tipos de instalación */}
      <section className="bg-white rounded-2xl border border-ink-900/5 shadow-soft p-7 mb-5">
        <h2 className="font-display text-lg font-semibold mb-1">Tipos de instalación</h2>
        <p className="text-sm text-ink-700 mb-5">
          <strong>billUplift</strong>: factor que aplica al ratio €/mes → kWp.
          <strong className="ml-3">selfConsumption</strong>: % de la generación que se autoconsume (sin baterías ≈ 0,75).
        </p>
        {['residential', 'business'].map((kind) => {
          const inst = config.installations[kind]
          if (!inst) return null
          return (
            <div key={kind} className="grid sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-ink-700/70 mb-1.5">{kind} — Etiqueta</label>
                <input type="text" value={inst.label} onChange={(e) => updateInstallation(kind, 'label', e.target.value)}
                  className="field w-full px-3 py-2 rounded-lg border border-ink-900/10 bg-bone/50 text-sm" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-ink-700/70 mb-1.5">billUplift</label>
                <input type="number" step={0.05} value={inst.billUplift} onChange={(e) => updateInstallation(kind, 'billUplift', +e.target.value)}
                  className="field w-full px-3 py-2 rounded-lg border border-ink-900/10 bg-bone/50 text-sm" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-ink-700/70 mb-1.5">selfConsumption (0–1)</label>
                <input type="number" step={0.01} value={inst.selfConsumption} onChange={(e) => updateInstallation(kind, 'selfConsumption', +e.target.value)}
                  className="field w-full px-3 py-2 rounded-lg border border-ink-900/10 bg-bone/50 text-sm" />
              </div>
            </div>
          )
        })}
      </section>

      {/* Tier 2b — Orientaciones */}
      <section className="bg-white rounded-2xl border border-ink-900/5 shadow-soft p-7 mb-6">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-display text-lg font-semibold">Orientaciones</h2>
          <button type="button" onClick={addOrientation}
            className="text-xs font-medium text-electric-700 hover:text-electric-900 transition">+ Añadir</button>
        </div>
        <p className="text-sm text-ink-700 mb-5">
          <strong>factor</strong>: multiplicador de generación (sur = 1,00 · este/oeste ≈ 0,85 · plana ≈ 0,60).
        </p>
        {config.orientations.map((o, idx) => (
          <div key={idx} className="grid sm:grid-cols-[1fr,1fr,auto] gap-3 mb-3 items-end">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink-700/70 mb-1.5">Etiqueta</label>
              <input type="text" value={o.label} onChange={(e) => updateOrientation(idx, 'label', e.target.value)}
                className="field w-full px-3 py-2 rounded-lg border border-ink-900/10 bg-bone/50 text-sm" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink-700/70 mb-1.5">Factor</label>
              <input type="number" step={0.05} value={o.factor} onChange={(e) => updateOrientation(idx, 'factor', +e.target.value)}
                className="field w-full px-3 py-2 rounded-lg border border-ink-900/10 bg-bone/50 text-sm" />
            </div>
            <button type="button" onClick={() => removeOrientation(idx)} disabled={config.orientations.length <= 1}
              className="px-3 py-2 text-sm text-red-700 hover:text-red-900 disabled:opacity-30 disabled:cursor-not-allowed transition">
              Quitar
            </button>
          </div>
        ))}
      </section>

      <div className="flex items-center justify-end gap-4">
        {savedAt && <span className="text-sm text-electric-700">✓ Guardado a las {savedAt.toLocaleTimeString('es-ES')}</span>}
        <button onClick={onSave} disabled={saving}
          className="btn-primary inline-flex items-center justify-center gap-2 bg-ink-900 text-white px-6 py-3 rounded-full font-medium text-sm shadow-lift disabled:opacity-60 disabled:cursor-not-allowed">
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}

function NumberField({ field, value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink-800 mb-1.5">
        {field.label} <span className="text-ink-700/60 font-normal">({field.unit})</span>
      </label>
      <input type="number" step={field.step} value={value} onChange={(e) => onChange(+e.target.value)}
        className="field w-full px-3 py-2.5 rounded-lg border border-ink-900/10 bg-bone/50 text-sm" />
      <p className="text-[11px] text-ink-700/60 mt-1.5 leading-snug">{field.help}</p>
    </div>
  )
}
