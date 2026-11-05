// The filesystem adapter, for development only: refused in production.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { StorageError } from '../../shared/contracts/errors'
import type { StorageSecrets, StorageSettings } from '../../shared/contracts/service'
import type { Clock } from '../../shared/contracts/shapes'
import { assertLocalPath, createLocalAdapter, type LocalAdapter, type LocalBackend } from './local'
import { runtimeMode, type RuntimeMode } from './mode'

function filesystemBackend(root: string): LocalBackend {
  const base = resolve(root)
  const within = (area: string, path: string) => {
    assertLocalPath(path)
    const areaRoot = resolve(base, area)
    const full = resolve(areaRoot, path)
    if (!full.startsWith(areaRoot + sep)) throw new StorageError('validation-failed', 'unsafe local path')
    return full
  }
  const missing = (error: unknown) => (error as { code?: string }).code === 'ENOENT'
  return {
    async read(area, path) {
      try {
        return new Uint8Array(await readFile(within(area, path)))
      } catch (error) {
        if (missing(error)) return null
        throw error
      }
    },
    async write(area, path, bytes) {
      const full = within(area, path)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, bytes)
    },
    async remove(area, path) {
      await rm(within(area, path), { force: true })
    },
    async removeTree(area, path) {
      await rm(within(area, path), { recursive: true, force: true })
    },
    async list(area) {
      try {
        const entries = await readdir(resolve(base, area), { recursive: true })
        return entries.map((entry) => entry.split(sep).join('/')).sort()
      } catch (error) {
        if (missing(error)) return []
        throw error
      }
    },
  }
}

export function createFilesystemAdapter(
  settings: StorageSettings,
  secrets: StorageSecrets,
  options: { now?: Clock; mode?: RuntimeMode } = {},
): LocalAdapter {
  if ((options.mode ?? runtimeMode()) === 'production') throw new StorageError('adapter-refused', 'the filesystem adapter is for development only')
  const fs = settings.filesystem
  if (!fs?.root || !fs.baseUrl) throw new StorageError('not-configured', 'filesystem root and baseUrl are required')
  if (!secrets.signingSecret || secrets.signingSecret.length < 32) {
    throw new StorageError('not-configured', 'a signing secret of at least 32 characters is required')
  }
  return createLocalAdapter({ kind: 'filesystem', backend: filesystemBackend(fs.root), secret: secrets.signingSecret, baseUrl: fs.baseUrl, now: options.now })
}
