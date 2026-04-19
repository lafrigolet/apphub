import { useState, useEffect } from 'react'
import { classes as classesApi } from '../../lib/api.js'
import { TYPE_LABELS, LEVEL_LABELS, LEVEL_COLORS, formatTime, cn } from '../../lib/utils.js'
import Badge from '../ui/Badge.jsx'

const LEVELS = ['todos', 'principiante', 'intermedio', 'avanzado']

export default function ClassesCatalog() {
  const [items, setItems] = useState([])
  const [level, setLevel] = useState('todos')

  useEffect(() => {
    classesApi.list().then(setItems).catch(() => {})
  }, [])

  const filtered = level === 'todos' ? items : items.filter(c => c.level === level)

  return (
    <section id="clases" className="py-20 bg-sand-50">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-10">
          <h2 className="font-serif text-4xl font-bold text-sage-900 mb-4">Nuestras clases</h2>
          <p className="text-sage-600">Encuentra la práctica que más resuena contigo.</p>
        </div>
        <div className="flex justify-center gap-2 flex-wrap mb-10">
          {LEVELS.map(l => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              className={cn(
                'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
                level === l ? 'bg-sage-600 text-white' : 'bg-white text-sage-700 border border-sage-200 hover:border-sage-400'
              )}
            >
              {LEVEL_LABELS[l]}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <p className="text-center text-sage-500 py-12">No hay clases disponibles en este momento.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map(c => (
              <div key={c.id} className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-semibold text-sage-900">{c.name}</h3>
                  <Badge className={LEVEL_COLORS[c.level]}>{LEVEL_LABELS[c.level]}</Badge>
                </div>
                <p className="text-xs text-sage-500 mb-3">{TYPE_LABELS[c.type] ?? c.type}</p>
                <div className="flex items-center gap-4 text-sm text-sage-700">
                  <span>🕐 {formatTime(c.start_time)}</span>
                  <span>⏱ {c.duration_min} min</span>
                  <span>👤 máx {c.max_capacity}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
