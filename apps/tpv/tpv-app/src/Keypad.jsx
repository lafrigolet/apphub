import React from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { formatEur } from './lib/amount.js'

// Teclado moderno del TPV. Rejilla 1-9, fila final [ "00", "0", ⌫ ],
// display grande del importe y botón Cobrar a ancho completo.
export default function Keypad({ amountCents, onDigit, onDoubleZero, onBackspace, onClear, onCharge, busy }) {
  const Key = ({ label, onPress, variant }) => (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.key,
        variant === 'muted' && styles.keyMuted,
        pressed && styles.keyPressed,
        busy && styles.keyDisabled,
      ]}
      android_ripple={{ color: '#2a2f3a' }}
    >
      <Text style={[styles.keyText, variant === 'muted' && styles.keyTextMuted]}>{label}</Text>
    </Pressable>
  )

  return (
    <View style={styles.container}>
      <View style={styles.display}>
        <Text style={styles.displayLabel}>IMPORTE</Text>
        <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
          {formatEur(amountCents)}
        </Text>
        <Pressable onPress={onClear} disabled={busy} hitSlop={12}>
          <Text style={styles.clear}>Borrar</Text>
        </Pressable>
      </View>

      <View style={styles.grid}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <Key key={d} label={String(d)} onPress={() => onDigit(d)} />
        ))}
        <Key label="00" onPress={onDoubleZero} variant="muted" />
        <Key label="0" onPress={() => onDigit(0)} />
        <Key label="⌫" onPress={onBackspace} variant="muted" />
      </View>

      <Pressable
        onPress={onCharge}
        disabled={busy || amountCents <= 0}
        style={({ pressed }) => [
          styles.charge,
          (busy || amountCents <= 0) && styles.chargeDisabled,
          pressed && styles.chargePressed,
        ]}
        android_ripple={{ color: '#0a7d4f' }}
      >
        <Text style={styles.chargeText}>{busy ? 'Procesando…' : 'Cobrar'}</Text>
      </Pressable>
    </View>
  )
}

const GAP = 12

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'flex-end', gap: 18 },
  display: { alignItems: 'center', gap: 6, marginBottom: 8 },
  displayLabel: { color: '#7d8597', fontSize: 12, letterSpacing: 3, fontWeight: '600' },
  amount: { color: '#f5f7fa', fontSize: 64, fontWeight: '700', fontVariant: ['tabular-nums'] },
  clear: { color: '#7d8597', fontSize: 15, fontWeight: '600', paddingVertical: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: GAP },
  key: {
    width: '31%',
    aspectRatio: 1.6,
    backgroundColor: '#1b1f29',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyMuted: { backgroundColor: '#11141b' },
  keyPressed: { backgroundColor: '#262c3a' },
  keyDisabled: { opacity: 0.5 },
  keyText: { color: '#f5f7fa', fontSize: 28, fontWeight: '600', fontVariant: ['tabular-nums'] },
  keyTextMuted: { color: '#aeb6c5' },
  charge: {
    backgroundColor: '#12b76a',
    borderRadius: 18,
    paddingVertical: 20,
    alignItems: 'center',
  },
  chargeDisabled: { backgroundColor: '#1b3a2b' },
  chargePressed: { backgroundColor: '#0ea05c' },
  chargeText: { color: '#fff', fontSize: 20, fontWeight: '700', letterSpacing: 0.5 },
})
