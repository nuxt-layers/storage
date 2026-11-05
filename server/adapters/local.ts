// Shared by the filesystem adapter (development) and the in-memory fake (tests):
// the port over a simple backend, with HMAC-signed local addresses that behave
// like an S3 provider's (one object, one operation, expiry, signed headers).
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { StorageError } from '../../shared/contracts/errors'
import type { Body, BucketRole, ListedObject, ObjectMeta, ObjectStorePort, SignedRequest } from '../../shared/contracts/port'
import type { Clock } from '../../shared/contracts/shapes'

export interface LocalBackend {
  read(area: string, path: string): Promise<Uint8Array | null>
  write(area: string, path: string, data: Uint8Array): Promise<void>
  remove(area: string, path: string): Promise<void>
  removeTree(area: string, path: string): Promise<void>
  /** Every file path in the area, sorted. */
  list(area: string): Promise<string[]>
}

export interface LocalAdapter extends ObjectStorePort {
  /** Answers a request made to one of this adapter's signed addresses. */
  handle(request: Request): Promise<Response>
}

interface MetaFile {
  contentType: string
  size: number
  sha256: string
  createdAt: string
}

const roles: readonly BucketRole[] = ['uploads', 'private', 'public', 'backup']
const localPath = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*$/
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

export async function collect(body: Body): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export function assertLocalPath(path: string): void {
  if (!localPath.test(path) || path.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new StorageError('validation-failed', 'unsafe local path')
  }
}

function isRole(value: string): value is BucketRole {
  return (roles as readonly string[]).includes(value)
}

