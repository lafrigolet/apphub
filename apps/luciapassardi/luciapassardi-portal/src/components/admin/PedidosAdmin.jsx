import { useEffect, useState } from 'react'
import AdminBar from './AdminBar.jsx'
import { listPedidos, getPedido, cambiarEstadoPedido, cancelarPedido } from '../../lib/studio.js'

const eur = (c) => `${((c ?? 0) / 100).toFixed(2)} €`
const fmt = (iso) => new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// Misma FSM que platform/orders (orders.service.js). Define qué transiciones
// ofrece el backoffice según el estado actual del pedido.
const TRANSITIONS = {
  pending:   ['paid', 'cancelled'],
  paid:      ['fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded'],
  fulfilled: ['shipped', 'delivered', 'refunded'],
  shipped:   ['delivered', 'refunded'],
  delivered: ['completed', 'refunded'],
  completed: [],
  cancelled: [],
  refunded:  [],
}

const STATUS_ES = {
  pending: 'Pendiente', paid: 'Pagado', fulfilled: 'Preparado', shipped: 'Enviado',
  delivered: 'Entregado', completed: 'Completado', cancelled: 'Cancelado', refunded: 'Reembolsado',
}
const STATUS_STYLE = {
  pending: 'bg-amber-500/15 text-amber-700', paid: 'bg-teal-500/15 text-teal-700',
  fulfilled: 'bg-sky-500/15 text-sky-700', shipped: 'bg-indigo-500/15 text-indigo-700',
  delivered: 'bg-emerald-500/15 text-emerald-700', completed: 'bg-salvia-600/20 text-salvia-600',
  cancelled: 'bg-red-500/15 text-red-700', refunded: 'bg-tinta/10 text-tinta/60',
}

