import { useEffect, useState } from 'react'
import { useApp } from '../../../shell/lib/context'
import { api } from '../../../shell/lib/api'
import { icons } from '../../../shell/lib/icons'

// Etiquetas + descripciones por cada paso del checklist (doc §B.2).
// El status real (done / pending / not_applicable) viene del backend
// vía GET /v1/tenants/:id/bootstrap; aquí sólo decoramos.
const STEP_META = {
  identity: {
    label: 'Verifica los datos de tu organización',
    hint:  'Razón social, CIF, país y dirección.',
    cta:   'Editar identidad',
    view:  'tenants-settings',
  },
  password: {
    label: 'Establece contraseña',
    hint:  'Si llegaste por magic-link, ya está hecho.',
    cta:   null,
    view:  null,
  },
  subscription: {
    label: 'Activa tu subscripción',
    hint:  'Comienza a operar con tu plan.',
    cta:   'Ir a subscripción',
    view:  'tenants-settings',
  },
  'splitpay-connect': {
    label: 'Conecta Stripe Connect',
    hint:  'Necesario para split payments.',
    cta:   'Conectar Stripe',
    view:  'splitpay',
  },
  admins: {
    label: 'Invita a tu equipo',
    hint:  'Añade administradores que puedan operar contigo.',
    cta:   'Invitar admin',
    view:  'tenants-overview',
  },
  'email-domains': {
    label: 'Configura un dominio de email',
    hint:  'Para enviar notificaciones desde tu propio dominio.',
    cta:   'Configurar dominio',
    view:  'notifications-emails',
  },
  'custom-domain': {
    label: 'Conecta un dominio propio',
    hint:  'Sirve tu portal en tu dominio en lugar de un subdominio.',
    cta:   'Configurar dominio',
    view:  'tenants-settings',
  },
  modules: {
    label: 'Activa los módulos que vas a usar',
    hint:  'Selecciona qué capabilities quieres exponer en tu portal.',
    cta:   null,
    view:  null,
  },
  'first-data': {
    label: 'Crea tus primeros datos',
    hint:  'Catálogo, servicios, menú… según tu app.',
    cta:   null,
    view:  null,
  },
}

function StepRow({ step, onCta }) {
  const meta = STEP_META[step.key] ?? { label: step.key, hint: '', cta: null, view: null }
  const status = step.status

  const dotColor =
      status === 'done'           ? 'bg-ok'
    : status === 'not_applicable' ? 'bg-ink3/30'
    : 'bg-warn'

  const statusLabel =
      status === 'done'           ? 'Hecho'
    : status === 'not_applicable' ? 'No aplica'
    : 'Pendiente'

  return (
    <div className={`flex items-center gap-4 py-3 ${status === 'done' ? 'opacity-60' : ''}`}>
      <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${dotColor}`} aria-label={statusLabel} />
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium flex items-center gap-2">
          {meta.label}
          {step.required && status !== 'not_applicable' && (
            <span className="text-[10.5px] uppercase tracking-wider text-ink3 px-1.5 py-0.5 border border-line rounded">
              Requerido
            </span>
          )}
          {status === 'done' && <span className="text-ok">{icons.check}</span>}
        </div>
        <div className="text-[12.5px] text-ink3 mt-0.5">{meta.hint}</div>
      </div>
      {status !== 'done' && status !== 'not_applicable' && meta.cta && meta.view && (
        <button
          onClick={() => onCta(meta.view)}
          className="btn btn-ghost btn-sm shrink-0"
        >
          {meta.cta}
        </button>
      )}
    </div>
  )
}

export default function BootstrapPanel() {
  const { tenant, navigate, toast } = useApp()
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [minimized, setMinimized] = useState(false)

  function load() {
    if (!tenant?.id) return
    setLoading(true)
    api.get(`/api/tenants/tenants/${encodeURIComponent(tenant.id)}/bootstrap`)
      .then((res) => setStatus(res?.data ?? res))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false))
  }
  useEffect(load, [tenant?.id])

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (!status) return <div className="p-10 text-center text-ink3">No se pudo cargar el estado de configuración.</div>

  const requiredSteps = status.steps.filter((s) => s.required)
  const optionalSteps = status.steps.filter((s) => !s.required)
  const requiredDone  = requiredSteps.filter((s) => s.status === 'done').length
  const requiredTotal = requiredSteps.length

  if (minimized) {
    return (
      <div className="p-8 max-w-3xl">
        <button
          onClick={() => setMinimized(false)}
          className="w-full text-left bg-paper2 border border-line rounded-xl p-4 hover:bg-paper transition flex items-center justify-between"
        >
          <div>
            <div className="text-[14px] font-medium">Configura tu cuenta</div>
            <div className="text-[12px] text-ink3">{requiredDone} de {requiredTotal} pasos obligatorios</div>
          </div>
          <span className="text-ink3">{icons.chevron}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl fade-up">
      <div className="flex items-start justify-between gap-6 mb-6">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Onboarding</div>
          <h1 className="font-display text-[36px] leading-tight tracking-tight">
            <span className="italic font-normal">Configura tu cuenta</span>
          </h1>
          <p className="text-ink3 mt-3 max-w-xl">
            Completa estos pasos para empezar a operar. Los marcados como requeridos
            son los mínimos para activar tu workspace; el resto son opcionales y
            se pueden hacer más tarde.
          </p>
        </div>
        <button
          onClick={() => setMinimized(true)}
          className="text-[12px] text-ink3 hover:text-ink underline shrink-0"
        >
          Minimizar
        </button>
      </div>

      <div className="bg-white border border-line rounded-xl shadow-card p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[12px] uppercase tracking-[0.14em] text-ink3">Progreso</div>
          <div className="text-[13px] text-ink2">
            <span className="font-medium">{requiredDone}</span> / {requiredTotal} requeridos
          </div>
        </div>
        <div className="h-2 bg-paper2 rounded-full overflow-hidden">
          <div
            className="h-2 bg-ok rounded-full transition-all"
            style={{ width: `${requiredTotal === 0 ? 100 : (requiredDone / requiredTotal) * 100}%` }}
          />
        </div>
      </div>

      <div className="bg-white border border-line rounded-xl shadow-card divide-y divide-line">
        <div className="px-5 py-3 text-[12px] uppercase tracking-[0.14em] text-ink3 bg-paper2">
          Requeridos
        </div>
        <div className="px-5">
          {requiredSteps.map((s) => (
            <StepRow key={s.key} step={s} onCta={(v) => navigate(v)} />
          ))}
        </div>
        <div className="px-5 py-3 text-[12px] uppercase tracking-[0.14em] text-ink3 bg-paper2">
          Opcionales
        </div>
        <div className="px-5">
          {optionalSteps.map((s) => (
            <StepRow key={s.key} step={s} onCta={(v) => navigate(v)} />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 mt-6">
        <button onClick={load} className="btn btn-ghost btn-sm">
          Refrescar estado
        </button>
        {status.completedAt && (
          <span className="text-[12.5px] text-ok">
            ✓ Configuración completada el {new Date(status.completedAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  )
}
