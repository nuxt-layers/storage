// Configures storage from runtime configuration when the server starts.
import { configureFromRuntimeConfig, type StorageRuntimeConfig } from '../registry'

export default defineNitroPlugin(() => {
  configureFromRuntimeConfig(useRuntimeConfig().storage as StorageRuntimeConfig)
})
