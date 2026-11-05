// The in-memory fake of the provider port, refused outside tests (ADR-0002, ADR-0012).
import { randomBytes } from 'node:crypto'
import { StorageError } from '../../shared/contracts/errors'
import type { Clock } from '../../shared/contracts/shapes'
import { createLocalAdapter, type LocalAdapter, type LocalBackend } from './local'
import { runtimeMode, type RuntimeMode } from './mode'

function memoryBackend(): LocalBackend {
  const files = new Map<string, Uint8Array>()
  const id = (area: string, path: string) => `${area}\u0000${path}`
  return {
    async read(area, path) {
      return files.get(id(area, path)) ?? null
    },
    async write(area, path, bytes) {
      files.set(id(area, path), bytes.slice())
    },
    async remove(area, path) {
      files.delete(id(area, path))
    },
    async removeTree(area, path) {
      for (const name of [...files.keys()]) if (name.startsWith(id(area, `${path}/`))) files.delete(name)
    },
    async list(area) {
      const start = id(area, '')
      return [...files.keys()].filter((name) => name.startsWith(start)).map((name) => name.slice(start.length)).sort()
    },
  }
}

export function createMemoryAdapter(options: { now?: Clock; mode?: RuntimeMode } = {}): LocalAdapter {
  if ((options.mode ?? runtimeMode()) !== 'test') throw new StorageError('adapter-refused', 'the in-memory fake is for tests only')
  return createLocalAdapter({
    kind: 'memory',
    backend: memoryBackend(),
    secret: randomBytes(32).toString('hex'),
    baseUrl: 'http://storage.test/_storage',
    now: options.now,
  })
}
