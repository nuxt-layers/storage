# Storage: Design

> **In short:** storage saves and retrieves files in an object store behind one provider-agnostic port. It keeps only bytes and object metadata, never records: the consumer, such as media, keeps each item's record and decides who may do what. Keys always carry the tenant and owning group, signed addresses last at most 15 minutes, and every object has a content type and a SHA-256 checksum. Version 1 ships an S3-compatible adapter (Hetzner first, SeaweedFS in tests), a filesystem adapter for development and an in-memory fake for tests. Agreed in the [discussion](discussion.md); nothing is built yet. External documents named here are listed in [Resources](../RESOURCES.md).

## What it is for

media's design needs a bucket for its images, and later capabilities will need one for documents. Storage gives every such consumer the same object operations, isolation and erasure rules, so no consumer handles a provider's SDK, keys or signing itself (ADR-0002, ADR-0006).

| Storage owns | Storage does not own |
|---|---|
| Object bytes, content type, size and checksum | Records about items (owner, uploader, alt text, status): the consumer's |
| Key generation, signed addresses, multipart uploads | Access decisions: the consumer calls `decide` first |
| Lifecycle rules, backups and usage figures | Allowances and quotas: the consumer enforces them |
| Provider adapters | Image processing, virus scanning or any reading of content |

It is a **Platform** capability with a headless core and no screens, no permissions of its own and no PostgreSQL schema.

## Decisions

| Decision | Means |
|---|---|
| One port, plug-in adapters | Consumers call storage's functions in the domain's language; an adapter implements the port for one provider, chosen by host configuration. No provider SDK type crosses the contract |
| Keys made by storage | Every key is `{tenantId}/{groupId}/{consumer}/{objectId}`, with a UUIDv7 `objectId`. Consumers never supply key text and people's names never appear. `consumer` is the calling capability's fixed name, such as `media` |
| Objects are immutable | A key is written once. A new version is a new object at a new key, which makes public addresses cacheable forever and erasure a matter of deleting keys |
| Tenant checked on every call | Each call carries the server-resolved caller and a scope `{ tenantId, groupId }`. Storage refuses `tenant-mismatch` unless the scope's tenant is the caller's |
| Authorised before signing | Signed addresses are issued only with an `allowed` decision from the shared `decide` shape, which the consumer obtained for that object and operation; anything else is `not-authorised` (Security §16.3) |
| Content type and checksum | Every write states a content type from the consumer's allow-list and a SHA-256 checksum. Storage verifies the checksum on every write and on every claimed upload; a mismatch is `checksum-mismatch` and nothing is kept |
| Public and private | Both in version 1. Private objects are served only through the site after the consumer's access check, or by a signed download address. Public objects sit in a public-read bucket at `publicBaseUrl/{key}` with `Cache-Control: public, max-age=31536000, immutable` |
| Fail closed | Without its configuration storage refuses every call with `not-configured`. The filesystem adapter is refused in production and the fake outside tests, with `adapter-refused` (ADR-0002) |
| Clock | Expiry and timestamps use ADR-0012's `now()`, defaulting to the system clock |

## Operations

All are server-side functions; none is reachable from the browser except through a signed address.

| Function | Does |
|---|---|
| `put(scope, { visibility, contentType, sha256, size, body })` | Streams bytes in and returns `{ key }` |
| `get(scope, key)` | Returns a stream with content type, size and checksum |
| `head(scope, key)` | Returns content type, size, checksum and creation time, or `not-found` |
| `remove(scope, key)` | Deletes the object; succeeds if it is already gone |
| `list(scope, { after, limit })` | Lists keys under the scope, a page at a time |
| `copy(scope, key, { visibility })` | Copies to a new key, for example from private to public |
| `signUpload(scope, decision, { visibility, contentType, sha256, size })` | Returns `{ key, url, headers, expiresAt }` for one PUT into the upload bucket |
| `claim(scope, key)` | Verifies a finished upload's size and checksum, moves it to its private or public bucket and returns the final key |
| `signDownload(scope, decision, key, { filename })` | Returns `{ url, expiresAt }` for one GET of a private object |
| `multipart.start`, `multipart.signPart`, `multipart.complete`, `multipart.abort` | Large uploads, server-side or by signed per-part addresses, ending in `claim` |
| `publicUrl(key)` | The public address of a public object |
| `usage(scope)` | Bytes and object count under a tenant or group |

