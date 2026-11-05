// S3-compatible adapter (Hetzner Object Storage first; MinIO in tests).
// The AWS SDK stays inside this file: no SDK type crosses the port.
import { Readable } from 'node:stream'
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { StorageError } from '../../shared/contracts/errors'
import type { BucketRole, Body, ObjectMeta, ObjectStorePort, SignedRequest } from '../../shared/contracts/port'
import type { StorageSecrets, StorageSettings } from '../../shared/contracts/service'

const localHosts = new Set(['localhost', '127.0.0.1', '::1'])

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404
}

function providerError(error: unknown): never {
  if (error instanceof StorageError) throw error
  throw new StorageError('provider-unavailable', (error as Error)?.name ?? 'unknown')
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    providerError(error)
  }
}

function toNodeBody(body: Body): Uint8Array | Readable {
  return body instanceof Uint8Array ? body : Readable.fromWeb(body as never)
}

export function createS3Adapter(settings: StorageSettings, secrets: StorageSecrets): ObjectStorePort {
  const s3 = settings.s3
  if (!s3?.endpoint || !s3.region || !secrets.accessKeyId || !secrets.secretAccessKey) {
    throw new StorageError('not-configured', 's3 endpoint, region and credentials are required')
  }
  const endpoint = new URL(s3.endpoint)
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && localHosts.has(endpoint.hostname))) {
    throw new StorageError('not-configured', 's3 endpoint must use TLS outside localhost')
  }
  const buckets = settings.buckets
  const name = (role: BucketRole) => buckets[role]
  const client = new S3Client({
    endpoint: s3.endpoint,
    region: s3.region,
    forcePathStyle: s3.forcePathStyle ?? false,
    credentials: { accessKeyId: secrets.accessKeyId, secretAccessKey: secrets.secretAccessKey },
  })

  const sign = async (command: Parameters<typeof getSignedUrl>[1], expiresIn: number, method: SignedRequest['method'], headers: Record<string, string>, signable?: Set<string>): Promise<SignedRequest> => ({
    url: await call(() => getSignedUrl(client, command, { expiresIn, signableHeaders: signable })),
    method,
    headers,
  })

  return {
    kind: 's3',

    async put(bucket, key, body, meta) {
      await call(() =>
        client.send(new PutObjectCommand({
          Bucket: name(bucket),
          Key: key,
          Body: toNodeBody(body),
          ContentType: meta.contentType,
          ContentLength: meta.size,
          Metadata: { sha256: meta.sha256 },
        })),
      )
    },

    async get(bucket, key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: name(bucket), Key: key }))
        if (!out.Body) return null
        return {
          meta: {
            contentType: out.ContentType ?? 'application/octet-stream',
            size: out.ContentLength ?? 0,
            sha256: out.Metadata?.sha256 ?? '',
            createdAt: out.LastModified ?? new Date(0),
          },
          body: out.Body.transformToWebStream() as ReadableStream<Uint8Array>,
        }
      } catch (error) {
        if (isNotFound(error)) return null
        providerError(error)
      }
    },

    async head(bucket, key): Promise<ObjectMeta | null> {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: name(bucket), Key: key }))
        return {
          contentType: out.ContentType ?? 'application/octet-stream',
          size: out.ContentLength ?? 0,
          sha256: out.Metadata?.sha256 ?? '',
          createdAt: out.LastModified ?? new Date(0),
        }
      } catch (error) {
        if (isNotFound(error)) return null
        providerError(error)
      }
    },

    async remove(bucket, key) {
      await call(() => client.send(new DeleteObjectCommand({ Bucket: name(bucket), Key: key })))
    },

    async list(bucket, prefix, page) {
      const out = await call(() =>
        client.send(new ListObjectsV2Command({ Bucket: name(bucket), Prefix: prefix, StartAfter: page.after, MaxKeys: page.limit })),
      )
      const objects = (out.Contents ?? []).map((o) => ({ key: o.Key!, size: o.Size ?? 0, createdAt: o.LastModified ?? new Date(0) }))
      return { objects, next: out.IsTruncated && objects.length ? objects[objects.length - 1]!.key : null }
    },

    async copy(from, to) {
      await call(() =>
        client.send(new CopyObjectCommand({
          Bucket: name(to.bucket),
          Key: to.key,
          CopySource: `${name(from.bucket)}/${from.key}`,
          MetadataDirective: 'COPY',
        })),
      )
    },

    signPut(bucket, key, input) {
      const command = new PutObjectCommand({
        Bucket: name(bucket),
        Key: key,
        ContentType: input.contentType,
        ContentLength: input.size,
        Metadata: { sha256: input.sha256 },
      })
      return sign(command, input.expiresInSeconds, 'PUT', { 'content-type': input.contentType }, new Set(['content-type', 'content-length']))
    },

    signGet(bucket, key, input) {
      const command = new GetObjectCommand({
        Bucket: name(bucket),
        Key: key,
        ResponseContentDisposition: input.filename ? `attachment; filename*=UTF-8''${encodeURIComponent(input.filename)}` : undefined,
      })
      return sign(command, input.expiresInSeconds, 'GET', {})
    },

    async multipartStart(bucket, key, meta) {
      const out = await call(() =>
        client.send(new CreateMultipartUploadCommand({
          Bucket: name(bucket),
          Key: key,
          ContentType: meta.contentType,
          Metadata: { sha256: meta.sha256 },
        })),
      )
      if (!out.UploadId) throw new StorageError('provider-unavailable', 'no upload id')
      return { uploadId: out.UploadId }
    },

    multipartSignPart(bucket, key, input) {
      const command = new UploadPartCommand({ Bucket: name(bucket), Key: key, UploadId: input.uploadId, PartNumber: input.partNumber })
      return sign(command, input.expiresInSeconds, 'PUT', {})
    },

    async multipartComplete(bucket, key, input) {
      await call(() =>
        client.send(new CompleteMultipartUploadCommand({
          Bucket: name(bucket),
          Key: key,
          UploadId: input.uploadId,
          MultipartUpload: { Parts: input.parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
        })),
      )
    },

    async multipartAbort(bucket, key, input) {
      await call(() => client.send(new AbortMultipartUploadCommand({ Bucket: name(bucket), Key: key, UploadId: input.uploadId })))
    },
  }
}
