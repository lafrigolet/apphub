import { useState } from 'react'
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google'
import * as auth from '../lib/auth.js'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const FACEBOOK_APP_ID  = import.meta.env.VITE_FACEBOOK_APP_ID  || ''

// Isolated component — only mounted inside GoogleOAuthProvider when client_id exists
function GoogleButton({ onSuccess, onError, disabled }) {
  const googleLogin = useGoogleLogin({
    onSuccess: (res) => onSuccess(res.access_token),
    onError,
    flow: 'implicit',
  })
  return (
    <button className="login-social-btn login-google" onClick={() => googleLogin()} disabled={disabled}>
      <svg viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
      Continuar con Google
    </button>
  )
}

function LoginForm({ onClose, onLoggedIn }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  // Después de cualquier flujo de login (password / Google / Facebook)
  // notificamos al padre y cerramos el modal. El padre (App.jsx) decide
  // qué montar según el rol:
  //   admin → <AdminShell> (consola embebida, paquete @apphub/tenant-console-ui)
  //   socio → <MemberHome>
  // No hay hard-redirect: el admin se queda en aikikan.hulkstein.local.
  function dispatchByRole(data) {
    onLoggedIn?.(data)
    onClose()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (mode === 'login') {
        const data = await auth.login({ email, password })
        dispatchByRole(data)
      } else {
        await auth.register({ email, password })
        setSuccess('Cuenta creada. Ahora puedes iniciar sesión.')
        setMode('login')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogleSuccess(accessToken) {
    setError(null)
    setLoading(true)
    try {
      const data = await auth.loginGoogle(accessToken)
      dispatchByRole(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleFacebook() {
    if (!window.FB) { setError('Facebook SDK no disponible'); return }
    window.FB.login((response) => {
      if (response.authResponse?.accessToken) {
        setLoading(true)
        auth.loginFacebook(response.authResponse.accessToken)
          .then((data) => dispatchByRole(data))
          .catch((err) => setError(err.message))
          .finally(() => setLoading(false))
      } else {
        setError('Inicio de sesión con Facebook cancelado')
      }
    }, { scope: 'email' })
  }

  const hasSocial = GOOGLE_CLIENT_ID || FACEBOOK_APP_ID

  return (
    <div className="login-panel">
      {/* ── Left: branding ── */}
      <div className="login-left">
        <div className="login-left-logo">AIKI<span>KAN</span></div>
        <blockquote className="login-left-quote">
          "El camino del aikido no termina nunca. Cada práctica es un nuevo comienzo."
          <cite>/ O'SENSEI</cite>
        </blockquote>
        <div className="login-left-deco"></div>
      </div>

      {/* ── Right: form ── */}
      <div className="login-right">
        <button className="login-close" onClick={onClose}>✕</button>

        <p className="login-eyebrow"><span className="slash">/</span> Área de socios</p>
        <h2 className="login-title">{mode === 'login' ? 'ACCEDER' : 'REGISTRO'}</h2>

        {error && <p className="login-error">{error}</p>}
        {success && <p className="login-success">{success}</p>}

        {/* Social buttons — only rendered when provider env vars are set */}
        {hasSocial && (
          <div className="login-social">
            {GOOGLE_CLIENT_ID && (
              <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
                <GoogleButton
                  onSuccess={handleGoogleSuccess}
                  onError={() => setError('Error al iniciar sesión con Google')}
                  disabled={loading}
                />
              </GoogleOAuthProvider>
            )}
            {FACEBOOK_APP_ID && (
              <button className="login-social-btn login-facebook" onClick={handleFacebook} disabled={loading}>
                <svg viewBox="0 0 24 24" width="18" height="18"><path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                Continuar con Facebook
              </button>
            )}
          </div>
        )}

        {hasSocial && <div className="login-divider"><span>o continúa con email</span></div>}

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="login-field">
              <label className="login-label">Nombre completo</label>
              <input type="text" className="login-input" placeholder="Tu nombre" value={name} onChange={e => setName(e.target.value)} />
            </div>
          )}
          <div className="login-field">
            <label className="login-label">Correo electrónico</label>
            <input type="email" className="login-input" placeholder="nombre@ejemplo.com" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="login-field">
            <label className="login-label">Contraseña</label>
            <input type="password" className="login-input" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
          </div>
          {mode === 'login' && (
            <a href="#" className="login-forgot" onClick={async e => {
              e.preventDefault()
              if (email) { await auth.forgotPassword(email); setSuccess('Si ese email existe, recibirás un enlace de recuperación.') }
            }}>
              <span className="slash">/</span> ¿Olvidaste tu contraseña?
            </a>
          )}
          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? 'Cargando…' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
          </button>
        </form>

        <p className="login-switch">
          {mode === 'login' ? '¿Aún no eres socio? ' : '¿Ya tienes cuenta? '}
          <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); setSuccess(null) }}>
            {mode === 'login' ? 'Regístrate' : 'Inicia sesión'}
          </button>
        </p>
      </div>
    </div>
  )
}

export default function Login({ onClose, onLoggedIn }) {
  return (
    <div className="login-overlay">
      <div className="login-backdrop" onClick={onClose}></div>
      <LoginForm onClose={onClose} onLoggedIn={onLoggedIn} />
    </div>
  )
}