const FILTROS = ['', 'pending', 'paid', 'fulfilled', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded']

function Badge({ status }) {
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLE[status] || 'bg-tinta/10 text-tinta/60'}`}>{STATUS_ES[status] || status}</span>
}

export default function PedidosAdmin() {
  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [filtro, setFiltro] = useState('')
  const [openId, setOpenId] = useState(null)
  const [detalle, setDetalle] = useState(null)
  const [busy, setBusy] = useState(false)

  function reload() {
    setLoading(true)
    listPedidos({ status: filtro || undefined }).then(setPedidos).catch((e) => setErr(e.message)).finally(() => setLoading(false))
  }
  useEffect(reload, [filtro])

  async function toggle(id) {
    if (openId === id) { setOpenId(null); setDetalle(null); return }
    setOpenId(id); setDetalle(null)
    try { setDetalle(await getPedido(id)) } catch (e) { setErr(e.message) }
  }

  async function avanzar(id, status) {
    const reason = status === 'cancelled' || status === 'refunded'
      ? (window.prompt(`Motivo (${STATUS_ES[status]}):`, '') ?? '') : undefined
    if ((status === 'cancelled' || status === 'refunded') && reason === '') return
    setBusy(true); setErr('')
    try {
      if (status === 'cancelled') await cancelarPedido(id, reason)
      else await cambiarEstadoPedido(id, status, reason)
      if (openId === id) setDetalle(await getPedido(id))
      reload()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const buyerName = (o) => o.metadata?.buyerName || o.metadata?.buyer_name || 'Cliente'
  const buyerEmail = (o) => o.metadata?.buyerEmail || o.metadata?.buyer_email || ''

  return (
    <AdminBar active="pedidos">
      <div className="max-w-5xl mx-auto px-5 py-10">
        <p className="eyebrow">Backoffice · Tienda</p>
        <h1 className="display text-4xl sm:text-5xl mt-2 mb-2">Pedidos</h1>
        <p className="text-tinta/60 mb-6">Pedidos de la tienda online. Despliega uno para ver el detalle y avanzar su estado.</p>

        {/* Filtro por estado */}
        <div className="flex flex-wrap gap-1.5 mb-6">
          {FILTROS.map((f) => (
            <button key={f || 'all'} onClick={() => setFiltro(f)}
              className={`text-sm font-semibold px-3 py-1.5 rounded-full transition-colors ${
                filtro === f ? 'bg-teal-600 text-crema' : 'text-tinta/60 hover:text-teal-600 bg-crema'}`}>
              {f ? STATUS_ES[f] : 'Todos'}
            </button>
          ))}
        </div>

        {err && <p className="text-sm text-red-700 bg-red-500/10 rounded-lg px-3 py-2 mb-4">{err}</p>}

        {loading ? (
          <p className="text-tinta/50">Cargando…</p>
        ) : pedidos.length === 0 ? (
          <p className="text-tinta/50 italic">No hay pedidos{filtro ? ` en estado “${STATUS_ES[filtro]}”` : ''}.</p>
        ) : (
          <ul className="space-y-3">
            {pedidos.map((o) => {
              const open = openId === o.id
              const next = TRANSITIONS[o.status] || []
              return (
                <li key={o.id} className={`card-zen overflow-hidden ${open ? 'ring-1 ring-teal-500/40' : ''}`}>
                  <button onClick={() => toggle(o.id)} className="w-full p-5 flex items-center justify-between gap-4 text-left">
                    <div className="min-w-0">
                      <p className="font-semibold text-tinta truncate">{buyerName(o)} <span className="text-tinta/40 font-mono text-xs">#{o.id.slice(0, 8)}</span></p>
                      <p className="text-sm text-tinta/55">{fmt(o.created_at)}{buyerEmail(o) ? ` · ${buyerEmail(o)}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge status={o.status} />
                      <span className="display text-xl text-teal-700">{eur(o.total_cents)}</span>
                    </div>
                  </button>

                  {open && (
                    <div className="border-t border-tinta/10 px-5 py-4 bg-crema/50">
                      {!detalle ? (
                        <p className="text-tinta/50 text-sm">Cargando detalle…</p>
                      ) : (
                        <>
                          {/* Líneas */}
                          <ul className="space-y-1.5 mb-4">
                            {(detalle.items || []).map((it) => (
                              <li key={it.id} className="flex justify-between text-sm">
                                <span className="text-tinta/80">{it.qty}× {it.product_name}</span>
                                <span className="text-tinta/60">{eur(it.unit_price_cents * it.qty)}</span>
                              </li>
                            ))}
                          </ul>
                          <div className="flex justify-between text-sm text-tinta/60 border-t border-tinta/10 pt-2">
                            <span>Subtotal</span><span>{eur(detalle.subtotal_cents)}</span>
                          </div>
                          {detalle.shipping_cents > 0 && (
                            <div className="flex justify-between text-sm text-tinta/60">
                              <span>Envío</span><span>{eur(detalle.shipping_cents)}</span>
                            </div>
                          )}
                          <div className="flex justify-between font-semibold text-tinta mt-1">
                            <span>Total</span><span>{eur(detalle.total_cents)}</span>
                          </div>

                          {/* Dirección de envío */}
                          {(detalle.addresses || []).filter((a) => a.kind === 'shipping').map((a) => (
                            <p key={a.id} className="text-sm text-tinta/55 mt-3">
                              📦 {a.full_name} · {a.line1}, {a.postal_code} {a.city} ({a.region})
                            </p>
                          ))}

                          {/* Acciones FSM */}
                          {next.length > 0 ? (
                            <div className="flex flex-wrap gap-2 mt-4">
                              {next.map((s) => (
                                <button key={s} disabled={busy} onClick={() => avanzar(o.id, s)}
                                  className={`text-sm font-semibold px-3.5 py-1.5 rounded-full transition-colors disabled:opacity-50 ${
                                    s === 'cancelled' || s === 'refunded'
                                      ? 'text-red-700 hover:bg-red-500/10 border border-red-500/30'
                                      : 'text-crema bg-teal-600 hover:bg-teal-700'}`}>
                                  {s === 'cancelled' ? 'Cancelar' : s === 'refunded' ? 'Reembolsar' : `Marcar ${STATUS_ES[s].toLowerCase()}`}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-tinta/40 italic mt-4">Pedido en estado final.</p>
                          )}

                          {/* Historial */}
                          {(detalle.history || []).length > 0 && (
                            <details className="mt-4">
                              <summary className="text-sm text-tinta/50 cursor-pointer hover:text-teal-600">Historial de estados</summary>
                              <ul className="mt-2 space-y-1">
                                {detalle.history.map((h) => (
                                  <li key={h.id} className="text-xs text-tinta/55">
                                    {fmt(h.ts)} · {h.from_status ? `${STATUS_ES[h.from_status] || h.from_status} → ` : ''}{STATUS_ES[h.to_status] || h.to_status}{h.reason ? ` — ${h.reason}` : ''}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </AdminBar>
  )
}
