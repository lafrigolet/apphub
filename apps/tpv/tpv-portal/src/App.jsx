import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { pressDigit, pressDoubleZero, backspace, clear, formatEur } from './lib/amount.js'
import { login, createCheckoutSession, getCheckoutStatus } from './lib/api.js'

const S = { KEYPAD: 'keypad', QR: 'qr', DONE: 'done', ERROR: 'error' }

export default function App() {
  const [amount, setAmount] = useState(0)
  const [screen, setScreen] = useState(S.KEYPAD)
  const [msg, setMsg] = useState('')
  const [qrUrl, setQrUrl] = useState('')
  const poll = useRef(null)

  // Login silencioso del cajero al cargar.
  useEffect(() => { login().catch((e) => { setScreen(S.ERROR); setMsg(`Login: ${e.message}`) }) }, [])
  useEffect(() => () => clearInterval(poll.current), [])

  async function onCharge() {
    try {
      const session = await createCheckoutSession(amount)
      setQrUrl(session.url)
      setScreen(S.QR)
      // Polling del estado: en cuanto Stripe marca paid → pantalla "Pagado".
      poll.current = setInterval(async () => {
        try {
          const st = await getCheckoutStatus(session.id)
          if (st.paymentStatus === 'paid' || st.status === 'complete') {
            clearInterval(poll.current); setScreen(S.DONE)
          }
        } catch { /* reintenta en el siguiente tick */ }
      }, 2500)
    } catch (e) {
      setScreen(S.ERROR); setMsg(e.message)
    }
  }

  function reset() {
    clearInterval(poll.current)
    setAmount(0); setMsg(''); setQrUrl(''); setScreen(S.KEYPAD)
  }

  if (screen === S.KEYPAD) {
    const Key = ({ label, onClick, muted }) => (
      <button className={`key${muted ? ' muted' : ''}`} onClick={onClick}>{label}</button>
    )
    return (
      <div className="app">
        <div className="display">
          <div className="label">IMPORTE</div>
          <div className="amount">{formatEur(amount)}</div>
          <button className="clear" onClick={() => setAmount(clear())}>Borrar</button>
        </div>
        <div className="grid">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
            <Key key={d} label={String(d)} onClick={() => setAmount((c) => pressDigit(c, d))} />
          ))}
          <Key label="00" muted onClick={() => setAmount((c) => pressDoubleZero(c))} />
          <Key label="0" onClick={() => setAmount((c) => pressDigit(c, 0))} />
          <Key label="⌫" muted onClick={() => setAmount((c) => backspace(c))} />
        </div>
        <button className="charge" disabled={amount <= 0} onClick={onCharge}>Cobrar</button>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="screen">
        {screen === S.QR && (
          <>
            <div className="title">{formatEur(amount)}</div>
            <div className="qrbox"><QRCodeSVG value={qrUrl} size={220} /></div>
            <div className="msg">Escanea para pagar con tu móvil</div>
            <button className="again" onClick={reset}>Cancelar</button>
          </>
        )}
        {screen === S.DONE && (
          <>
            <div className="emoji">✅</div>
            <div className="title">Pagado</div>
            <div className="msg">{formatEur(amount)}</div>
            <button className="again" onClick={reset}>Nuevo cobro</button>
          </>
        )}
        {screen === S.ERROR && (
          <>
            <div className="emoji">⚠️</div>
            <div className="title">No se pudo cobrar</div>
            <div className="msg">{msg}</div>
            <button className="again" onClick={reset}>Volver</button>
          </>
        )}
      </div>
    </div>
  )
}
