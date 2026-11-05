// The storage service: what consumers call. It checks the caller's tenant, the
// data region, the decision and every input, makes the keys, and verifies
// checksums; adapters only move bytes.
import { createHash } from 'node:crypto'
import { StorageError } from '../shared/contracts/errors'
import {
  assertCallerTenant,
  assertConsumer,
  assertContentType,
  assertIdentifier,
  assertKeyInScope,
  assertSha256,
  makeKey,
  parseKey,
  scopePrefix,
  signedUrlSeconds,
} from '../shared/contracts/keys'
import type { BucketRole, ListedObject, ObjectMeta, ObjectStorePort } from '../shared/contracts/port'
import type { ListPage, ObjectInfo, StorageOptions, StorageScope, StorageService, UploadInput, Visibility } from '../shared/contracts/service'
import type { Caller, Decision } from '../shared/contracts/shapes'
import { createAdapter } from './adapters'

export const BACKUP_DAYS = 30
const REMOVED = '.removed'
const DAY_MS = 86_400_000
const live = ['private', 'public'] as const
const EMPTY_SHA256 = createHash('sha256').digest('hex')

export interface CreateStorageInput extends StorageOptions {
  /** An adapter to use instead of the one the settings name, such as the in-memory fake. */
  adapter?: ObjectStorePort
  /** Where operator warnings go; defaults to `console.warn`. */
  warn?: (message: string) => void
}

interface AnyScope {
  caller: Caller
  tenantId: string
  groupId?: string
  dataRegion: string
}

async function digestOf(stream: ReadableStream<Uint8Array>): Promise<{ sha256: string; size: number }> {
  const hash = createHash('sha256')
  let size = 0
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    hash.update(value)
    size += value.byteLength
  }
  return { sha256: hash.digest('hex'), size }
}

