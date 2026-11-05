# Storage: Contract

> **In short:** `@nuxt-layers/storage` keeps files' bytes in an object store behind one provider-agnostic port. A host composes it by extending the layer and setting environment variables; consumers such as media call `storageFor('<name>')` on the server. Storage keeps no records and decides no access: the consumer does both. **Status:** in development; consumers follow `master`, with no release tags.

## Install

```json
{ "dependencies": { "@nuxt-layers/storage": "github:nuxt-layers/storage" } }
```

```ts
// nuxt.config.ts: the whole of the host's code for storage
export default defineNuxtConfig({ extends: ['@nuxt-layers/storage'] })
```

The layer configures itself from runtime configuration when the server starts. Without `NUXT_STORAGE_PROVIDER` it stays unconfigured and every call fails with `not-configured`.

## Settings

All are environment variables. Secrets come only from the host's secret management, never from code or committed files.

| Variable | Default | Does |
|---|---|---|
| `NUXT_STORAGE_PROVIDER` | empty | `s3`, `filesystem` (development only) or `memory` (tests only) |
| `NUXT_STORAGE_DATA_REGION` | empty | The region these buckets are in, such as `de`; compared exactly with each scope's `dataRegion` |
| `NUXT_STORAGE_BUCKETS_UPLOADS`, `_PRIVATE`, `_PUBLIC`, `_BACKUP` | empty | The four bucket names (below); all required |
| `NUXT_STORAGE_PUBLIC_BASE_URL` | empty | Address public objects are served from; `publicUrl(key)` is this plus `/key` |
| `NUXT_STORAGE_SIGNED_URL_SECONDS` | `300` | Lifetime of signed addresses, capped at `900` |
| `NUXT_STORAGE_LIMITS_BYTES`, `_OBJECTS` | `0` (none) | Provider limits for usage warnings at 70% and 90% |
| `NUXT_STORAGE_S3_ENDPOINT`, `_REGION`, `_FORCE_PATH_STYLE` | empty, empty, `false` | S3-compatible endpoint (HTTPS, or HTTP on localhost only) |
| `NUXT_STORAGE_SECRETS_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY` | empty | **Secret.** Runtime S3 credentials, limited to the four buckets; rotatable without a release |
| `NUXT_STORAGE_FILESYSTEM_ROOT`, `_BASE_URL` | empty | Folder, and the site's `/storage-local` address (such as `http://localhost:3000/storage-local`), for the filesystem adapter |
| `NUXT_STORAGE_SECRETS_SIGNING_SECRET` | empty | **Secret.** At least 32 characters; signs the filesystem adapter's addresses |

## Host passes

Nothing in code. The host supplies settings and secrets as above, and:

- **Clock (optional):** ADR-0012's `now()`, returning a `Date` or an ISO 8601 UTC instant such as `2026-11-05T14:30:00.000Z`, so the clock layer's port fits unchanged. Defaults to the system clock; anything else fails with `validation-failed`.
- **Scheduled work:** gives `storageTasks()` (`tasks: { name, every, run }[]`, ADR-0012) to its one scheduler: `storage.backup` and `storage.usage`, each every `24h`.
- **Buckets:** creates the four buckets per environment, in one region, with versioning off, using administrative credentials kept out of the running site:

| Bucket | Rules |
|---|---|
| Uploads | Private. Objects expire after 1 day; incomplete multipart uploads abort after 1 day. CORS: `PUT` from the site's origin, headers `content-type` and `x-amz-meta-sha256`, exposing `ETag` |
| Private | Private. CORS `GET` from the site's origin only if screens fetch signed downloads with script |
| Public | Public read of objects, no listing; may sit behind a CDN |
| Backup | Private |

Consumers pass, on every call, a **scope**: `{ caller, tenantId, groupId, dataRegion }`, where `caller` is the shared `resolveCaller(event) → { tenantId, subjectId | null, assurance }` result, and, for signing, a **decision**: the shared `decide(caller, action, resource) → { allowed, reason }` result for that object and operation.

## Client and server functions

Server only. Import from `@nuxt-layers/storage/server`; types, `StorageError` and `isStorageError(error, code?)` from `@nuxt-layers/storage/contracts`.

| Function | Returns |
|---|---|
| `storageFor(consumer, { contentTypes? })` | The `StorageService` for one consumer; `contentTypes` is its allow-list |
| `storageTasks()` | The backup and usage tasks |
| `createMemoryAdapter()`, `configureStorage({ settings, secrets, adapter?, now? })` | The fake and direct configuration, for consumers' tests |

