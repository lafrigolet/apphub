import { useState } from 'react'
import { bonuses as bonusesApi, users as usersApi } from '../../lib/api.js'
import { useToast } from '../../components/ui/ToastProvider.jsx'
import Button from '../../components/ui/Button.jsx'

export default function AdminBonusPage() {
  const toast = useToast()
  const [assign, setAssign] = useState({ userId: '', bonusTypeId: '', sessions: '' })
  const [adjust, setAdjust] = useState({ bonusId: '', delta: '', reason: '' })
  const [loading, setLoading] = useState(false)

  const setA = (k) => (e) => setAssign(p => ({ ...p, [k]: e.target.value }))
  const setB = (k) => (e) => setAdjust(p => ({ ...p, [k]: e.target.value }))

  async function submitAssign(e) {
    e.preventDefault()
    setLoading(true)
    try {
      await bonusesApi.assign({ userId: assign.userId, bonusTypeId: assign.bonusTypeId })
      toast('Bono asignado correctamente')
      setAssign({ userId: '', bonusTypeId: '', sessions: '' })
    } catch (err) {
      toast(err.message ?? 'Error al asignar', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function submitAdjust(e) {
    e.preventDefault()
    setLoading(true)
    try {
      await bonusesApi.adjust(adjust.bonusId, { delta: Number(adjust.delta), reason: adjust.reason })
      toast('Créditos ajustados')
      setAdjust({ bonusId: '', delta: '', reason: '' })
    } catch (err) {
      toast(err.message ?? 'Error al ajustar', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="font-serif text-2xl font-bold text-sage-900">Gestión de bonos</h1>
        <p className="text-sage-500 text-sm mt-1">Asigna y ajusta bonos de alumnos.</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="font-semibold text-sage-900 mb-4">Asignar bono</h2>
        <form onSubmit={submitAssign} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-sage-700 mb-1">ID de alumno</label>
            <input
              required value={assign.userId} onChange={setA('userId')}
              className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
              placeholder="uuid del alumno"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-sage-700 mb-1">Tipo de bono</label>
            <input
              required value={assign.bonusTypeId} onChange={setA('bonusTypeId')}
              className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
              placeholder="ID del tipo de bono"
            />
          </div>
          <Button type="submit" disabled={loading}>Asignar</Button>
        </form>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="font-semibold text-sage-900 mb-4">Ajustar créditos</h2>
        <form onSubmit={submitAdjust} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-sage-700 mb-1">ID de bono</label>
            <input
              required value={adjust.bonusId} onChange={setB('bonusId')}
              className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
              placeholder="uuid del bono"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-sage-700 mb-1">Delta (positivo o negativo)</label>
            <input
              type="number" required value={adjust.delta} onChange={setB('delta')}
              className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
              placeholder="ej. -1 o 2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-sage-700 mb-1">Motivo</label>
            <input
              required value={adjust.reason} onChange={setB('reason')}
              className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
              placeholder="ej. compensación por error"
            />
          </div>
          <Button type="submit" disabled={loading}>Ajustar</Button>
        </form>
      </div>
    </div>
  )
}
