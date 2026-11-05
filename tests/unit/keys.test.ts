import { describe, expect, it } from 'vitest'
import {
  StorageError,
  assertCallerTenant,
  assertKeyInScope,
  assertSha256,
  makeKey,
  parseKey,
  scopePrefix,
  signedUrlSeconds,
  uuidv7,
} from '../../shared/contracts'

const fixed = () => new Date('2026-11-05T00:00:00.000Z')
const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    return (error as StorageError).code
  }
  return 'none'
}

describe('uuidv7', () => {
  it('encodes the clock and the version', () => {
    const id = uuidv7(fixed)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(fixed().getTime())
  })
})

describe('keys', () => {
  it('start with tenant, group and consumer', () => {
    const key = makeKey({ tenantId: 't1', groupId: 'g1', consumer: 'media' }, fixed)
    expect(key.startsWith('t1/g1/media/')).toBe(true)
    expect(parseKey(key)).toMatchObject({ tenantId: 't1', groupId: 'g1', consumer: 'media' })
  })

  it('refuse identifiers that could escape the prefix', () => {
    expect(code(() => makeKey({ tenantId: '../t', groupId: 'g', consumer: 'media' }))).toBe('validation-failed')
    expect(code(() => makeKey({ tenantId: 't', groupId: 'a/b', consumer: 'media' }))).toBe('validation-failed')
    expect(code(() => parseKey('t/g/media/not-a-uuid'))).toBe('validation-failed')
  })

  it('refuse another tenant as tenant-mismatch and another group as not-found', () => {
    const key = makeKey({ tenantId: 't1', groupId: 'g1', consumer: 'media' })
    expect(code(() => assertKeyInScope(key, { tenantId: 't2', groupId: 'g1' }, 'media'))).toBe('tenant-mismatch')
    expect(code(() => assertKeyInScope(key, { tenantId: 't1', groupId: 'g2' }, 'media'))).toBe('not-found')
    expect(code(() => assertKeyInScope(key, { tenantId: 't1', groupId: 'g1' }, 'documents'))).toBe('not-found')
  })

  it('confine prefixes to the tenant and group', () => {
    expect(scopePrefix('t1')).toBe('t1/')
    expect(scopePrefix('t1', 'g1')).toBe('t1/g1/')
  })
})

describe('scope checks', () => {
  it('refuse a scope whose tenant is not the caller tenant', () => {
    const caller = { tenantId: 't1', subjectId: 's1', assurance: 'aal1' }
    expect(code(() => assertCallerTenant({ caller, tenantId: 't2' }))).toBe('tenant-mismatch')
    expect(code(() => assertCallerTenant({ caller, tenantId: 't1' }))).toBe('none')
  })

  it('accept only lowercase hexadecimal SHA-256', () => {
    expect(code(() => assertSha256('a'.repeat(64)))).toBe('none')
    expect(code(() => assertSha256('A'.repeat(64)))).toBe('validation-failed')
  })

  it('cap signed addresses at 15 minutes', () => {
    expect(signedUrlSeconds()).toBe(300)
    expect(signedUrlSeconds(3600)).toBe(900)
  })
})
