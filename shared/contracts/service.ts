// The consumer-facing service: what media and other capabilities call.
import type { Caller, Clock, Decision, Task } from './shapes'
import type { Body, CompletedPart, ObjectMeta, SignedRequest } from './port'

export type Visibility = 'private' | 'public'

/** Who is asking, and for which tenant and owning group. */
export interface StorageScope {
  caller: Caller
  tenantId: string
  groupId: string
  /** The tenant's data region, as the tenant states it. */
  dataRegion: string
}

export interface PutInput {
  visibility: Visibility
  contentType: string
  sha256: string
  size: number
  body: Body
}

export interface ObjectInfo extends ObjectMeta {
  key: string
  visibility: Visibility
}

export interface UploadInput {
  visibility: Visibility
  contentType: string
  sha256: string
  size: number
}

export interface SignedUpload extends SignedRequest {
  key: string
  expiresAt: Date
}

export interface SignedDownload {
  url: string
  expiresAt: Date
}

export interface ListPage {
  keys: string[]
  next: string | null
}

export interface Usage {
  bytes: number
  objects: number
}

export interface StorageService {
  put(scope: StorageScope, input: PutInput): Promise<{ key: string }>
  get(scope: StorageScope, key: string): Promise<{ info: ObjectInfo; body: ReadableStream<Uint8Array> }>
  head(scope: StorageScope, key: string): Promise<ObjectInfo>
  remove(scope: StorageScope, key: string): Promise<void>
  list(scope: StorageScope, page?: { after?: string; limit?: number }): Promise<ListPage>
  copy(scope: StorageScope, key: string, to: { visibility: Visibility }): Promise<{ key: string }>
  signUpload(scope: StorageScope, decision: Decision, input: UploadInput): Promise<SignedUpload>
  claim(scope: StorageScope, key: string): Promise<{ key: string }>
  signDownload(scope: StorageScope, decision: Decision, key: string, options?: { filename?: string }): Promise<SignedDownload>
  multipart: {
    start(scope: StorageScope, decision: Decision, input: UploadInput): Promise<{ key: string; uploadId: string }>
    signPart(scope: StorageScope, decision: Decision, key: string, input: { uploadId: string; partNumber: number }): Promise<SignedUpload>
    complete(scope: StorageScope, key: string, input: { uploadId: string; parts: CompletedPart[] }): Promise<{ key: string }>
    abort(scope: StorageScope, key: string, input: { uploadId: string }): Promise<void>
  }
  publicUrl(key: string): string
  usage(scope: Omit<StorageScope, 'groupId'> & { groupId?: string }): Promise<Usage>
  /** Backup and usage tasks for the host's scheduler. */
  tasks: Task[]
}

export interface StorageSettings {
  provider: 's3' | 'filesystem' | 'memory'
  /** The data region this bucket set is in, for example `de`. */
  dataRegion: string
  buckets: { uploads: string; private: string; public: string; backup: string }
  publicBaseUrl: string
  /** Lifetime of signed addresses; default 300, at most 900. */
  signedUrlSeconds?: number
  limits?: { bytes?: number; objects?: number }
  s3?: { endpoint: string; region: string; forcePathStyle?: boolean }
  filesystem?: { root: string; baseUrl: string }
}

export interface StorageSecrets {
  accessKeyId?: string
  secretAccessKey?: string
  /** Signs the filesystem adapter's local addresses. */
  signingSecret?: string
}

export interface StorageOptions {
  /** The calling capability's fixed name, such as `media`. */
  consumer: string
  settings: StorageSettings
  secrets: StorageSecrets
  now?: Clock
}