export function createLocalAdapter(input: {
  kind: 'filesystem' | 'memory'
  backend: LocalBackend
  secret: string
  baseUrl: string
  now?: Clock
}): LocalAdapter {
  const { backend, secret } = input
  const now = input.now ?? (() => new Date())
  const base = new URL(input.baseUrl)
  const basePath = base.pathname.replace(/\/$/, '')
  const data = (bucket: BucketRole) => `${bucket}/data`
  const metaArea = (bucket: BucketRole) => `${bucket}/meta`
  const multipart = (bucket: BucketRole) => `${bucket}/multipart`

  async function readMeta(bucket: BucketRole, key: string): Promise<ObjectMeta | null> {
    assertLocalPath(key)
    const raw = await backend.read(metaArea(bucket), `${key}.json`)
    if (!raw) return null
    const parsed = JSON.parse(decoder.decode(raw)) as MetaFile
    return { contentType: parsed.contentType, size: parsed.size, sha256: parsed.sha256, createdAt: new Date(parsed.createdAt) }
  }

  async function write(bucket: BucketRole, key: string, bytes: Uint8Array, meta: Omit<ObjectMeta, 'createdAt'>): Promise<void> {
    assertLocalPath(key)
    const file: MetaFile = { contentType: meta.contentType, size: bytes.byteLength, sha256: meta.sha256, createdAt: now().toISOString() }
    await backend.write(data(bucket), key, bytes)
    await backend.write(metaArea(bucket), `${key}.json`, encoder.encode(JSON.stringify(file)))
  }

  function signature(fields: Record<string, string>): string {
    const canonical = ['storage-local-v1', fields.op, fields.bucket, fields.key, fields.exp, fields.ct, fields.size, fields.sha, fields.fn, fields.uid, fields.pn]
      .map((value) => value ?? '')
      .join('\n')
    return createHmac('sha256', secret).update(canonical).digest('base64url')
  }

  function sign(bucket: BucketRole, key: string, expiresInSeconds: number, fields: Record<string, string>): string {
    assertLocalPath(key)
    const exp = String(Math.floor(now().getTime() / 1000) + expiresInSeconds)
    const all: Record<string, string> = { ...fields, bucket, key, exp }
    const query = new URLSearchParams({ ...fields, exp, sig: signature(all) })
    return `${base.origin}${basePath}/${bucket}/${key}?${query.toString()}`
  }

  function verified(fields: Record<string, string>, sig: string | null): boolean {
    if (!sig) return false
    const expected = Buffer.from(signature(fields))
    const given = Buffer.from(sig)
    return expected.length === given.length && timingSafeEqual(expected, given)
  }

  const adapter: LocalAdapter = {
    kind: input.kind,

    async put(bucket, key, body, meta) {
      const bytes = await collect(body)
      if (bytes.byteLength !== meta.size) throw new StorageError('validation-failed', 'size does not match the body')
      await write(bucket, key, bytes, meta)
    },

    async get(bucket, key) {
      const meta = await readMeta(bucket, key)
      if (!meta) return null
      const bytes = await backend.read(data(bucket), key)
      return bytes ? { meta, body: streamOf(bytes) } : null
    },

    head: readMeta,

    async remove(bucket, key) {
      assertLocalPath(key)
      await backend.remove(data(bucket), key)
      await backend.remove(metaArea(bucket), `${key}.json`)
    },

    async list(bucket, prefix, page) {
      const keys = (await backend.list(metaArea(bucket)))
        .filter((path) => path.endsWith('.json'))
        .map((path) => path.slice(0, -'.json'.length))
        .filter((key) => key.startsWith(prefix) && (page.after === undefined || key > page.after))
        .sort()
      const chosen = keys.slice(0, page.limit)
      const objects: ListedObject[] = []
      for (const key of chosen) {
        const meta = await readMeta(bucket, key)
        if (meta) objects.push({ key, size: meta.size, createdAt: meta.createdAt })
      }
      const last = chosen[chosen.length - 1]
      return { objects, next: keys.length > chosen.length && last !== undefined ? last : null }
    },

    async copy(from, to) {
      const meta = await readMeta(from.bucket, from.key)
      const bytes = await backend.read(data(from.bucket), from.key)
      if (!meta || !bytes) throw new StorageError('not-found')
      await write(to.bucket, to.key, bytes, meta)
    },

    async signPut(bucket, key, input) {
      const url = sign(bucket, key, input.expiresInSeconds, { op: 'put', ct: input.contentType, size: String(input.size), sha: input.sha256 })
      return { url, method: 'PUT', headers: { 'content-type': input.contentType, 'x-amz-meta-sha256': input.sha256 } }
    },

    async signGet(bucket, key, input) {
      const fields: Record<string, string> = { op: 'get' }
      if (input.filename) fields.fn = input.filename
      return { url: sign(bucket, key, input.expiresInSeconds, fields), method: 'GET', headers: {} }
    },

    async multipartStart(bucket, key, meta) {
      assertLocalPath(key)
      const uploadId = randomUUID()
      await backend.write(multipart(bucket), `${uploadId}/upload.json`, encoder.encode(JSON.stringify({ key, ...meta })))
      return { uploadId }
    },

    async multipartSignPart(bucket, key, input): Promise<SignedRequest> {
      const url = sign(bucket, key, input.expiresInSeconds, { op: 'part', uid: input.uploadId, pn: String(input.partNumber) })
      return { url, method: 'PUT', headers: {} }
    },

    async multipartComplete(bucket, key, input) {
      const upload = await readUpload(bucket, key, input.uploadId)
      const parts: Uint8Array[] = []
      for (const part of [...input.parts].sort((a, b) => a.partNumber - b.partNumber)) {
        const bytes = await backend.read(multipart(bucket), `${input.uploadId}/${part.partNumber}`)
        if (!bytes || `"${sha256Hex(bytes)}"` !== part.etag) throw new StorageError('validation-failed', 'a part is missing or does not match')
        parts.push(bytes)
      }
      const whole = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
      let offset = 0
      for (const part of parts) {
        whole.set(part, offset)
        offset += part.byteLength
      }
      await write(bucket, key, whole, { contentType: upload.contentType, size: whole.byteLength, sha256: upload.sha256 })
      await backend.removeTree(multipart(bucket), input.uploadId)
    },

    async multipartAbort(bucket, key, input) {
      await readUpload(bucket, key, input.uploadId)
      await backend.removeTree(multipart(bucket), input.uploadId)
    },

    async handle(request) {
      const url = new URL(request.url)
      if (!url.pathname.startsWith(`${basePath}/`)) return new Response(null, { status: 404 })
      const rest = decodeURIComponent(url.pathname.slice(basePath.length + 1))
      const slash = rest.indexOf('/')
      const bucket = rest.slice(0, slash)
      const key = rest.slice(slash + 1)
      if (slash < 1 || !isRole(bucket) || !localPath.test(key)) return new Response(null, { status: 404 })
      const q = url.searchParams
      const fields: Record<string, string> = { bucket, key }
      for (const name of ['op', 'exp', 'ct', 'size', 'sha', 'fn', 'uid', 'pn']) {
        const value = q.get(name)
        if (value !== null) fields[name] = value
      }
      if (!verified(fields, q.get('sig')) || Number(fields.exp) * 1000 < now().getTime()) return new Response(null, { status: 403 })

      if (fields.op === 'put') {
        if (request.method !== 'PUT') return new Response(null, { status: 405 })
        if (request.headers.get('content-type') !== fields.ct || request.headers.get('x-amz-meta-sha256') !== fields.sha) {
          return new Response(null, { status: 403 })
        }
        const bytes = new Uint8Array(await request.arrayBuffer())
        if (String(bytes.byteLength) !== fields.size) return new Response(null, { status: 400 })
        await write(bucket, key, bytes, { contentType: fields.ct ?? '', size: bytes.byteLength, sha256: fields.sha ?? '' })
        return new Response(null, { status: 200 })
      }
      if (fields.op === 'get') {
        if (request.method !== 'GET') return new Response(null, { status: 405 })
        const object = await adapter.get(bucket, key)
        if (!object) return new Response(null, { status: 404 })
        const headers: Record<string, string> = { 'content-type': object.meta.contentType, 'content-length': String(object.meta.size) }
        if (fields.fn) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(fields.fn)}`
        return new Response(object.body, { status: 200, headers })
      }
      if (fields.op === 'part') {
        if (request.method !== 'PUT') return new Response(null, { status: 405 })
        try {
          await readUpload(bucket, key, fields.uid ?? '')
        } catch {
          return new Response(null, { status: 404 })
        }
        const bytes = new Uint8Array(await request.arrayBuffer())
        await backend.write(multipart(bucket), `${fields.uid}/${fields.pn}`, bytes)
        return new Response(null, { status: 200, headers: { etag: `"${sha256Hex(bytes)}"` } })
      }
      return new Response(null, { status: 400 })
    },
  }

  async function readUpload(bucket: BucketRole, key: string, uploadId: string): Promise<Omit<ObjectMeta, 'createdAt'> & { key: string }> {
    if (!/^[0-9a-f-]{36}$/.test(uploadId)) throw new StorageError('not-found')
    const raw = await backend.read(multipart(bucket), `${uploadId}/upload.json`)
    const upload = raw ? (JSON.parse(decoder.decode(raw)) as Omit<ObjectMeta, 'createdAt'> & { key: string }) : null
    if (!upload || upload.key !== key) throw new StorageError('not-found')
    return upload
  }

  return adapter
}
