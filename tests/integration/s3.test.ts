// Runs against a disposable S3-compatible server only (CI starts SeaweedFS); never a hosted bucket.
import { createHash } from 'node:crypto'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { beforeAll, describe, expect, it } from 'vitest'
import { createS3Adapter } from '../../server/adapters/s3'
import { makeKey } from '../../shared/contracts'
import type { StorageSettings } from '../../shared/contracts'

const endpoint = process.env.S3_TEST_ENDPOINT
const accessKeyId = process.env.S3_TEST_ACCESS_KEY
const secretAccessKey = process.env.S3_TEST_SECRET_KEY
if (!endpoint || !accessKeyId || !secretAccessKey) {
  throw new Error('S3_TEST_ENDPOINT, S3_TEST_ACCESS_KEY and S3_TEST_SECRET_KEY are required for integration tests')
}

const run = Date.now().toString(36)
const settings: StorageSettings = {
  provider: 's3',
  dataRegion: 'test',
  buckets: { uploads: `uploads-${run}`, private: `private-${run}`, public: `public-${run}`, backup: `backup-${run}` },
  publicBaseUrl: `${endpoint}/public-${run}`,
  s3: { endpoint, region: 'us-east-1', forcePathStyle: true },
}
const adapter = createS3Adapter(settings, { accessKeyId, secretAccessKey })
const bytes = new TextEncoder().encode('hello storage')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const meta = { contentType: 'text/plain', size: bytes.byteLength, sha256 }
const newKey = () => makeKey({ tenantId: 't1', groupId: 'g1', consumer: 'media' })

async function text(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text()
}

beforeAll(async () => {
  const admin = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } })
  for (const bucket of Object.values(settings.buckets)) await admin.send(new CreateBucketCommand({ Bucket: bucket }))
  // A fresh server allocates storage on each bucket's first write, which can take
  // several seconds; write once to every bucket, retrying, before the tests run.
  for (const role of ['uploads', 'private', 'public', 'backup'] as const) {
    const key = newKey()
    for (let attempt = 1; ; attempt++) {
      try {
        await adapter.put(role, key, bytes, meta)
        await adapter.remove(role, key)
        break
      } catch (error) {
        if (attempt >= 30) throw error
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }
  }
}, 120_000)

describe('S3 adapter against a disposable S3 server', () => {
  it('puts, heads, gets and removes', async () => {
    const key = newKey()
    await adapter.put('private', key, bytes, meta)
    expect(await adapter.head('private', key)).toMatchObject(meta)
    const got = await adapter.get('private', key)
    expect(await text(got!.body)).toBe('hello storage')
    await adapter.remove('private', key)
    expect(await adapter.head('private', key)).toBeNull()
    await adapter.remove('private', key)
  })

  it('lists by prefix a page at a time', async () => {
    const keys = [newKey(), newKey(), newKey()]
    for (const key of keys) await adapter.put('private', key, bytes, meta)
    const first = await adapter.list('private', 't1/g1/', { limit: 2 })
    expect(first.objects).toHaveLength(2)
    const second = await adapter.list('private', 't1/g1/', { after: first.next!, limit: 2 })
    expect(second.objects.length).toBeGreaterThanOrEqual(1)
    expect((await adapter.list('private', 't2/', { limit: 10 })).objects).toHaveLength(0)
  })

  it('copies between buckets keeping metadata', async () => {
    const key = newKey()
    const to = newKey()
    await adapter.put('uploads', key, bytes, meta)
    await adapter.copy({ bucket: 'uploads', key }, { bucket: 'public', key: to })
    expect(await adapter.head('public', to)).toMatchObject(meta)
  })

  it('signs a PUT and a GET that work once used', async () => {
    const key = newKey()
    const put = await adapter.signPut('uploads', key, { ...meta, expiresInSeconds: 60 })
    const uploaded = await fetch(put.url, { method: 'PUT', headers: put.headers, body: bytes })
    expect(uploaded.status).toBe(200)
    expect((await adapter.head('uploads', key))?.sha256).toBe(sha256)
    const get = await adapter.signGet('uploads', key, { expiresInSeconds: 60, filename: 'hello.txt' })
    const downloaded = await fetch(get.url)
    expect(await downloaded.text()).toBe('hello storage')
  })

  it('refuses a signed PUT whose content type differs', async () => {
    const put = await adapter.signPut('uploads', newKey(), { ...meta, expiresInSeconds: 60 })
    const refused = await fetch(put.url, { method: 'PUT', headers: { 'content-type': 'text/html' }, body: bytes })
    expect(refused.status).toBe(403)
  })

  it('completes a multipart upload from signed parts', async () => {
    const key = newKey()
    const part = new Uint8Array(5 * 1024 * 1024).fill(97)
    const last = new TextEncoder().encode('end')
    const whole = new Uint8Array(part.byteLength + last.byteLength)
    whole.set(part)
    whole.set(last, part.byteLength)
    const digest = createHash('sha256').update(whole).digest('hex')
    const { uploadId } = await adapter.multipartStart('uploads', key, { contentType: 'text/plain', size: whole.byteLength, sha256: digest })
    const parts = []
    for (const [index, chunk] of [part, last].entries()) {
      const signed = await adapter.multipartSignPart('uploads', key, { uploadId, partNumber: index + 1, expiresInSeconds: 60 })
      const res = await fetch(signed.url, { method: 'PUT', body: chunk })
      expect(res.status).toBe(200)
      parts.push({ partNumber: index + 1, etag: res.headers.get('etag')! })
    }
    await adapter.multipartComplete('uploads', key, { uploadId, parts })
    expect((await adapter.head('uploads', key))?.size).toBe(whole.byteLength)
  })

  it('aborts a multipart upload', async () => {
    const key = newKey()
    const { uploadId } = await adapter.multipartStart('uploads', key, meta)
    await adapter.multipartAbort('uploads', key, { uploadId })
    expect(await adapter.head('uploads', key)).toBeNull()
  })
})

describe('S3 adapter configuration', () => {
  it('fails closed without credentials', () => {
    expect(() => createS3Adapter(settings, {})).toThrow('not-configured')
  })

  it('refuses plain HTTP outside localhost', () => {
    expect(() => createS3Adapter({ ...settings, s3: { endpoint: 'http://example.com', region: 'x' } }, { accessKeyId, secretAccessKey })).toThrow('not-configured')
  })
})
