// A host that composes storage and nothing else. Settings and secrets come
// from NUXT_STORAGE_* environment variables, set by the host's secret management.
export default defineNuxtConfig({
  extends: ['../..'],
})
