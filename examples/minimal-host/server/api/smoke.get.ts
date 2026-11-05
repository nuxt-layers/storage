// Smoke test: round-trips one object through the composed layer.
// A real host imports from '@nuxt-layers/storage/server'.
import { createHash } from 'node:crypto'
import { storageFor } from '../../../../server/registry'

export default defineEventHandler(async () => {
  const storage = storageFor('example')
  const caller = { tenantId: 'smoke', subjectId: null, assurance: 'none' }
  const scope = { caller, tenantId: 'smoke', groupId: 'smoke', dataRegion: useRuntimeConfig().storage.dataRegion }
  const body = new TextEncoder().encode('smoke')
  const sha256 = createHash('sha256').update(body).digest('hex')
  const { key } = await storage.put(scope, { visibility: 'private', contentType: 'text/plain', sha256, size: body.byteLength, body })
  const text = await new Response((await storage.get(scope, key)).body).text()
  await storage.remove(scope, key)
  return { ok: text === 'smoke' }
})
