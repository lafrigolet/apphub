import { useState } from 'react'
import { api } from '../../../shell/lib/api'
import { useApp } from '../../../shell/lib/context'
import { useFetch, PageHeader, Table, Panel } from '../../../shell/lib/list-helpers'

export default function Services() {
  const { toast, openModal, closeModal } = useApp()
  const [selected, setSelected] = useState(null)
  const [data, { loading, error, refetch }] = useFetch(() => api.get('/api/services/'))

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (error)   return <div className="p-10 text-center text-danger">Error: {error}</div>

  const rows = data?.data ?? data ?? []

  return (
    <div className="p-8 max-w-7xl fade-up">
      <PageHeader
        kicker="Negocio"
        title="Servicios"
        subtitle="Catálogo de servicios bookables. Edita identidad, pricing tiers, política de cancelación y galería desde el detalle."
      />
      {selected
        ? <ServiceDetail service={selected} onClose={() => setSelected(null)} onChange={refetch} />
        : <Table
            cols={[
              { key: 'display_name',     label: 'Nombre' },
              { key: 'duration_minutes', label: 'Duración', render: (r) => `${r.duration_minutes} min` },
              { key: 'modality',         label: 'Modalidad' },
              { key: 'capacity',         label: 'Capacidad' },
              { key: 'is_active',        label: 'Activo', render: (r) => r.is_active ? '✓' : '—' },
            ]}
            rows={rows}
            onRowClick={setSelected}
            empty={{ title: 'Sin servicios' }}
          />
      }
    </div>
  )
}

function ServiceDetail({ service, onClose, onChange }) {
  const [tab, setTab] = useState('identity')
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onClose} className="text-ink3 hover:text-ink text-[13px]">← Volver al listado</button>
        <span className="text-ink3">·</span>
        <span className="font-medium">{service.display_name}</span>
      </div>
      <div className="flex gap-2 mb-5">
        {['identity', 'pricing', 'cancellation', 'gallery'].map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-[13px] ${tab === t ? 'bg-ink text-white' : 'bg-paper2 text-ink2 hover:bg-paper'}`}>
            {t === 'identity' ? 'Identidad' : t === 'pricing' ? 'Pricing tiers' : t === 'cancellation' ? 'Cancelación' : 'Galería'}
          </button>
        ))}
      </div>
      {tab === 'identity'     && <IdentityTab service={service} onChange={onChange} />}
      {tab === 'pricing'      && <PricingTab service={service} />}
      {tab === 'cancellation' && <CancellationTab service={service} />}
      {tab === 'gallery'      && <GalleryTab service={service} />}
    </div>
  )
}

function IdentityTab({ service, onChange }) {
  const [name, setName] = useState(service.display_name)
  const [dur, setDur]   = useState(service.duration_minutes)
  return (
    <Panel title="Identidad" hint="Nombre visible y duración por defecto.">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><div className="label mb-1.5">Nombre</div><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><div className="label mb-1.5">Duración (min)</div><input type="number" className="input" value={dur} onChange={(e) => setDur(e.target.value)} /></div>
      </div>
      <div className="flex justify-end mt-4">
        <button
          className="btn btn-primary"
          onClick={async () => { await api.patch(`/api/services/${service.id}`, { displayName: name, durationMinutes: Number(dur) }); onChange?.() }}
        >Guardar</button>
      </div>
    </Panel>
  )
}

function PricingTab({ service }) {
  const [data, { loading, error }] = useFetch(() => api.get(`/api/services/${service.id}/pricing-tiers`))
  if (loading) return <div className="text-ink3">Cargando…</div>
  if (error)   return <div className="text-danger">Error: {error}</div>
  const tiers = data?.data ?? data ?? []
  return (
    <Panel title="Pricing tiers" hint="Diferentes precios según membership / canal / segmento.">
      <Table
        cols={[
          { key: 'tier_name',    label: 'Tier' },
          { key: 'price_cents',  label: 'Precio', render: (t) => `${(t.price_cents ?? 0) / 100} €` },
          { key: 'currency',     label: 'Moneda' },
        ]}
        rows={tiers}
        empty={{ title: 'Sin tiers' }}
      />
    </Panel>
  )
}

function CancellationTab({ service }) {
  return (
    <Panel title="Política de cancelación" hint="Penalización aplicable según ventana hasta el inicio.">
      <div className="text-[13px] text-ink2">
        <p>Política actual: <strong>{service.cancellation_policy ?? 'sin política'}</strong></p>
        <p className="text-ink3 mt-2 text-[12px]">La edición se hace vía API por ahora — endpoint <code className="font-mono">PATCH /v1/services/:id</code>.</p>
      </div>
    </Panel>
  )
}

function GalleryTab({ service }) {
  const [data, { loading, error }] = useFetch(() => api.get(`/api/services/${service.id}/images`))
  if (loading) return <div className="text-ink3">Cargando…</div>
  if (error)   return <div className="text-danger">Error: {error}</div>
  const imgs = data?.data ?? data ?? []
  return (
    <Panel title="Galería" hint="Imágenes asociadas al servicio (storage S3).">
      {imgs.length === 0
        ? <div className="text-ink3 text-[13px]">Sin imágenes.</div>
        : <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {imgs.map((i) => (
              <div key={i.id} className="border border-line rounded-lg overflow-hidden">
                {i.url && <img src={i.url} alt="" className="w-full h-24 object-cover" />}
                <div className="text-[11px] text-ink3 px-2 py-1 truncate">{i.filename ?? i.id?.slice(0, 8)}</div>
              </div>
            ))}
          </div>}
    </Panel>
  )
}
