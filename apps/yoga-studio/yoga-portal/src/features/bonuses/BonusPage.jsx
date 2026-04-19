import { useState, useEffect } from 'react'
import { bonuses as bonusesApi, payments as paymentsApi } from '../../lib/api.js'
import { formatDate } from '../../lib/utils.js'
import { useToast } from '../../components/ui/ToastProvider.jsx'
import Button from '../../components/ui/Button.jsx'

export default function BonusPage() {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [buying, setBuying] = useState(false)

  useEffect(() => {
    bonusesApi.me().then(setItems).catch(() => {})
  }, [])

  async function buy(bonusTypeId) {
    setBuying(true)
    try {
      const { url } = await paymentsApi.checkout({ bonusTypeId })
      window.location.href = url
    } catch (err) {
      toast(err.message ?? 'No se pudo iniciar el pago', 'error')
      setBuying(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold text-sage-900">Mis bonos</h1>
        <p className="text-sage-500 text-sm mt-1">Gestiona tus créditos de clase.</p>
      </div>
      {items.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
          <p className="text-sage-400 mb-4">No tienes bonos activos.</p>
          <Button onClick={() => buy('bono_10')} disabled={buying}>
            {buying ? 'Redirigiendo…' : 'Comprar bono de 10 clases'}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map(b => {
            const left = b.sessions_total - b.sessions_used
            const pct = (left / b.sessions_total) * 100
            return (
              <div key={b.id} className="bg-white rounded-2xl shadow-sm p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-sage-900">{b.type_name ?? 'Bono'}</p>
                    <p className="text-xs text-sage-500">Caduca el {formatDate(b.expires_at)}</p>
                  </div>
                  <span className="text-2xl font-bold text-sage-800">{left}<span className="text-sm font-normal text-sage-500"> / {b.sessions_total}</span></span>
                </div>
                <div className="prog-bar mt-2">
                  <div className="prog-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
          <Button variant="secondary" onClick={() => buy('bono_10')} disabled={buying}>
            {buying ? 'Redirigiendo…' : 'Comprar otro bono'}
          </Button>
        </div>
      )}
    </div>
  )
}
