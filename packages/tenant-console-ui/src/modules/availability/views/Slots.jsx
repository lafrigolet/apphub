import { useState } from 'react'
import { api } from '../../../shell/lib/api'
import { useFetch, PageHeader, Empty } from '../../../shell/lib/list-helpers'

// Read-only slot grid for a single service over the next 7 days. The
// availability engine returns slot starts; we render a per-day column.
export default function Slots() {
  const [serviceId, setServiceId] = useState('')
  const [services] = useFetch(() => api.get('/api/services/'))

  const from = new Date(); from.setHours(0, 0, 0, 0)
  const to   = new Date(from); to.setDate(to.getDate() + 7)

  const [slots, { loading, error }] = useFetch(
    () => serviceId
      ? api.get(`/api/availability/slots?serviceId=${encodeURIComponent(serviceId)}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)
      : Promise.resolve(null),
    [serviceId],
  )

  const svcList = services?.data ?? services ?? []
  const slotList = slots?.data ?? slots ?? []

  // Bucket slots into days: { YYYY-MM-DD: [{ startsAt, endsAt }] }
  const byDay = {}
  for (const s of slotList) {
    const day = (s.starts_at ?? s.startsAt ?? '').slice(0, 10)
    if (!day) continue
    ;(byDay[day] ??= []).push(s)
  }

  return (
    <div className="p-8 max-w-7xl fade-up">
      <PageHeader
        kicker="Operaciones"
        title="Disponibilidad"
        subtitle="Slots libres calculados por la engine de availability. Read-only — la edición se hace desde resources / work-hours."
        actions={
          <select className="select min-w-[16rem]" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">Selecciona un servicio…</option>
            {svcList.map((s) => <option key={s.id} value={s.id}>{s.display_name ?? s.id.slice(0, 8)}</option>)}
          </select>
        }
      />
      {!serviceId && <Empty title="Selecciona un servicio" hint="La engine devuelve slots libres para los próximos 7 días." />}
      {serviceId && loading && <div className="p-10 text-center text-ink3">Calculando slots…</div>}
      {serviceId && error   && <div className="p-10 text-center text-danger">Error: {error}</div>}
      {serviceId && !loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.keys(byDay).sort().map((day) => (
            <div key={day} className="bg-white border border-line rounded-xl shadow-card p-4">
              <div className="font-medium text-[13px] mb-3">{day}</div>
              <div className="space-y-1">
                {byDay[day].map((s, i) => (
                  <div key={i} className="text-[12px] font-mono text-ink2 px-2 py-1 bg-paper2 rounded">
                    {(s.starts_at ?? s.startsAt).slice(11, 16)}–{(s.ends_at ?? s.endsAt).slice(11, 16)}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {Object.keys(byDay).length === 0 && <Empty title="Sin disponibilidad" hint="La engine no ha encontrado huecos en los próximos 7 días para este servicio." />}
        </div>
      )}
    </div>
  )
}
