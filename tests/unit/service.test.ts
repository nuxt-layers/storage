import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createFilesystemAdapter, createMemoryAdapter, createStorageService, type LocalAdapter } from '../../server'
import type { StorageError, StorageScope, StorageSettings } from '../../shared/contracts'

let clock = new Date('2026-11-05T12:00:00.000Z')
const now = () => clock
const settings: StorageSettings = {
  provider: 'memory',
  dataRegion: 'de',
  buckets: { uploads: 'u', private: 'p', public: 'pub', backup: 'b' },
  publicBaseUrl: 'https://files.example.test/',
}
const caller = { tenantId: 't1', subjectId: 's1', assurance: 'aal1' }
const scope: StorageScope = { caller, tenantId: 't1', groupId: 'g1', dataRegion: 'de' }
const allow = { allowed: true, reason: 'test' }
const deny = { allowed: false, reason: 'test' }
const bytes = new TextEncoder().encode('hello storage')
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const upload = { visibility: 'private' as const, contentType: 'text/plain', sha256: sha256(bytes), size: bytes.byteLength }

function setup(extra: { contentTypes?: string[] } = {}) {
  const adapter = createMemoryAdapter({ now })
  const storage = createStorageService({ consumer: 'media', settings, secrets: {}, adapter, now, warn: () => {}, ...extra })
  return { adapter, storage }
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return (error as StorageError).code
  }
  return 'none'
}

async function send(adapter: LocalAdapter, signed: { url: string; method: string; headers: Record<string, string> }, body?: Uint8Array) {
  return adapter.handle(new Request(signed.url, { method: signed.method, headers: signed.headers, body }))
}

describe('isolation and checks', () => {
  it('refuses a scope whose tenant is not the caller tenant', async () => {
    const { storage } = setup()
    expect(await code(storage.put({ ...scope, tenantId: 't2' }, { ...upload, body: bytes }))).toBe('tenant-mismatch')
  })

  it('refuses a tenant whose data region the buckets cannot honour', async () => {
    const { storage } = setup()
    expect(await code(storage.put({ ...scope, dataRegion: 'uk' }, { ...upload, body: bytes }))).toBe('region-not-honoured')
  })

  it('hides another group object as not-found', async () => {
    const { storage } = setup()
    const { key } = await storage.put(scope, { ...upload, body: bytes })
    expect(await code(storage.head({ ...scope, groupId: 'g2' }, key))).toBe('not-found')
  })

  it('signs nothing without an allowed decision', async () => {
    const { storage } = setup()
    expect(await code(storage.signUpload(scope, deny, upload))).toBe('not-authorised')
  })

  it('enforces the consumer content-type allow-list', async () => {
    const { storage } = setup({ contentTypes: ['image/webp'] })
    expect(await code(storage.put(scope, { ...upload, body: bytes }))).toBe('validation-failed')
  })

  it('refuses a body whose checksum differs', async () => {
    const { storage } = setup()
    expect(await code(storage.put(scope, { ...upload, sha256: 'a'.repeat(64), body: bytes }))).toBe('checksum-mismatch')
  })
})

describe('objects', () => {
  it('puts, gets, heads, lists, copies and removes', async () => {
    const { storage } = setup()
    const { key } = await storage.put(scope, { ...upload, body: bytes })
    expect(key.startsWith('t1/g1/media/')).toBe(true)
    const got = await storage.get(scope, key)
    expect(await new Response(got.body).text()).toBe('hello storage')
    expect(await storage.head(scope, key)).toMatchObject({ visibility: 'private', sha256: upload.sha256 })
    const copy = await storage.copy(scope, key, { visibility: 'public' })
    expect(storage.publicUrl(copy.key)).toBe(`https://files.example.test/${copy.key}`)
    expect((await storage.list(scope)).keys.sort()).toEqual([key, copy.key].sort())
    await storage.remove(scope, key)
    expect(await code(storage.head(scope, key))).toBe('not-found')
  })

  it('streams a put and checks it', async () => {
    const { storage } = setup()
    const body = new Response(bytes).body as ReadableStream<Uint8Array>
    const { key } = await storage.put(scope, { ...upload, body })
    expect((await storage.head(scope, key)).size).toBe(bytes.byteLength)
  })

  it('pages a list across private and public objects', async () => {
    const { storage } = setup()
    for (let i = 0; i < 3; i++) await storage.put(scope, { ...upload, body: bytes })
    for (let i = 0; i < 2; i++) await storage.put(scope, { ...upload, visibility: 'public', body: bytes })
    const seen: string[] = []
    let after: string | undefined
    do {
      const page = await storage.list(scope, { after, limit: 2 })
      seen.push(...page.keys)
      after = page.next ?? undefined
    } while (after !== undefined)
    expect(new Set(seen).size).toBe(5)
  })

  it('reports usage by tenant and group', async () => {
    const { storage } = setup()
    await storage.put(scope, { ...upload, body: bytes })
    expect(await storage.usage(scope)).toEqual({ bytes: bytes.byteLength, objects: 1 })
    expect(await storage.usage({ ...scope, groupId: 'g2' })).toEqual({ bytes: 0, objects: 0 })
  })
})

