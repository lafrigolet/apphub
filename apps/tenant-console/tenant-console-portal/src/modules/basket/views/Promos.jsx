import { useState } from 'react'
import { api } from '../../../shell/lib/api'
import { useApp } from '../../../shell/lib/context'
import { useFetch, PageHeader, Table, Panel } from '../../../shell/lib/list-helpers'
import { icons } from '../../../shell/lib/icons'

export default function Promos() {
  const { toast, openModal, closeModal } = useApp()
  const [data, { loading, error, refetch }] = useFetch(() => api.get('/api/basket/promos'))

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (error)   return <div className="p-10 text-center text-danger">Error: {error}</div>

  const rows = (data?.data ?? data ?? []).map((p) => ({ ...p, id: p.code }))

  async function remove(code) {
    if (!confirm(`¿Eliminar el código "${code}"?`)) return
    try { await api.delete(`/api/basket/promos/${encodeURIComponent(code)}`); toast('Código eliminado'); refetch() }
    catch (e) { toast(e.message, 'danger') }
  }

  return (
    <div className="p-8 max-w-6xl fade-up">
      <PageHeader
        kicker="Comercial"
        title="Códigos de promoción"
        subtitle="Descuentos aplicables al carrito. El tipo determina si se aplica como porcentaje o cantidad fija."
        actions={<button onClick={() => openModal(<PromoForm onDone={() => { closeModal(); refetch() }} />)} className="btn btn-primary">{icons.plus}Nuevo código</button>}
      />
      <Table
        cols={[
          { key: 'code',    label: 'Código' },
          { key: 'kind',    label: 'Tipo' },
          { key: 'value',   label: 'Valor', render: (r) => r.kind === 'percent' ? `${r.value_bps / 100}%` : `${(r.value_cents ?? 0) / 100} €` },
          { key: 'min',     label: 'Mínimo', render: (r) => r.min_subtotal_cents ? `${r.min_subtotal_cents / 100} €` : '—' },
          { key: 'usage',   label: 'Usos', render: (r) => `${r.times_redeemed ?? 0}${r.max_redemptions ? ' / ' + r.max_redemptions : ''}` },
          { key: 'expires', label: 'Expira', render: (r) => r.expires_at ? r.expires_at.slice(0, 10) : '—' },
          { key: 'actions', label: '', render: (r) => <button onClick={(e) => { e.stopPropagation(); remove(r.code) }} className="text-danger text-[12px] hover:underline">Eliminar</button> },
        ]}
        rows={rows}
        empty={{ title: 'Sin códigos activos', hint: 'Crea uno con el botón "Nuevo código".' }}
      />
    </div>
  )
}

function PromoForm({ onDone }) {
  const { closeModal, toast } = useApp()
  const [code, setCode]     = useState('')
  const [kind, setKind]     = useState('percent')
  const [valueBps, setBps]  = useState(1000)
  const [valueCents, setC]  = useState(500)
  const [minCents, setMin]  = useState('')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState(null)

  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(null)
    try {
      const body = kind === 'percent'
        ? { kind, value_bps: Number(valueBps), min_subtotal_cents: minCents ? Number(minCents) : undefined }
        : { kind, value_cents: Number(valueCents), min_subtotal_cents: minCents ? Number(minCents) : undefined }
      await api.put(`/api/basket/promos/${encodeURIComponent(code)}`, body)
      toast('Código creado'); onDone?.()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="font-display text-[20px]">Nuevo código</div>
      </div>
      <form className="p-6 space-y-4" onSubmit={submit}>
        <div><div className="label mb-1.5">Código</div><input className="input font-mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required pattern="[A-Z0-9_-]+" /></div>
        <div><div className="label mb-1.5">Tipo</div>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="percent">Porcentaje</option>
            <option value="amount">Cantidad fija</option>
          </select>
        </div>
        {kind === 'percent'
          ? <div><div className="label mb-1.5">Descuento (basis points · 100 = 1%)</div><input type="number" className="input" value={valueBps} min={1} max={10000} onChange={(e) => setBps(e.target.value)} /></div>
          : <div><div className="label mb-1.5">Descuento (céntimos)</div><input type="number" className="input" value={valueCents} min={1} onChange={(e) => setC(e.target.value)} /></div>}
        <div><div className="label mb-1.5">Mínimo de carrito (céntimos · opcional)</div><input type="number" className="input" value={minCents} onChange={(e) => setMin(e.target.value)} /></div>
        {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" disabled={busy} className="btn btn-primary">{busy ? 'Guardando…' : 'Crear'}</button>
        </div>
      </form>
    </>
  )
}
