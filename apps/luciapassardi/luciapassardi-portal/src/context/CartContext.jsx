import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import * as cart from '../lib/cart.js'

const CartCtx = createContext(null)
export const useCart = () => useContext(CartCtx)

export function CartProvider({ children }) {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try { const c = await cart.loadCart(); setItems(c.items) }
    catch (e) { setError(e.message) }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const count = items.reduce((n, it) => n + it.quantity, 0)
  const subtotalCents = items.reduce((n, it) => n + it.priceCents * it.quantity, 0)

  // Añade una unidad (suma a la cantidad existente). Optimista + refresh.
  const addOne = useCallback(async (p) => {
    setError('')
    const existing = items.find((it) => it.itemId === p.itemId)
    const quantity = (existing?.quantity ?? 0) + 1
    try {
      await cart.putItem({ itemId: p.itemId, name: p.name, priceCents: p.priceCents, quantity })
      await refresh()
      setOpen(true)
    } catch (e) { setError(e.message) }
  }, [items, refresh])

  const changeQty = useCallback(async (itemId, delta) => {
    setError('')
    const it = items.find((x) => x.itemId === itemId)
    if (it && it.quantity + delta <= 0) return removeItem(itemId)
    try { await cart.changeQty(itemId, delta); await refresh() }
    catch (e) { setError(e.message) }
  }, [items, refresh]) // eslint-disable-line react-hooks/exhaustive-deps

  const removeItem = useCallback(async (itemId) => {
    setError('')
    try { await cart.removeItem(itemId); await refresh() }
    catch (e) { setError(e.message) }
  }, [refresh])

  const doCheckout = useCallback(async (contact) => {
    setLoading(true); setError('')
    try {
      const r = await cart.checkout({ items, contact })
      await refresh()
      return r
    } catch (e) { setError(e.message); throw e }
    finally { setLoading(false) }
  }, [items, refresh])

  const value = {
    items, count, subtotalCents, open, setOpen, loading, error, setError,
    addOne, changeQty, removeItem, doCheckout, refresh,
  }
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>
}