`StorageService`, with `upload = { visibility: 'private' | 'public', contentType, sha256, size }`:

| Function | Returns |
|---|---|
| `put(scope, { ...upload, body })` | `{ key }`; `body` is `Uint8Array` or `ReadableStream<Uint8Array>` |
| `get(scope, key)` | `{ info, body }`, `body` a stream; `info` is `{ key, visibility, contentType, size, sha256, createdAt }` |
| `head(scope, key)` | `info` |
| `remove(scope, key)` | Nothing; succeeds when already gone |
| `list(scope, { after?, limit? })` | `{ keys, next }`; `limit` 1 to 1000, default 100; pass `next` back as `after` |
| `copy(scope, key, { visibility })` | `{ key }` of a new object |
| `signUpload(scope, decision, upload)` | `{ key, url, method: 'PUT', headers, expiresAt }` |
| `claim(scope, key, { visibility })` | `{ key }`, once the upload's bytes match its checksum |
| `signDownload(scope, decision, key, { filename? })` | `{ url, expiresAt }`, private objects only |
| `multipart.start(scope, decision, upload)` | `{ key, uploadId }` |
| `multipart.signPart(scope, decision, key, { uploadId, partNumber })` | As `signUpload`; parts 1 to 10000, each at least 5 MB but the last |
| `multipart.complete(scope, key, { uploadId, parts: [{ partNumber, etag }] })` | `{ key }`; then `claim` |
| `multipart.abort(scope, key, { uploadId })` | Nothing |
| `publicUrl(key)` | The public address |
| `usage({ caller, tenantId, groupId?, dataRegion })` | `{ bytes, objects }` |

Errors are `StorageError` with `code` and `messageKey` `storage.errors.<code>`:

| Code | When |
|---|---|
| `not-configured` | Settings or secrets missing |
| `adapter-refused` | Filesystem adapter in production, or the fake outside tests |
| `tenant-mismatch` | The scope's tenant is not the caller's, or a key belongs to another tenant |
| `region-not-honoured` | The scope's `dataRegion` is not the buckets' region |
| `not-authorised` | The decision is not `allowed` |
| `validation-failed` | A malformed input, a content type outside the allow-list, or a bad cursor |
| `checksum-mismatch` | Bytes do not match `sha256` or `size`; nothing is kept |
| `not-found` | No such object in this scope |
| `provider-unavailable` | The provider failed; nothing is stored elsewhere |

`already-exists` and `expired` are reserved.

## Permissions

None of its own. The consumer decides with its own permissions before `signUpload`, `signDownload`, `multipart.start` and `multipart.signPart`, and passes that decision.

## Screens

None.

## Headless surface

A screen that uploads directly sends one `PUT` to `url` with exactly the returned `headers` and the exact bytes, before `expiresAt`. A refusal (`403`) means a changed body, header or an expired address: ask the consumer for a new address. The upload is not stored until the consumer calls `claim`.

## You will hit this

- **Keys:** `{tenantId}/{groupId}/{consumer}/{objectId}`, made by storage; never build or edit one. Store the whole key in your record.
- **Identifiers:** `tenantId` and `groupId` match `[A-Za-z0-9_-]{1,64}`; a consumer name matches `[a-z][a-z0-9-]{1,31}`; `sha256` is 64 lowercase hexadecimal characters.
- **Immutable objects:** there is no overwrite. `copy`, then `remove` the old key; a changed public file therefore has a new address, which suits CDN caching forever.
- **Another group's key** reads as `not-found`; another tenant's as `tenant-mismatch`.
- **Visibility is yours to remember:** storage keeps no record of it, so `claim` asks for it.
- **Erasure:** `remove` deletes the live copy at once; backup copies go within 30 days. After restoring from backup, re-apply your own erasure log.
- **Usage is a report, not a limit:** storage never refuses a write for allowance reasons.
- **Built sites are production:** a Nuxt build fixes `NODE_ENV` to `production`, so the filesystem adapter works only under `nuxt dev`; previews of a build use `s3`, with SeaweedFS or similar locally.
- **Hetzner keys reach every bucket in a project:** give each environment its own project.

## Stores

| Kind | Holds | Isolation | Erasure | Personal data |
|---|---|---|---|---|
| Object (four buckets) | Bytes and their metadata; system of record for bytes, never for item records | Tenant and group in every key; caller's tenant checked on every call | Live copy at once; backups within 30 days | Whatever consumers store; storage reads no content, and logs and keys hold opaque identifiers only |

No cookies or browser storage. The full register is `STORAGE-REGISTER.md`.
