import { describe, it, expect } from 'vitest'
import { resolveTenantScope } from '../lib/tenant-scope.js'

const tenantA = '60000000-0000-0000-0000-000000000001'
const tenantB = '60000000-0000-0000-0000-0000000000ff'

describe('resolveTenantScope', () => {
  it('uses the identity tenant when no override is provided', () => {
    const identity = { appId: 'tpv', tenantId: tenantA, subTenantId: null, role: 'manager' }
    expect(resolveTenantScope(identity, {})).toEqual({
      appId: 'tpv', tenantId: tenantA, subTenantId: null, impersonated: false,
    })
  })

  it('lets staff impersonate another tenant via ?appId&tenantId', () => {
    const identity = { appId: 'console', tenantId: tenantA, subTenantId: null, role: 'staff' }
    const scope = resolveTenantScope(identity, { appId: 'tpv', tenantId: tenantB })
    expect(scope).toEqual({ appId: 'tpv', tenantId: tenantB, subTenantId: null, impersonated: true })
  })

  it('lets super_admin impersonate another tenant', () => {
    const identity = { appId: 'console', tenantId: tenantA, subTenantId: null, role: 'super_admin' }
    expect(resolveTenantScope(identity, { tenantId: tenantB }).tenantId).toBe(tenantB)
  })

  it('IGNORES the override for non-staff roles (no privilege escalation)', () => {
    const identity = { appId: 'tpv', tenantId: tenantA, subTenantId: null, role: 'manager' }
    const scope = resolveTenantScope(identity, { appId: 'tpv', tenantId: tenantB })
    expect(scope.tenantId).toBe(tenantA)
    expect(scope.impersonated).toBe(false)
  })

  it('preserves the identity subTenantId', () => {
    const sub = '60000000-0000-0000-0000-0000000000aa'
    const identity = { appId: 'tpv', tenantId: tenantA, subTenantId: sub, role: 'staff' }
    expect(resolveTenantScope(identity, {}).subTenantId).toBe(sub)
  })
})
