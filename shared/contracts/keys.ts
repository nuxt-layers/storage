// Key rules: storage makes every key; consumers never supply key text.
import { StorageError } from './errors'
import type { Clock } from './shapes'

export const SIGNED_URL_DEFAULT_SECONDS = 300
export const SIGNED_URL_MAX_SECONDS = 900

const identifier = /^[A-Za-z0-9_-]{1,64}$/
const consumerName = /^[a-z][a-z0-9-]{1,31}$/
const uuidv7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const sha256Pattern = /^[0-9a-f]{64}$/
const contentTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/

export interface KeyParts {
  tenantId: string
  groupId: string
  consumer: string
  objectId: string
}

export function uuidv7(now: Clock = () => new Date()): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let ms = now().getTime()
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256
    ms = Math.floor(ms / 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function assertIdentifier(value: string, name: string): void {
  if (!identifier.test(value)) throw new StorageError('validation-failed', `${name} is not a valid identifier`)
}

export function assertConsumer(value: string): void {
  if (!consumerName.test(value)) throw new StorageError('validation-failed', 'consumer is not a valid name')
}

export function assertSha256(value: string): void {
  if (!sha256Pattern.test(value)) throw new StorageError('validation-failed', 'sha256 must be 64 lowercase hexadecimal characters')
}

export function assertContentType(value: string): void {
  if (!contentTypePattern.test(value)) throw new StorageError('validation-failed', 'contentType is not a valid media type')
}

export function makeKey(parts: Omit<KeyParts, 'objectId'>, now?: Clock): string {
  assertIdentifier(parts.tenantId, 'tenantId')
  assertIdentifier(parts.groupId, 'groupId')
  assertConsumer(parts.consumer)
  return `${parts.tenantId}/${parts.groupId}/${parts.consumer}/${uuidv7(now)}`
}

export function parseKey(key: string): KeyParts {
  const segments = key.split('/')
  if (segments.length !== 4) throw new StorageError('validation-failed', 'key has the wrong shape')
  const [tenantId, groupId, consumer, objectId] = segments as [string, string, string, string]
  if (!identifier.test(tenantId) || !identifier.test(groupId) || !consumerName.test(consumer) || !uuidv7Pattern.test(objectId)) {
    throw new StorageError('validation-failed', 'key has the wrong shape')
  }
  return { tenantId, groupId, consumer, objectId }
}

/** The prefix every list and usage query is confined to. */
export function scopePrefix(tenantId: string, groupId?: string): string {
  assertIdentifier(tenantId, 'tenantId')
  if (groupId === undefined) return `${tenantId}/`
  assertIdentifier(groupId, 'groupId')
  return `${tenantId}/${groupId}/`
}

/** Refuses a key outside the scope's tenant, group or consumer. */
export function assertKeyInScope(key: string, scope: { tenantId: string; groupId: string }, consumer: string): KeyParts {
  const parts = parseKey(key)
  if (parts.tenantId !== scope.tenantId) throw new StorageError('tenant-mismatch')
  if (parts.groupId !== scope.groupId || parts.consumer !== consumer) throw new StorageError('not-found')
  return parts
}

/** The scope's tenant must be the server-resolved caller's tenant. */
export function assertCallerTenant(scope: { caller: { tenantId: string }; tenantId: string }): void {
  if (scope.caller.tenantId !== scope.tenantId) throw new StorageError('tenant-mismatch')
}

export function signedUrlSeconds(configured?: number): number {
  const seconds = configured ?? SIGNED_URL_DEFAULT_SECONDS
  if (!Number.isInteger(seconds) || seconds < 1) throw new StorageError('validation-failed', 'signedUrlSeconds must be a positive integer')
  return Math.min(seconds, SIGNED_URL_MAX_SECONDS)
}