Signed addresses expire within the lesser of 15 minutes and the configured period, default 5 minutes, and name one object and one operation.

## Buckets and isolation

Each environment has its own buckets, credentials and, on Hetzner, its own project, because Hetzner keys reach every bucket in a project:

| Bucket | Holds | Rules |
|---|---|---|
| Uploads | Direct uploads not yet claimed | Everything expires after 1 day; incomplete multipart uploads are aborted after 1 day |
| Private | Objects served only through the site | No public access |
| Public | Objects with public addresses | Public read; no listing |
| Backup | Nightly copies of private and public objects | No public access |

Tenant and group isolation rests on the key prefix and the tenant check, not on separate buckets. Credentials are limited to these buckets, and to prefixes where the provider supports it. A separate set of buckets is needed only for a tenant whose data region differs (below). Isolation tests show one tenant cannot read, list, sign or infer another's objects (Security §16.3).

## Erasure, retention and backups

- **Versioning is off,** so `remove` deletes the live copy at once.
- **Backups:** a nightly task copies new objects to the backup bucket. `remove` marks the backup copy, and the task deletes marked copies after 30 days, so erasure reaches every copy within 30 days.
- **Restores:** storage keeps no erasure log of its own. After a restore the consumer re-applies its erasure log, as media's design already requires.
- **Abandoned uploads** expire from the uploads bucket within a day.

## Usage

A scheduled task reports bytes and object count per tenant and group prefix, and bucket totals against the provider limits the host configures, logging a warning to operators at 70% and 90%. `usage(scope)` gives the same figures to consumers. Storage never refuses a write for allowance reasons: media enforces its allowances from its own records and reconciles with these figures.

## Data region

Each bucket set states its region. The consumer passes the tenant's data region in the scope, and storage refuses `region-not-honoured` when no configured bucket set is in that region, rather than storing elsewhere (ADR-0006 §7, Security §16.6). Providers outside the UK follow ADR-0014.

## Composition

| Host passes | Shape |
|---|---|
| Provider settings | `provider` (`s3`, `filesystem` or `memory`), endpoint, region, bucket names, `publicBaseUrl`, limits |
| Secrets | Access key and secret from the host's secret management through runtime configuration, never committed or public; rotatable without a release. Administrative credentials for setting lifecycle rules are separate and used only by a set-up command |
| Caller and access | `resolveCaller` and a `decide` result, in ADR-0012's shapes |
| Scheduled work | Storage returns `tasks` (backup, usage) for the host's scheduler |
| Clock | `now()`, optional |

The filesystem adapter signs local addresses with a host-supplied secret and serves them from a development-only route. TLS with certificate verification is required outside a single trusted host (Security §16.2).

## Errors

`not-configured`, `adapter-refused`, `tenant-mismatch`, `not-authorised`, `validation-failed`, `checksum-mismatch`, `not-found`, `already-exists`, `expired`, `region-not-honoured` and `provider-unavailable`, each with a `messageKey`.

## Store inventory

| Field | Value |
|---|---|
| Kind | Object |
| Port | Storage's adapter, chosen by `provider`; the host supplies settings and secrets |
| Holds | Bytes and object metadata; system of record for bytes, never for item records |
| Classification | Whatever the consumer stores; storage reads no content and logs keys only |
| Isolation | Tenant and group in every key; tenant checked against the caller on every call |
| Erasure | Live copy at once; backups within 30 days |
| Rebuild | Not a derived copy |

## Where the files go for Westray-Papa-Westray

Hetzner Object Storage, through the S3-compatible adapter, in Germany (Falkenstein or Nuremberg) under ADR-0014. The site records the provider, region, assurance evidence and date checked in its own `RESOURCES.md`. Tests and CI use a disposable SeaweedFS S3 server, never a shared hosted bucket. MinIO was the first choice, but its community images are no longer published.

## Not in version 1

Non-S3 providers, moving objects between providers, application-managed encryption keys, object versioning, retention locks and content scanning.

## Order of work

See [Plan](../PLAN.md).
