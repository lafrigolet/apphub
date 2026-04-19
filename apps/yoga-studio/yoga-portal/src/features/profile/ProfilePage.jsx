import { useState, useEffect } from 'react'
import { users as usersApi } from '../../lib/api.js'
import { useToast } from '../../components/ui/ToastProvider.jsx'
import { getInitials } from '../../lib/utils.js'
import Button from '../../components/ui/Button.jsx'

export default function ProfilePage() {
  const toast = useToast()
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState({ name: '', phone: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    usersApi.me().then(p => {
      setProfile(p)
      setForm({ name: p.name ?? '', phone: p.phone ?? '' })
    }).catch(() => {})
  }, [])

  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const updated = await usersApi.updateMe(form)
      setProfile(updated)
      toast('Perfil actualizado')
    } catch (err) {
      toast(err.message ?? 'Error al guardar', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold text-sage-900">Mi perfil</h1>
        <p className="text-sage-500 text-sm mt-1">Actualiza tus datos personales.</p>
      </div>
      <div className="bg-white rounded-2xl shadow-sm p-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-sage-200 flex items-center justify-center text-xl font-bold text-sage-700">
            {getInitials(profile?.name ?? profile?.email ?? '')}
          </div>
          <div>
            <p className="font-semibold text-sage-900">{profile?.name ?? '—'}</p>
            <p className="text-sm text-sage-500">{profile?.email}</p>
            <p className="text-xs text-sage-400 capitalize mt-0.5">{profile?.role}</p>
          </div>
        </div>
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-sage-700 mb-1">Nombre completo</label>
            <input
              value={form.name} onChange={set('name')}
              className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
              placeholder="Tu nombre"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-sage-700 mb-1">Teléfono</label>
            <input
              value={form.phone} onChange={set('phone')}
              className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
              placeholder="+34 6xx xxx xxx"
            />
          </div>
          <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</Button>
        </form>
      </div>
    </div>
  )
}
