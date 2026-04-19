import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { useToast } from '../../components/ui/ToastProvider.jsx'
import Modal from '../../components/ui/Modal.jsx'
import Button from '../../components/ui/Button.jsx'

export default function RegisterModal({ open, onClose, onSwitchToLogin }) {
  const { register } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm(prev => ({ ...prev, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (form.password.length < 8) { setError('La contraseña debe tener al menos 8 caracteres'); return }
    setLoading(true)
    try {
      await register(form)
      toast('¡Cuenta creada! Bienvenido/a')
      onClose()
      navigate('/app/dashboard')
    } catch (err) {
      setError(err.message ?? 'No se pudo crear la cuenta')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Crear cuenta">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <div>
          <label className="block text-sm font-medium text-sage-700 mb-1">Nombre completo</label>
          <input
            type="text"
            required
            value={form.name}
            onChange={set('name')}
            className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
            placeholder="Ana García"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-sage-700 mb-1">Email</label>
          <input
            type="email"
            required
            value={form.email}
            onChange={set('email')}
            className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
            placeholder="tu@email.com"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-sage-700 mb-1">Contraseña</label>
          <input
            type="password"
            required
            value={form.password}
            onChange={set('password')}
            className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
            placeholder="Mínimo 8 caracteres"
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Creando cuenta…' : 'Crear cuenta gratis'}
        </Button>
        <p className="text-center text-sm text-sage-600">
          ¿Ya tienes cuenta?{' '}
          <button type="button" onClick={onSwitchToLogin} className="text-sage-700 font-semibold hover:underline">
            Inicia sesión
          </button>
        </p>
      </form>
    </Modal>
  )
}
