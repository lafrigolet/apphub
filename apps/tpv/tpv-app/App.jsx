import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, StatusBar, SafeAreaView, Pressable } from 'react-native'
import { StripeTerminalProvider } from '@stripe/stripe-terminal-react-native'
import Keypad from './src/Keypad.jsx'
import { useTapToPay } from './src/terminal.js'
import { login, fetchConnectionToken } from './src/lib/api.js'
import { pressDigit, pressDoubleZero, backspace, clear } from './src/lib/amount.js'
import { formatEur } from './src/lib/amount.js'

// Pantallas del flujo de cobro.
const SCREEN = { KEYPAD: 'keypad', CHARGING: 'charging', DONE: 'done', ERROR: 'error' }

function TpvScreen() {
  const [amount, setAmount] = useState(0)
  const [screen, setScreen] = useState(SCREEN.KEYPAD)
  const [message, setMessage] = useState('')
  const { charge } = useTapToPay()

  // Login silencioso del cajero al arrancar (V1 sin pantalla de login).
  useEffect(() => { login().catch((e) => { setScreen(SCREEN.ERROR); setMessage(`Login: ${e.message}`) }) }, [])

  async function onCharge() {
    setScreen(SCREEN.CHARGING)
    setMessage('Acerca la tarjeta al teléfono…')
    try {
      const res = await charge(amount)
      if (res.status === 'succeeded' || res.status === 'requires_capture') {
        setScreen(SCREEN.DONE)
      } else {
        setScreen(SCREEN.ERROR); setMessage(`Estado: ${res.status}`)
      }
    } catch (e) {
      setScreen(SCREEN.ERROR); setMessage(e.message)
    }
  }

  function reset() { setAmount(0); setMessage(''); setScreen(SCREEN.KEYPAD) }

  if (screen === SCREEN.KEYPAD) {
    return (
      <Keypad
        amountCents={amount}
        onDigit={(d) => setAmount((c) => pressDigit(c, d))}
        onDoubleZero={() => setAmount((c) => pressDoubleZero(c))}
        onBackspace={() => setAmount((c) => backspace(c))}
        onClear={() => setAmount(clear())}
        onCharge={onCharge}
        busy={false}
      />
    )
  }

  return (
    <View style={styles.center}>
      {screen === SCREEN.CHARGING && (
        <>
          <Text style={styles.bigEmoji}>📲💳</Text>
          <Text style={styles.statusTitle}>{formatEur(amount)}</Text>
          <Text style={styles.statusMsg}>{message}</Text>
        </>
      )}
      {screen === SCREEN.DONE && (
        <>
          <Text style={styles.bigEmoji}>✅</Text>
          <Text style={styles.statusTitle}>Pagado</Text>
          <Text style={styles.statusMsg}>{formatEur(amount)}</Text>
          <Pressable style={styles.again} onPress={reset}><Text style={styles.againText}>Nuevo cobro</Text></Pressable>
        </>
      )}
      {screen === SCREEN.ERROR && (
        <>
          <Text style={styles.bigEmoji}>⚠️</Text>
          <Text style={styles.statusTitle}>No se pudo cobrar</Text>
          <Text style={styles.statusMsg}>{message}</Text>
          <Pressable style={styles.again} onPress={reset}><Text style={styles.againText}>Volver</Text></Pressable>
        </>
      )}
    </View>
  )
}

export default function App() {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      {/* tokenProvider: el SDK pide el connection token a nuestro backend. */}
      <StripeTerminalProvider tokenProvider={async () => (await fetchConnectionToken()).secret} logLevel="verbose">
        <TpvScreen />
      </StripeTerminalProvider>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0d12' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  bigEmoji: { fontSize: 72 },
  statusTitle: { color: '#f5f7fa', fontSize: 34, fontWeight: '700' },
  statusMsg: { color: '#9aa3b2', fontSize: 16, textAlign: 'center' },
  again: { marginTop: 24, backgroundColor: '#1b1f29', paddingHorizontal: 28, paddingVertical: 16, borderRadius: 16 },
  againText: { color: '#f5f7fa', fontSize: 17, fontWeight: '600' },
})
