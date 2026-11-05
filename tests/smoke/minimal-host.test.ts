// Starts the built examples/minimal-host against a disposable S3 server and
// checks that a host composes storage from runtime configuration alone.
import { spawn, type ChildProcess } from 'node:child_process'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { afterAll, beforeAll, expect, it } from 'vitest'

const endpoint = process.env.S3_TEST_ENDPOINT
const accessKeyId = process.env.S3_TEST_ACCESS_KEY
const secretAccessKey = process.env.S3_TEST_SECRET_KEY
if (!endpoint || !accessKeyId || !secretAccessKey) {
  throw new Error('S3_TEST_ENDPOINT, S3_TEST_ACCESS_KEY and S3_TEST_SECRET_KEY are required for the smoke test')
}

const run = `smoke-${Date.now().toString(36)}`
const buckets = { uploads: `${run}-uploads`, private: `${run}-private`, public: `${run}-public`, backup: `${run}-backup` }
const port = 3900 + Math.floor(Math.random() * 90)
const base = `http://127.0.0.1:${port}`
let server: ChildProcess | undefined

beforeAll(async () => {
  const admin = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } })
  for (const bucket of Object.values(buckets)) await admin.send(new CreateBucketCommand({ Bucket: bucket }))
  server = spawn(process.execPath, ['examples/minimal-host/.output/server/index.mjs'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: String(port),
      NITRO_PORT: String(port),
      HOST: '127.0.0.1',
      NITRO_HOST: '127.0.0.1',
      NUXT_STORAGE_PROVIDER: 's3',
      NUXT_STORAGE_DATA_REGION: 'test',
      NUXT_STORAGE_PUBLIC_BASE_URL: `${endpoint}/${buckets.public}`,
      NUXT_STORAGE_BUCKETS_UPLOADS: buckets.uploads,
      NUXT_STORAGE_BUCKETS_PRIVATE: buckets.private,
      NUXT_STORAGE_BUCKETS_PUBLIC: buckets.public,
      NUXT_STORAGE_BUCKETS_BACKUP: buckets.backup,
      NUXT_STORAGE_S3_ENDPOINT: endpoint,
      NUXT_STORAGE_S3_REGION: 'us-east-1',
      NUXT_STORAGE_S3_FORCE_PATH_STYLE: 'true',
      NUXT_STORAGE_SECRETS_ACCESS_KEY_ID: accessKeyId,
      NUXT_STORAGE_SECRETS_SECRET_ACCESS_KEY: secretAccessKey,
    },
  })
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fetch(base)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error('the minimal host did not start')
}, 90_000)

afterAll(() => {
  server?.kill()
})

it('composes storage and round-trips an object through the minimal host', async () => {
  const res = await fetch(`${base}/api/smoke`)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})