describe('signed addresses', () => {
  it('uploads, claims and downloads', async () => {
    const { adapter, storage } = setup()
    const signed = await storage.signUpload(scope, allow, upload)
    expect(signed.expiresAt.getTime() - clock.getTime()).toBe(300_000)
    expect((await send(adapter, signed, bytes)).status).toBe(200)
    await storage.claim(scope, signed.key, { visibility: 'private' })
    const download = await storage.signDownload(scope, allow, signed.key, { filename: 'hello.txt' })
    const res = await send(adapter, { url: download.url, method: 'GET', headers: {} })
    expect(await res.text()).toBe('hello storage')
  })

  it('refuses an upload with other headers, and an expired address', async () => {
    const { adapter, storage } = setup()
    const signed = await storage.signUpload(scope, allow, upload)
    expect((await send(adapter, { ...signed, headers: { ...signed.headers, 'content-type': 'text/html' } }, bytes)).status).toBe(403)
    clock = new Date(clock.getTime() + 301_000)
    expect((await send(adapter, signed, bytes)).status).toBe(403)
  })

  it('removes a claimed upload whose bytes differ from its checksum', async () => {
    const { adapter, storage } = setup()
    const other = new TextEncoder().encode('other content')
    const signed = await storage.signUpload(scope, allow, { ...upload, size: other.byteLength })
    expect((await send(adapter, signed, other)).status).toBe(200)
    expect(await code(storage.claim(scope, signed.key, { visibility: 'private' }))).toBe('checksum-mismatch')
    expect(await code(storage.claim(scope, signed.key, { visibility: 'private' }))).toBe('not-found')
  })

  it('does not sign downloads of public objects', async () => {
    const { storage } = setup()
    const { key } = await storage.put(scope, { ...upload, visibility: 'public', body: bytes })
    expect(await code(storage.signDownload(scope, allow, key))).toBe('not-found')
  })

  it('completes a multipart upload from signed parts', async () => {
    const { adapter, storage } = setup()
    const { key, uploadId } = await storage.multipart.start(scope, allow, upload)
    const parts = []
    for (const [index, chunk] of [bytes.slice(0, 5), bytes.slice(5)].entries()) {
      const signed = await storage.multipart.signPart(scope, allow, key, { uploadId, partNumber: index + 1 })
      const res = await send(adapter, signed, chunk)
      parts.push({ partNumber: index + 1, etag: res.headers.get('etag') ?? '' })
    }
    await storage.multipart.complete(scope, key, { uploadId, parts })
    await storage.claim(scope, key, { visibility: 'public' })
    expect((await storage.head(scope, key)).size).toBe(bytes.byteLength)
  })
})

describe('backups', () => {
  it('copies nightly and ages removed copies out after 30 days', async () => {
    const { adapter, storage } = setup()
    const { key } = await storage.put(scope, { ...upload, body: bytes })
    const backup = storage.tasks.find((task) => task.name === 'storage.backup')!
    await backup.run()
    expect(await adapter.head('backup', key)).not.toBeNull()
    await storage.remove(scope, key)
    await backup.run()
    expect(await adapter.head('backup', key)).not.toBeNull()
    clock = new Date(clock.getTime() + 31 * 86_400_000)
    await backup.run()
    expect(await adapter.head('backup', key)).toBeNull()
  })
})

describe('adapters refuse the wrong environment', () => {
  it('refuses the fake outside tests', () => {
    expect(() => createMemoryAdapter({ mode: 'development' })).toThrow('adapter-refused')
  })

  it('refuses the filesystem adapter in production and without a secret', () => {
    const fs = { ...settings, provider: 'filesystem' as const, filesystem: { root: '/tmp/x', baseUrl: 'http://localhost:3000/_storage' } }
    expect(() => createFilesystemAdapter(fs, { signingSecret: 'x'.repeat(32) }, { mode: 'production' })).toThrow('adapter-refused')
    expect(() => createFilesystemAdapter(fs, {}, { mode: 'development' })).toThrow('not-configured')
  })

  it('fails closed without settings', () => {
    expect(() => createStorageService({ consumer: 'media', settings: undefined as never, secrets: {} })).toThrow('not-configured')
  })
})

describe('filesystem adapter', () => {
  const roots: string[] = []
  afterAll(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true })
  })

  it('stores, signs and serves objects on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storage-'))
    roots.push(root)
    const fs = { ...settings, provider: 'filesystem' as const, filesystem: { root, baseUrl: 'http://localhost:3000/_storage' } }
    const adapter = createFilesystemAdapter(fs, { signingSecret: 'x'.repeat(32) }, { mode: 'development', now })
    const storage = createStorageService({ consumer: 'media', settings: fs, secrets: {}, adapter, now })
    const signed = await storage.signUpload(scope, allow, upload)
    expect((await send(adapter, signed, bytes)).status).toBe(200)
    await storage.claim(scope, signed.key, { visibility: 'private' })
    const got = await storage.get(scope, signed.key)
    expect(await new Response(got.body).text()).toBe('hello storage')
    await expect(adapter.head('private', '../../etc/passwd')).rejects.toThrow('validation-failed')
  })
})
