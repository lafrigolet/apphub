import { useEffect, useState } from 'react'
import { useSession } from '../context/SessionContext.jsx'
import { misReservas, misBonos, misPedidos } from '../lib/studio.js'
import { Close } from './icons.jsx'

const eur = (c) => `${((c ?? 0) / 100).toFixed(2)} €`
const fdt = (iso) => iso ? new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
const ESTADO_RESERVA = { confirmed: 'Confirmada', reminded: 'Confirmada', checked_in: 'Asististe', completed: 'Completada', cancelled: 'Cancelada', no_show: 'No asististe' }
const ESTADO_PEDIDO = { pending: 'Pendiente', paid: 'Pagado', fulfilled: 'Preparado', shipped: 'Enviado', delivered: 'Entregado', completed: 'Completado', cancelled: 'Cancelado', refunded: 'Reembolsado' }

export default function MiCuenta() {
  const { accountOpen, setAccountOpen, identity, logout } = useSession()
  const [tab, setTab] = useState('reservas')
  const [data, setData] = useState({ reservas: null, bonos: null, pedidos: null })
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!accountOpen) return
    setErr('')
    const uid = identity?.userId
    misReservas(uid).then((r) => setData((d) => ({ ...d, reservas: r }))).catch((e) => setErr(e.message))
    misBonos(uid).then((r) => setData((d) => ({ ...d, bonos: r }))).catch(() => {})
    misPedidos(uid).then((r) => setData((d) => ({ ...d, pedidos: r }))).catch(() => {})
  }, [accountOpen, identity])

  const TABS = [['reservas', 'Mis reservas'], ['bonos', 'Mis bonos'], ['pedidos', 'Mis pedidos']]

  return (
    <>
      <div onClick={() => setAccountOpen(false)}
        className={`fixed inset-0 z-[60] bg-tinta/30 backdrop-blur-sm transition-opacity ${accountOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
      <aside className={`fixed top-0 right-0 z-[61] h-full w-full max-w-md bg-crema shadow-lift flex flex-col transition-transform duration-300 ${accountOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <header className="flex items-center justify-between px-6 h-[72px] border-b border-tinta/10 shrink-0">
          <div className="min-w-0">
            <span className="display text-2xl block leading-none">Mi cuenta</span>
            <span className="text-xs text-tinta/55 truncate">{identity?.email}</span>
          </div>
          <button onClick={() => setAccountOpen(false)} aria-label="Cerrar" className="p-2 text-tinta/60 hover:text-teal-600"><Close className="w-6 h-6" /></button>
        </header>

        <div className="flex gap-1.5 px-6 py-3 border-b border-tinta/10">
          {TABS.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`text-sm font-semibold px-3 py-1.5 rounded-full ${tab === k ? 'bg-teal-600 text-crema' : 'text-tinta/60 hover:text-teal-600'}`}>{label}</button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {err && <p className="text-sm text-red-700 bg-red-500/10 rounded-lg px-3 py-2 mb-3">{err}</p>}

          {tab === 'reservas' && (
            <List items={data.reservas} empty="Aún no tienes reservas. Reserva una clase desde el horario."
              render={(b) => (
                <Row key={b.id} title={b.service_name || b.session_description || 'Clase'}
                  sub={fdt(b.starts_at)} badge={ESTADO_RESERVA[b.status] || b.status} />
              )} />
          )}
          {tab === 'bonos' && (
            <List items={data.bonos} empty="No tienes bonos activos. Cómpralos en la tienda."
              render={(p) => (
                <Row key={p.id} title={p.template_name || p.name || 'Bono'}
                  sub={`Quedan ${p.sessions_remaining ?? p.remaining ?? '—'} de ${p.total_sessions ?? '—'}${p.expires_at ? ` · caduca ${new Date(p.expires_at).toLocaleDateString('es-ES')}` : ''}`}
                  badge={p.status === 'active' ? 'Activo' : p.status} />
              )} />
          )}
          {tab === 'pedidos' && (
            <List items={data.pedidos} empty="Aún no tienes pedidos."
              render={(o) => (
                <Row key={o.id} title={`Pedido #${o.id.slice(0, 8)}`}
                  sub={fdt(o.created_at)} badge={ESTADO_PEDIDO[o.status] || o.status} amount={eur(o.total_cents)} />
              )} />
          )}
        </div>

        <footer className="border-t border-tinta/10 px-6 py-4 shrink-0">
          <button onClick={logout} className="btn-zen btn-outline w-full justify-center">Cerrar sesión</button>
        </footer>
      </aside>
    </>
  )
}

function List({ items, empty, render }) {
  if (items === null) return <p className="text-tinta/50">Cargando…</p>
  if (!items.length) return <p className="text-tinta/50 italic">{empty}</p>
  return <ul className="space-y-2.5">{items.map(render)}</ul>
}

function Row({ title, sub, badge, amount }) {
  return (
    <li className="card-zen p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold text-tinta truncate">{title}</p>
        {sub && <p className="text-sm text-tinta/55 truncate">{sub}</p>}
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        {amount && <span className="display text-lg text-teal-700">{amount}</span>}
        {badge && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-teal-500/12 text-teal-700">{badge}</span>}
      </div>
    </li>
  )
}
