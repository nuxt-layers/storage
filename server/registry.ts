// The one storage configuration in a host, set from runtime configuration at
// start-up, and the services consumers ask for by name.
import { StorageError } from '../shared/contracts/errors'
import type { ObjectStorePort } from '../shared/contracts/port'
import type { StorageSecrets, StorageService, StorageSettings } from '../shared/contracts/service'
import type { Clock, Task } from '../shared/contracts/shapes'
import { createAdapter, type LocalAdapter } from './adapters'
import { createStorageService } from './service'

export interface StorageRuntimeConfig {
  provider?: string
  dataRegion?: string
  buckets?: Partial<StorageSettings['buckets']>
  publicBaseUrl?: string
  signedUrlSeconds?: number
  limits?: { bytes?: number; objects?: number }
  s3?: { endpoint?: string; region?: string; forcePathStyle?: boolean | string }
  filesystem?: { root?: string; baseUrl?: string }
  secrets?: StorageSecrets
}

interface Configured {
  settings: StorageSettings
  secrets: StorageSecrets
  adapter: ObjectStorePort
  now?: Clock
  warn?: (message: string) => void
}

let configured: Configured | null = null
const services = new Map<string, StorageService>()
const providers = ['s3', 'filesystem', 'memory'] as const

export function configureStorage(input: Omit<Configured, 'adapter'> & { adapter?: ObjectStorePort }): void {
  const adapter = input.adapter ?? createAdapter(input.settings, input.secrets, input.now)
  configured = { ...input, adapter }
  services.clear()
}

/** Configures storage from `runtimeConfig.storage`; leaves it unconfigured, so every call fails closed, when no provider is set. */
export function configureFromRuntimeConfig(raw: StorageRuntimeConfig | undefined): boolean {
  if (!raw?.provider) return false
  const provider = providers.find((name) => name === raw.provider)
  const buckets = raw.buckets ?? {}
  if (!provider || !raw.dataRegion || !raw.publicBaseUrl || !buckets.uploads || !buckets.private || !buckets.public || !buckets.backup) {
    throw new StorageError('not-configured', 'storage needs a provider, data region, public base URL and four buckets')
  }
  const settings: StorageSettings = {
    provider,
    dataRegion: raw.dataRegion,
    buckets: { uploads: buckets.uploads, private: buckets.private, public: buckets.public, backup: buckets.backup },
    publicBaseUrl: raw.publicBaseUrl,
    signedUrlSeconds: raw.signedUrlSeconds || undefined,
    limits: { bytes: raw.limits?.bytes || undefined, objects: raw.limits?.objects || undefined },
    s3: raw.s3?.endpoint
      ? { endpoint: raw.s3.endpoint, region: raw.s3.region ?? '', forcePathStyle: raw.s3.forcePathStyle === true || raw.s3.forcePathStyle === 'true' }
      : undefined,
    filesystem: raw.filesystem?.root ? { root: raw.filesystem.root, baseUrl: raw.filesystem.baseUrl ?? '' } : undefined,
  }
  const secrets: StorageSecrets = {
    accessKeyId: raw.secrets?.accessKeyId || undefined,
    secretAccessKey: raw.secrets?.secretAccessKey || undefined,
    signingSecret: raw.secrets?.signingSecret || undefined,
  }
  configureStorage({ settings, secrets })
  return true
}

/** The storage service for one consumer, such as `storageFor('media', { contentTypes: ['image/webp'] })`. */
export function storageFor(consumer: string, options: { contentTypes?: string[] } = {}): StorageService {
  if (!configured) throw new StorageError('not-configured', 'the host has not configured storage')
  const id = `${consumer}\n${(options.contentTypes ?? []).join(',')}`
  let service = services.get(id)
  if (!service) {
    const { settings, secrets, adapter, now, warn } = configured
    service = createStorageService({ consumer, settings, secrets, adapter, now, warn, contentTypes: options.contentTypes })
    services.set(id, service)
  }
  return service
}

function byConsumer(): StorageService[] {
  const seen = new Map<string, StorageService>()
  for (const [id, service] of services) seen.set(id.split('\n')[0] ?? id, service)
  return [...seen.values()]
}

/** Backup and usage tasks for the host's one scheduler (ADR-0012), covering every consumer. */
export function storageTasks(): Task[] {
  const run = (name: string, all: boolean) => async () => {
    const chosen = all ? byConsumer() : byConsumer().slice(0, 1)
    for (const service of chosen) await service.tasks.find((task) => task.name === name)?.run()
  }
  return [
    { name: 'storage.backup', every: '24h', run: run('storage.backup', true) },
    { name: 'storage.usage', every: '24h', run: run('storage.usage', false) },
  ]
}

/** The filesystem adapter, when configured, so the development route can answer its signed addresses. */
export function localAdapter(): LocalAdapter | null {
  const adapter = configured?.adapter
  return adapter && adapter.kind === 'filesystem' && 'handle' in adapter ? (adapter as LocalAdapter) : null
}
