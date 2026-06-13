import { useEffect, useState } from 'react'
import AdminBar from './AdminBar.jsx'
import { listConsultas, getConsulta, actualizarConsulta } from '../../lib/studio.js'

const ESTADOS = [['', 'Todas'], ['new', 'Nuevas'], ['contacted', 'Contactadas'], ['resolved', 'Resueltas'], ['closed', 'Cerradas'], ['spam', 'Spam']]
const ESTADO_ES = { new: 'Nueva', contacted: 'Contactada', resolved: 'Resuelta', closed: 'Cerrada', spam: 'Spam' }
const ESTADO_STYLE = {
  new: 'bg-teal-500/15 text-teal-700', contacted: 'bg-amber-500/15 text-amber-700',
  resolved: 'bg-emerald-500/15 text-emerald-700', closed: 'bg-tinta/10 text-tinta/55', spam: 'bg-red-500/15 text-red-700',
}
const fdt = (iso) => iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
const SIGUIENTE = { new: 'contacted', contacted: 'resolved', resolved: 'closed' }

export default function ConsultasAdmin() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [filtro, setFiltro] = useState('')
  const [openId, setOpenId] = useState(null)
  const [detalle, setDetalle] = useState(null)

  function reload() {
    setLoading(true)
    listConsultas({ status: filtro || undefined }).then(setItems).catch((e) => setErr(e.message)).finally(() => setLoading(false))
  }
  useEffect(reload, [filtro])

  async function toggle(id) {
    if (openId === id) { setOpenId(null); setDetalle(null); return }
    setOpenId(id); setDetalle(null)
    try { setDetalle(await getConsulta(id)) } catch (e) { setErr(e.message) }
  }

  async function cambiarEstado(id, status) {
    setErr('')
    try { await actualizarConsulta(id, { status }); if (openId === id) setDetalle(await getConsulta(id)); reload() }
    catch (e) { setErr(e.message) }
  }

  return (
    <div className="min-h-screen bg-piedra text-tinta">
      <AdminBar active="consultas" />
      <div className="max-w-4xl mx-auto px-5 py-10">
        <p className="eyebrow">Backoffice · Contacto</p>
        <h1 className="display text-4xl sm:text-5xl mt-2 mb-2">Consultas</h1>
        <p className="text-tinta/60 mb-6">Mensajes recibidos por el formulario de contacto de la web.</p>

        <div className="flex flex-wrap gap-1.5 mb-6">
          {ESTADOS.map(([k, label]) => (
            <button key={k || 'all'} onClick={() => setFiltro(k)}
              className={`text-sm font-semibold px-3 py-1.5 rounded-full transition-colors ${filtro === k ? 'bg-teal-600 text-crema' : 'text-tinta/60 hover:text-teal-600 bg-crema'}`}>{label}</button>
          ))}
        </div>

        {err && <p className="text-sm text-red-700 bg-red-500/10 rounded-lg px-3 py-2 mb-4">{err}</p>}

        {loading ? <p className="text-tinta/50">Cargando…</p>
          : items.length === 0 ? <p className="text-tinta/50 italic">No hay consultas{filtro ? ` en estado “${ESTADO_ES[filtro]}”` : ''}.</p>
          : (
            <ul className="space-y-3">
              {items.map((c) => {
                const open = openId === c.id
                return (
                  <li key={c.id} className={`card-zen overflow-hidden ${open ? 'ring-1 ring-teal-500/40' : ''}`}>
                    <button onClick={() => toggle(c.id)} className="w-full p-5 flex items-center justify-between gap-4 text-left">
                      <div className="min-w-0">
                        <p className="font-semibold text-tinta truncate">{c.contact_name} <span className="text-tinta/40 font-mono text-xs">{c.reference}</span></p>
                        <p className="text-sm text-tinta/55 truncate">{c.email}{c.phone ? ` · ${c.phone}` : ''} · {fdt(c.created_at)}</p>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${ESTADO_STYLE[c.status] || 'bg-tinta/10 text-tinta/55'}`}>{ESTADO_ES[c.status] || c.status}</span>
                    </button>
                    {open && (
                      <div className="border-t border-tinta/10 px-5 py-4 bg-crema/50">
                        {!detalle ? <p className="text-tinta/50 text-sm">Cargando…</p> : (
                          <>
                            {detalle.subject && <p className="font-semibold text-tinta mb-1">{detalle.subject}</p>}
                            <p className="text-tinta/80 whitespace-pre-wrap text-[15px] leading-relaxed">{detalle.message}</p>
                            <div className="flex flex-wrap gap-2 mt-4">
                              <a href={`mailto:${detalle.email}`} className="btn-zen btn-outline !py-2 !px-4 text-[13px]">Responder por email</a>
                              {SIGUIENTE[detalle.status] && (
                                <button onClick={() => cambiarEstado(detalle.id, SIGUIENTE[detalle.status])}
                                  className="text-sm font-semibold text-crema bg-teal-600 hover:bg-teal-700 rounded-full px-3.5 py-1.5">
                                  Marcar {ESTADO_ES[SIGUIENTE[detalle.status]].toLowerCase()}
                                </button>
                              )}
                              {detalle.status !== 'spam' && (
                                <button onClick={() => cambiarEstado(detalle.id, 'spam')}
                                  className="text-sm font-semibold text-red-700 hover:bg-red-500/10 border border-red-500/30 rounded-full px-3.5 py-1.5">Spam</button>
                              )}
                            </div>
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
    </div>
  )
}
