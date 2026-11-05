import { StorageError } from '../../shared/contracts/errors'
import type { ObjectStorePort } from '../../shared/contracts/port'
import type { StorageSecrets, StorageSettings } from '../../shared/contracts/service'
import type { Clock } from '../../shared/contracts/shapes'
import { createFilesystemAdapter } from './filesystem'
import { createMemoryAdapter } from './memory'
import { createS3Adapter } from './s3'

export { createFilesystemAdapter, createMemoryAdapter, createS3Adapter }
export type { LocalAdapter } from './local'
export { runtimeMode, type RuntimeMode } from './mode'

/** The adapter the settings name; each refuses the environments it is not for. */
export function createAdapter(settings: StorageSettings, secrets: StorageSecrets, now?: Clock): ObjectStorePort {
  switch (settings.provider) {
    case 's3':
      return createS3Adapter(settings, secrets)
    case 'filesystem':
      return createFilesystemAdapter(settings, secrets, { now })
    case 'memory':
      return createMemoryAdapter({ now })
    default:
      throw new StorageError('not-configured', 'unknown provider')
  }
}
