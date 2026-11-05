// The provider port: what one adapter implements for one provider.
// Bucket-level and key-level only; tenant checks, key rules and signing
// limits live in the service, never in an adapter.

export type BucketRole = 'uploads' | 'private' | 'public' | 'backup'

export type Body = Uint8Array | ReadableStream<Uint8Array>

export interface ObjectMeta {
  contentType: string
  size: number
  /** Lowercase hexadecimal SHA-256 of the bytes. */
  sha256: string
  createdAt: Date
}

export interface StoredObject {
  meta: ObjectMeta
  body: ReadableStream<Uint8Array>
}

export interface ListedObject {
  key: string
  size: number
  createdAt: Date
}

export interface PortListPage {
  objects: ListedObject[]
  next: string | null
}

export interface SignedRequest {
  url: string
  method: 'PUT' | 'GET'
  headers: Record<string, string>
}

export interface CompletedPart {
  partNumber: number
  etag: string
}

export interface ObjectStorePort {
  readonly kind: 's3' | 'filesystem' | 'memory'
  put(bucket: BucketRole, key: string, body: Body, meta: Omit<ObjectMeta, 'createdAt'>): Promise<void>
  get(bucket: BucketRole, key: string): Promise<StoredObject | null>
  head(bucket: BucketRole, key: string): Promise<ObjectMeta | null>
  /** Succeeds when the object is already absent. */
  remove(bucket: BucketRole, key: string): Promise<void>
  list(bucket: BucketRole, prefix: string, page: { after?: string; limit: number }): Promise<PortListPage>
  copy(from: { bucket: BucketRole; key: string }, to: { bucket: BucketRole; key: string }): Promise<void>
  signPut(bucket: BucketRole, key: string, input: { contentType: string; size: number; sha256: string; expiresInSeconds: number }): Promise<SignedRequest>
  signGet(bucket: BucketRole, key: string, input: { expiresInSeconds: number; filename?: string }): Promise<SignedRequest>
  multipartStart(bucket: BucketRole, key: string, meta: Omit<ObjectMeta, 'createdAt'>): Promise<{ uploadId: string }>
  multipartSignPart(bucket: BucketRole, key: string, input: { uploadId: string; partNumber: number; expiresInSeconds: number }): Promise<SignedRequest>
  multipartComplete(bucket: BucketRole, key: string, input: { uploadId: string; parts: CompletedPart[] }): Promise<void>
  multipartAbort(bucket: BucketRole, key: string, input: { uploadId: string }): Promise<void>
}
