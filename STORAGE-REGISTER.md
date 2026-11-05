# Storage Register

> **In short:** the storage this capability creates: objects in four buckets per environment, a development-only copy on disk, and nothing in browsers. Storage holds whatever bytes its consumers give it; each consumer registers what those bytes are. Implemented in code; not yet deployed to any host.

## Mechanisms

| Field | Buckets (uploads, private, public, backup) | Filesystem store | In-memory fake |
|---|---|---|---|
| Status | Implemented | Implemented | Implemented |
| Owner | storage | storage | storage |
| Purpose | Keep consumers' files: uploads awaiting a claim, private and public objects, and nightly backup copies | The same, on a developer's disk | The same, in memory, for tests |
| Data | Bytes, content type, size, SHA-256 checksum, creation time; key `{tenantId}/{groupId}/{consumer}/{objectId}`; backup removal markers | As for buckets, plus a metadata file per object | As for buckets |
| Personal data | Storage reads no content and keys hold opaque identifiers only. Bytes may be personal data (photos, documents): the consumer's register says which | As for buckets | Test data only |
| Technology | S3-compatible object storage (Hetzner Object Storage first) | Files under the configured root | Process memory |
| Scope and isolation | One set of buckets per environment; tenant and group in every key; caller's tenant checked on every call | One developer machine | One test process |
| Retention and deletion | Uploads expire after 1 day. Private and public objects until the consumer removes them; removal is immediate (versioning off). Backup copies end 30 days after removal | Until removed or the folder is deleted | Ends with the process |
| Access and security | Host-supplied credentials limited to these buckets; TLS; server-side only, except signed addresses (at most 15 minutes, one object, one operation, after authorisation); public bucket read-only to all | Refused in production; signed local addresses with a host-supplied secret | Refused outside tests |
| Essential | Yes: without it no consumer can keep files. When unavailable, calls fail with `provider-unavailable` and nothing is stored elsewhere | No: development only | No: tests only |
| Consent | Storing a file a person asked to upload is part of the service they requested; the consumer and host decide notices and any consent | Not applicable | Not applicable |

## Not used

No cookies, browser storage, caches or third-party storage.

## Unverified

- Hetzner Object Storage's at-rest encryption and its support for bucket policies and lifecycle rules, to be checked before any data is stored (see the plan).
