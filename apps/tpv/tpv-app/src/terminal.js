import { useStripeTerminal } from '@stripe/stripe-terminal-react-native'
import { createTerminalIntent, fetchConnectionToken } from './lib/api.js'

// Hook que orquesta el cobro Tap to Pay con el SDK nativo de Stripe Terminal.
//
// API según @stripe/stripe-terminal-react-native 0.0.1-beta.31:
//   - discoveryMethod es 'tapToPay' (en versiones viejas era 'localMobile').
//   - La conexión es unificada: connectReader(params) / easyConnect(params).
//     easyConnect descubre + conecta en una sola llamada y evita la carrera
//     de leer discoveredReaders (que se rellena async vía el provider).
export function useTapToPay() {
  const {
    initialize,
    easyConnect,
    connectedReader,
    retrievePaymentIntent,
    collectPaymentMethod,
    confirmPaymentIntent,
  } = useStripeTerminal()

  // Conecta el móvil como lector Tap to Pay (idempotente: si ya hay lector, no hace nada).
  // El locationId lo da el endpoint connection-token del backend.
  async function ensureReader() {
    if (connectedReader) return connectedReader
    await initialize()
    const { locationId } = await fetchConnectionToken()
    const { reader, error } = await easyConnect({
      discoveryMethod: 'tapToPay',
      simulated: true, // en producción/dispositivo real: false
      locationId,
    })
    if (error) throw new Error(error.message)
    if (!reader) throw new Error('No se pudo conectar el lector Tap to Pay')
    return reader
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
