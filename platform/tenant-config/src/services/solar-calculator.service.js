import { z } from 'zod'
import { withTransaction, pool } from '../lib/db.js'
import * as appsRepo from '../repositories/apps.repository.js'
import { NotFoundError } from '@apphub/platform-sdk/errors'

// Constantes físico-económicas Tier 1+2 que la calculadora solar de js-electric
// (y cualquier otra app que las quiera reutilizar) lee de
// platform_tenants.apps.metadata.solarCalculator. Estos defaults son lo que
// estaba hardcoded en Calculadora.jsx — peninsular medio, paneles std.
export const SOLAR_CALCULATOR_DEFAULTS = Object.freeze({
  irradianceHours:    1650,    // horas equivalentes/año (irradiación)
  pricePerKwh:        0.18,    // €/kWh (precio luz)
  installCostPerKwp:  1200,    // €/kWp llave en mano
  co2KgPerKwh:        0.27,    // kg CO₂ evitado por kWh autoconsumido
  m2PerKwp:           5,       // m² de cubierta necesarios por kWp
  monthlyBillPerKwp:  25,      // € factura/mes que justifican 1 kWp instalado
  installations: {
    residential: { label: 'Residencial',          billUplift: 1.0, selfConsumption: 0.75 },
    business:    { label: 'Empresa / Industrial', billUplift: 1.4, selfConsumption: 0.85 },
  },
  orientations: [
    { label: 'Este',  factor: 0.85 },
    { label: 'Sur',   factor: 1.00 },
    { label: 'Oeste', factor: 0.85 },
    { label: 'Plana', factor: 0.60 },
  ],
})

// Zod schema — validación en el PATCH. Rangos amplios pero acotados (evita
// negativos, NaN, valores absurdos que rompan la fórmula del cliente).
const installationSchema = z.object({
  label:           z.string().min(1).max(64),
  billUplift:      z.number().positive().max(5),
  selfConsumption: z.number().positive().max(1),
})

export const solarCalculatorBody = z.object({
  irradianceHours:    z.number().positive().max(3000),
  pricePerKwh:        z.number().positive().max(2),
  installCostPerKwp:  z.number().positive().max(10000),
  co2KgPerKwh:        z.number().positive().max(2),
  m2PerKwp:           z.number().positive().max(50),
  monthlyBillPerKwp:  z.number().positive().max(500),
  installations: z.object({
    residential: installationSchema,
    business:    installationSchema,
  }),
  orientations: z.array(z.object({
    label:  z.string().min(1).max(64),
    factor: z.number().positive().max(2),
  })).min(1).max(8),
})

export async function getConfig(appId) {
  return withTransaction(pool, async (client) => {
    const stored = await appsRepo.getMetadataKey(client, appId, 'solarCalculator')
    if (stored === undefined) throw new NotFoundError('App')
    return stored ?? SOLAR_CALCULATOR_DEFAULTS
  })
}

export async function setConfig(appId, config) {
  return withTransaction(pool, async (client) => {
    const result = await appsRepo.setMetadataKey(client, appId, 'solarCalculator', config)
    if (!result) throw new NotFoundError('App')
    return result.value
  })
}
