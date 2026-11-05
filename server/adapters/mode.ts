export type RuntimeMode = 'production' | 'development' | 'test'

/** Production unless NODE_ENV says development or test, so a missing value fails closed. */
export function runtimeMode(env: string | undefined = process.env.NODE_ENV): RuntimeMode {
  if (env === 'test') return 'test'
  if (env === 'development') return 'development'
  return 'production'
}
