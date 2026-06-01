// splitpay-portal — smoke (4.4 · P1). El portal es por ahora una landing
// estática; verificamos que monta y muestra su marca sin crashear.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

describe('splitpay-portal App — smoke', () => {
  it('monta y muestra la marca Split Pay', () => {
    render(<App />)
    expect(screen.getByText('Split Pay')).toBeInTheDocument()
    expect(screen.getByText(/Stripe Connect/)).toBeInTheDocument()
  })
})
