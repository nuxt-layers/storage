// Answers the filesystem adapter's signed addresses in development; 404 otherwise.
import { localAdapter } from '../../registry'

export default defineEventHandler(async (event) => {
  const adapter = localAdapter()
  if (!adapter) {
    setResponseStatus(event, 404)
    return ''
  }
  return adapter.handle(toWebRequest(event))
})