export function createStorageService(input: CreateStorageInput): StorageService {
  const { consumer, settings } = input
  if (!settings) throw new StorageError('not-configured')
  assertConsumer(consumer)
  const now = input.now ?? (() => new Date())
  const seconds = signedUrlSeconds(settings.signedUrlSeconds)
  const port = input.adapter ?? createAdapter(settings, input.secrets ?? {}, now)
  const warn = input.warn ?? ((message: string) => console.warn(message))
  const allowList = input.contentTypes ? new Set(input.contentTypes) : null
  const publicBase = settings.publicBaseUrl.replace(/\/$/, '')

  function check(scope: AnyScope): void {
    assertIdentifier(scope.tenantId, 'tenantId')
    if (scope.groupId !== undefined) assertIdentifier(scope.groupId, 'groupId')
    assertCallerTenant(scope)
    if (scope.dataRegion !== settings.dataRegion) throw new StorageError('region-not-honoured')
  }

  function authorised(decision: Decision): void {
    if (decision?.allowed !== true) throw new StorageError('not-authorised')
  }

  function visibility(value: Visibility): Visibility {
    if (value !== 'private' && value !== 'public') throw new StorageError('validation-failed', 'visibility must be private or public')
    return value
  }

  function validate(upload: UploadInput): Omit<ObjectMeta, 'createdAt'> {
    visibility(upload.visibility)
    assertContentType(upload.contentType)
    if (allowList && !allowList.has(upload.contentType)) throw new StorageError('validation-failed', 'content type not allowed')
    assertSha256(upload.sha256)
    if (!Number.isSafeInteger(upload.size) || upload.size < 0) throw new StorageError('validation-failed', 'size must be a whole number of bytes')
    return { contentType: upload.contentType, size: upload.size, sha256: upload.sha256 }
  }

  const newKey = (scope: StorageScope) => makeKey({ tenantId: scope.tenantId, groupId: scope.groupId, consumer }, now)
  const inScope = (scope: StorageScope, key: string) => assertKeyInScope(key, scope, consumer)
  const expiresAt = () => new Date(now().getTime() + seconds * 1000)
  const info = (key: string, bucket: Visibility, meta: ObjectMeta): ObjectInfo => ({ key, visibility: bucket, ...meta })

  async function locate(key: string): Promise<{ bucket: Visibility; meta: ObjectMeta }> {
    for (const bucket of live) {
      const meta = await port.head(bucket, key)
      if (meta) return { bucket, meta }
    }
    throw new StorageError('not-found')
  }

  async function each(bucket: BucketRole, prefix: string, visit: (object: ListedObject) => Promise<void>): Promise<void> {
    let after: string | undefined
    do {
      const page = await port.list(bucket, prefix, { after, limit: 1000 })
      for (const object of page.objects) await visit(object)
      after = page.next ?? undefined
    } while (after !== undefined)
  }

  const ownedByConsumer = (key: string) => {
    try {
      return parseKey(key.endsWith(REMOVED) ? key.slice(0, -REMOVED.length) : key).consumer === consumer
    } catch {
      return false
    }
  }

  async function backup(): Promise<void> {
    for (const bucket of live) {
      await each(bucket, '', async (object) => {
        if (ownedByConsumer(object.key) && !(await port.head('backup', object.key))) {
          await port.copy({ bucket, key: object.key }, { bucket: 'backup', key: object.key })
        }
      })
    }
    const cutoff = now().getTime() - BACKUP_DAYS * DAY_MS
    await each('backup', '', async (object) => {
      if (object.key.endsWith(REMOVED) && ownedByConsumer(object.key) && object.createdAt.getTime() <= cutoff) {
        await port.remove('backup', object.key.slice(0, -REMOVED.length))
        await port.remove('backup', object.key)
      }
    })
  }

  async function report(): Promise<void> {
    let bytes = 0
    let objects = 0
    for (const bucket of live) {
      await each(bucket, '', async (object) => {
        bytes += object.size
        objects += 1
      })
    }
    const limits = settings.limits ?? {}
    const share = (used: number, limit?: number) => (limit ? used / limit : 0)
    for (const [name, value] of [['bytes', share(bytes, limits.bytes)], ['objects', share(objects, limits.objects)]] as const) {
      if (value >= 0.7) warn(`storage: ${name} at ${Math.round(value * 100)}% of the configured limit (${value >= 0.9 ? 'critical' : 'warning'})`)
    }
  }

  return {
    async put(scope, upload) {
      check(scope)
      const meta = validate(upload)
      const bucket = visibility(upload.visibility)
      const key = newKey(scope)
      if (upload.body instanceof Uint8Array) {
        const sha256 = createHash('sha256').update(upload.body).digest('hex')
        if (sha256 !== meta.sha256 || upload.body.byteLength !== meta.size) throw new StorageError('checksum-mismatch')
        await port.put(bucket, key, upload.body, meta)
        return { key }
      }
      const hash = createHash('sha256')
      let size = 0
      const counted = upload.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            hash.update(chunk)
            size += chunk.byteLength
            controller.enqueue(chunk)
          },
        }),
      )
      await port.put(bucket, key, counted, meta)
      if (size !== meta.size || hash.digest('hex') !== meta.sha256) {
        await port.remove(bucket, key)
        throw new StorageError('checksum-mismatch')
      }
      return { key }
    },

    async get(scope, key) {
      check(scope)
      inScope(scope, key)
      for (const bucket of live) {
        const object = await port.get(bucket, key)
        if (object) return { info: info(key, bucket, object.meta), body: object.body }
      }
      throw new StorageError('not-found')
    },

    async head(scope, key) {
      check(scope)
      inScope(scope, key)
      const found = await locate(key)
      return info(key, found.bucket, found.meta)
    },

    async remove(scope, key) {
      check(scope)
      inScope(scope, key)
      await port.remove('uploads', key)
      for (const bucket of live) await port.remove(bucket, key)
      if (await port.head('backup', key)) {
        await port.put('backup', `${key}${REMOVED}`, new Uint8Array(0), { contentType: 'application/octet-stream', size: 0, sha256: EMPTY_SHA256 })
      }
    },

    async list(scope, page = {}): Promise<ListPage> {
      check(scope)
      const prefix = `${scopePrefix(scope.tenantId, scope.groupId)}${consumer}/`
      const limit = Math.min(Math.max(Math.trunc(page.limit ?? 100), 1), 1000)
      let bucket: Visibility = 'private'
      let after: string | undefined
      if (page.after !== undefined) {
        const colon = page.after.indexOf(':')
        const named = colon < 0 ? '' : page.after.slice(0, colon)
        if (named === 'private' || named === 'public') bucket = named
        else throw new StorageError('validation-failed', 'unknown cursor')
        after = page.after.slice(colon + 1) || undefined
      }
      const keys: string[] = []
      for (;;) {
        const result = await port.list(bucket, prefix, { after, limit: limit - keys.length })
        keys.push(...result.objects.map((object) => object.key))
        if (result.next !== null) {
          if (keys.length >= limit) return { keys, next: `${bucket}:${result.next}` }
          after = result.next
          continue
        }
        if (bucket === 'public') return { keys, next: null }
        bucket = 'public'
        after = undefined
        if (keys.length >= limit) return { keys, next: 'public:' }
      }
    },

    async copy(scope, key, to) {
      check(scope)
      inScope(scope, key)
      const target = visibility(to.visibility)
      const source = await locate(key)
      const copyKey = newKey(scope)
      await port.copy({ bucket: source.bucket, key }, { bucket: target, key: copyKey })
      return { key: copyKey }
    },

    async signUpload(scope, decision, upload) {
      check(scope)
      authorised(decision)
      const meta = validate(upload)
      const key = newKey(scope)
      const signed = await port.signPut('uploads', key, { ...meta, expiresInSeconds: seconds })
      return { ...signed, key, expiresAt: expiresAt() }
    },

    async claim(scope, key, to) {
      check(scope)
      inScope(scope, key)
      const target = visibility(to.visibility)
      const object = await port.get('uploads', key)
      if (!object) throw new StorageError('not-found')
      const actual = await digestOf(object.body)
      if (actual.sha256 !== object.meta.sha256 || actual.size !== object.meta.size) {
        await port.remove('uploads', key)
        throw new StorageError('checksum-mismatch')
      }
      await port.copy({ bucket: 'uploads', key }, { bucket: target, key })
      await port.remove('uploads', key)
      return { key }
    },

    async signDownload(scope, decision, key, options = {}) {
      check(scope)
      authorised(decision)
      inScope(scope, key)
      if (options.filename !== undefined && (options.filename.length > 255 || /[\u0000-\u001f\u007f]/.test(options.filename))) {
        throw new StorageError('validation-failed', 'filename is not allowed')
      }
      if (!(await port.head('private', key))) throw new StorageError('not-found')
      const signed = await port.signGet('private', key, { expiresInSeconds: seconds, filename: options.filename })
      return { url: signed.url, expiresAt: expiresAt() }
    },

    multipart: {
      async start(scope, decision, upload) {
        check(scope)
        authorised(decision)
        const meta = validate(upload)
        const key = newKey(scope)
        const { uploadId } = await port.multipartStart('uploads', key, meta)
        return { key, uploadId }
      },

      async signPart(scope, decision, key, part) {
        check(scope)
        authorised(decision)
        inScope(scope, key)
        if (!Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > 10_000) {
          throw new StorageError('validation-failed', 'partNumber must be from 1 to 10000')
        }
        const signed = await port.multipartSignPart('uploads', key, { uploadId: part.uploadId, partNumber: part.partNumber, expiresInSeconds: seconds })
        return { ...signed, key, expiresAt: expiresAt() }
      },

      async complete(scope, key, upload) {
        check(scope)
        inScope(scope, key)
        if (upload.parts.length === 0) throw new StorageError('validation-failed', 'at least one part is required')
        await port.multipartComplete('uploads', key, upload)
        return { key }
      },

      async abort(scope, key, upload) {
        check(scope)
        inScope(scope, key)
        await port.multipartAbort('uploads', key, upload)
      },
    },

    publicUrl(key) {
      parseKey(key)
      return `${publicBase}/${key}`
    },

    async usage(scope) {
      check(scope)
      const prefix = scopePrefix(scope.tenantId, scope.groupId)
      let bytes = 0
      let objects = 0
      for (const bucket of live) {
        await each(bucket, prefix, async (object) => {
          bytes += object.size
          objects += 1
        })
      }
      return { bytes, objects }
    },

    tasks: [
      { name: 'storage.backup', every: '24h', run: backup },
      { name: 'storage.usage', every: '24h', run: report },
    ],
  }
}
