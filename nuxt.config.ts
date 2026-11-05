// The storage layer: a headless Platform capability with no screens.
// Hosts set these through environment variables (NUXT_STORAGE_...), with
// secrets from their secret management; nothing here is a secret.
export default defineNuxtConfig({
  runtimeConfig: {
    storage: {
      provider: '',
      dataRegion: '',
      buckets: { uploads: '', private: '', public: '', backup: '' },
      publicBaseUrl: '',
      signedUrlSeconds: 300,
      limits: { bytes: 0, objects: 0 },
      s3: { endpoint: '', region: '', forcePathStyle: false },
      filesystem: { root: '', baseUrl: '' },
      secrets: { accessKeyId: '', secretAccessKey: '', signingSecret: '' },
    },
  },
})
