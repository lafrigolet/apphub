import { useStripeTerminal } from '@stripe/stripe-terminal-react-native'
import { createTerminalIntent, fetchConnectionToken } from './lib/api.js'

// Hook que orquesta el cobro Tap to Pay con el SDK nativo de Stripe Terminal.
//
// ⚠️ NOMBRES DE API SEGÚN VERSIÓN DEL SDK: el descubrimiento/conexión del
// lector Tap to Pay cambió de nombre entre versiones:
//   - SDK ≥ 0.1 :  discoverReaders({ discoveryMethod: 'tapToPay' })  +  connectReader({ reader }, 'tapToPay')
//   - SDK 0.0.x :  discoverReaders({ discoveryMethod: 'localMobile' }) + connectLocalMobileReader({ reader, locationId })
// Abajo se usa la variante 0.0.x (la más documentada). Si tu versión usa
// 'tapToPay', ajusta las dos llamadas marcadas con [API].
export function useTapToPay() {
  const {
    initialize,
    discoverReaders,
    connectLocalMobileReader,
    connectedReader,
    retrievePaymentIntent,
    collectPaymentMethod,
    confirmPaymentIntent,
    discoveredReaders,
  } = useStripeTerminal()

  // Conecta el móvil como lector Tap to Pay (idempotente: si ya hay lector, no hace nada).
  // El locationId lo da el endpoint connection-token del backend.
  async function ensureReader() {
    if (connectedReader) return connectedReader
    await initialize()
    const { locationId } = await fetchConnectionToken()
    // [API] descubrir el lector "móvil como TPV" (simulado en test mode)
    const { error: discErr } = await discoverReaders({
      discoveryMethod: 'localMobile',
      simulated: true, // en producción/dispositivo real: false
    })
    if (discErr) throw new Error(discErr.message)
    // discoveredReaders se rellena vía el provider; tomamos el primero.
    const reader = discoveredReaders?.[0]
    if (!reader) throw new Error('No se encontró lector Tap to Pay')
    // [API] conectar el lector local
    const { reader: connected, error: connErr } = await connectLocalMobileReader({ reader, locationId })
    if (connErr) throw new Error(connErr.message)
    return connected
  }

  // Cobro completo: crea el PI en el backend, conecta el lector, recoge el método
  // de pago (acercar tarjeta) y confirma. Devuelve el estado final.
  async function charge(amountCents) {
    await ensureReader()
    const intent = await createTerminalIntent(amountCents) // { clientSecret, paymentIntentId, stub }

    const { paymentIntent: pi, error: retErr } = await retrievePaymentIntent(intent.clientSecret)
    if (retErr) throw new Error(retErr.message)

    const { paymentIntent: collected, error: colErr } = await collectPaymentMethod({ paymentIntent: pi })
    if (colErr) throw new Error(colErr.message) // aquí el SDK pide ACERCAR LA TARJETA

    const { paymentIntent: confirmed, error: confErr } = await confirmPaymentIntent({ paymentIntent: collected })
    if (confErr) throw new Error(confErr.message)

    return { status: confirmed?.status ?? 'succeeded', paymentIntentId: intent.paymentIntentId }
  }

  return { charge, connectedReader }
}
