export const storageErrorCodes = [
  'not-configured',
  'adapter-refused',
  'tenant-mismatch',
  'not-authorised',
  'validation-failed',
  'checksum-mismatch',
  'not-found',
  'already-exists',
  'expired',
  'region-not-honoured',
  'provider-unavailable',
] as const

export type StorageErrorCode = (typeof storageErrorCodes)[number]

export class StorageError extends Error {
  readonly code: StorageErrorCode
  readonly messageKey: string

  constructor(code: StorageErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'StorageError'
    this.code = code
    this.messageKey = `storage.errors.${code}`
  }
}

export function isStorageError(value: unknown, code?: StorageErrorCode): value is StorageError {
  return value instanceof StorageError && (code === undefined || value.code === code)
}
