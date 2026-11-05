import { describe, expect, it } from 'vitest'
import { configureFromRuntimeConfig, configureStorage, createMemoryAdapter, localAdapter, storageFor, storageTasks } from '../../server'
import type { StorageSettings } from '../../shared/contracts'

const settings: StorageSettings = {
  provider: 'memory',
  dataRegion: 'de',
  buckets: { uploads: 'u', private: 'p', public: 'pub', backup: 'b' },
  publicBaseUrl: 'https://files.example.test',
}

describe('registry', () => {
  it('fails closed until the host configures storage', () => {
    expect(() => storageFor('media')).toThrow('not-configured')
  })

  it('stays unconfigured when runtime configuration names no provider', () => {
    expect(configureFromRuntimeConfig({ provider: '' })).toBe(false)
    expect(() => storageFor('media')).toThrow('not-configured')
  })

  it('refuses incomplete runtime configuration', () => {
    expect(() => configureFromRuntimeConfig({ provider: 's3', dataRegion: 'de', publicBaseUrl: 'x', buckets: { uploads: 'u' } })).toThrow('not-configured')
  })

  it('configures from runtime configuration', () => {
    const configured = configureFromRuntimeConfig({
      provider: 'memory',
      dataRegion: 'de',
      publicBaseUrl: 'https://files.example.test',
      buckets: { uploads: 'u', private: 'p', public: 'pub', backup: 'b' },
      s3: { endpoint: '', region: '', forcePathStyle: false },
      secrets: { accessKeyId: '', secretAccessKey: '', signingSecret: '' },
    })
    expect(configured).toBe(true)
    expect(storageFor('media').publicUrl('t1/g1/media/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b')).toBe(
      'https://files.example.test/t1/g1/media/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    )
  })

  it('returns one service per consumer and tasks covering them all', async () => {
    configureStorage({ settings, secrets: {}, adapter: createMemoryAdapter(), warn: () => {} })
    expect(storageFor('media')).toBe(storageFor('media'))
    storageFor('documents')
    const tasks = storageTasks()
    expect(tasks.map((task) => task.name)).toEqual(['storage.backup', 'storage.usage'])
    for (const task of tasks) await task.run()
    expect(localAdapter()).toBeNull()
  })
})
