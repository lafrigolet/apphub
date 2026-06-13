import { useState } from 'react'
import { useCart } from '../context/CartContext.jsx'
import { Close, Bag, Check } from './icons.jsx'

const eur = (c) => `${((c ?? 0) / 100).toFixed(2)} €`

export default function Cart() {
  const { items, count, subtotalCents, open, setOpen, loading, error, changeQty, removeItem, doCheckout } = useCart()
  const [paso, setPaso] = useState('cesta')        // 'cesta' | 'datos' | 'ok'
  const [ok, setOk] = useState(null)               // { orderId, pendingPayment }
  const [form, setForm] = useState({ nombre: '', email: '', telefono: '', direccion: '', cp: '', ciudad: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  function cerrar() { setOpen(false); setTimeout(() => { setPaso('cesta'); setOk(null) }, 250) }

  async function onConfirmar(e) {
    e.preventDefault()
    if (!form.nombre || !form.email) return
    const r = await doCheckout(form)
    if (r.redirectUrl) { window.location.href = r.redirectUrl; return }
    setOk({ orderId: r.orderId }); setPaso('ok')
  }

  return (
    <>
      {/* Backdrop */}
      <div onClick={cerrar}
        className={`fixed inset-0 z-[60] bg-tinta/30 backdrop-blur-sm transition-opacity ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />

      {/* Panel */}
      <aside
        className={`fixed top-0 right-0 z-[61] h-full w-full max-w-md bg-crema shadow-lift flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        aria-hidden={!open}>
        <header className="flex items-center justify-between px-6 h-[72px] border-b border-tinta/10 shrink-0">
          <span className="display text-2xl flex items-center gap-2"><Bag className="w-5 h-5 text-teal-600" /> Tu cesta {count > 0 && <span className="text-tinta/40 text-base">({count})</span>}</span>
          <button onClick={cerrar} aria-label="Cerrar cesta" className="p-2 text-tinta/60 hover:text-teal-600"><Close className="w-6 h-6" /></button>
        </header>

        {error && <p className="mx-6 mt-4 text-sm text-red-700 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}

        {/* Confirmación */}
        {paso === 'ok' ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-4">
            <span className="w-16 h-16 rounded-full bg-teal-500/15 text-teal-700 flex items-center justify-center"><Check className="w-8 h-8" /></span>
            <h3 className="display text-3xl">¡Pedido recibido!</h3>
            <p className="text-tinta/65">Hemos registrado tu pedido <span className="font-mono text-sm">#{ok?.orderId?.slice(0, 8)}</span>. Te contactaremos para completar el pago y el envío.</p>
            <button onClick={cerrar} className="btn-zen btn-fill mt-2">Seguir explorando</button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-3 text-tinta/55">
            <Bag className="w-12 h-12 text-tinta/20" />
            <p>Tu cesta está vacía.</p>
            <button onClick={cerrar} className="btn-zen btn-outline mt-2">Ver la tienda</button>
          </div>
        ) : (
          <>
            {/* Líneas */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {items.map((it) => (
                <div key={it.itemId} className="flex gap-3 items-start">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-tinta leading-snug">{it.name}</p>
                    <p className="text-sm text-tinta/55">{eur(it.priceCents)}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={() => changeQty(it.itemId, -1)} className="w-7 h-7 rounded-full border border-tinta/15 hover:border-teal-500 hover:text-teal-600 leading-none">−</button>
                      <span className="w-7 text-center text-sm font-semibold">{it.quantity}</span>
                      <button onClick={() => changeQty(it.itemId, +1)} className="w-7 h-7 rounded-full border border-tinta/15 hover:border-teal-500 hover:text-teal-600 leading-none">+</button>
                      <button onClick={() => removeItem(it.itemId)} className="ml-auto text-xs text-tinta/45 hover:text-red-700">Quitar</button>
                    </div>
                  </div>
                  <span className="display text-lg text-teal-700 shrink-0">{eur(it.priceCents * it.quantity)}</span>
                </div>
              ))}
            </div>

            {/* Pie: subtotal + acción */}
            <footer className="border-t border-tinta/10 px-6 py-5 shrink-0 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-tinta/70">Subtotal</span>
                <span className="display text-2xl text-tinta">{eur(subtotalCents)}</span>
              </div>

              {paso === 'cesta' ? (
                <button onClick={() => setPaso('datos')} className="btn-zen btn-fill w-full justify-center">Finalizar compra</button>
              ) : (
                <form onSubmit={onConfirmar} className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <input required value={form.nombre} onChange={set('nombre')} placeholder="Nombre*" className="col-span-2 rounded-xl border border-tinta/15 bg-crema px-3 py-2 text-sm focus:outline-none focus:border-teal-500" />
                    <input required type="email" value={form.email} onChange={set('email')} placeholder="Email*" className="rounded-xl border border-tinta/15 bg-crema px-3 py-2 text-sm focus:outline-none focus:border-teal-500" />
                    <input value={form.telefono} onChange={set('telefono')} placeholder="Teléfono" className="rounded-xl border border-tinta/15 bg-crema px-3 py-2 text-sm focus:outline-none focus:border-teal-500" />
                    <input value={form.direccion} onChange={set('direccion')} placeholder="Dirección" className="col-span-2 rounded-xl border border-tinta/15 bg-crema px-3 py-2 text-sm focus:outline-none focus:border-teal-500" />
                    <input value={form.cp} onChange={set('cp')} placeholder="C.P." className="rounded-xl border border-tinta/15 bg-crema px-3 py-2 text-sm focus:outline-none focus:border-teal-500" />
                    <input value={form.ciudad} onChange={set('ciudad')} placeholder="Ciudad" className="rounded-xl border border-tinta/15 bg-crema px-3 py-2 text-sm focus:outline-none focus:border-teal-500" />
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setPaso('cesta')} className="btn-zen btn-outline !px-4">Volver</button>
                    <button type="submit" disabled={loading} className="btn-zen btn-fill flex-1 justify-center">{loading ? 'Procesando…' : 'Confirmar pedido'}</button>
                  </div>
                </form>
              )}
            </footer>
          </>
        )}
      </aside>
    </>
  )
}
