# Storage: Discussion

> **In short:** the questions put to the owner, Steve, before designing the `storage` layer, with the recommended answer and his decision. All eleven recommendations were agreed on 5 November 2026. The design follows in `docs/design.md`.

| # | Question | Agreed answer |
|---|---|---|
| 1 | Kind of store | S3-compatible object storage is the baseline, Hetzner first. Every provider plugs in behind one provider-agnostic port chosen by host configuration. Local development is simulated: MinIO for S3 behaviour, a filesystem adapter for zero-setup development |
| 2 | What the layer is | A **Platform capability** with its own port, adapters, fakes, `CONTRACT.md` and minimal host. It owns no records and no PostgreSQL schema: media, or similar, keeps each item's record; storage keeps only bytes and object metadata |
| 3 | Operations in version 1 | All: put, get (stream), head, delete, list by prefix, copy; signed upload and download addresses (at most 15 minutes, one object, one operation, issued only after server-side authorisation); multipart upload, server-side and by signed per-part addresses; content type and SHA-256 checksum required on every object |
| 4 | Isolation | The layer generates every key as `{tenantId}/{groupId}/{consumer}/{objectId}` (UUIDv7), never from names people chose. **One bucket per environment**, with a separate bucket only where a tenant's data region differs. Credentials are scoped to the bucket or prefix where the provider allows; Hetzner keys are project-wide, so each environment has its own Hetzner project |
| 5 | Public and private objects | **Both in version 1.** Public objects in a public-read bucket at CDN-friendly, immutable addresses (a new key per version, so erasure gives a new address). Private objects only through the site after an access check, or by a signed address |
| 6 | Adapters in version 1 | S3-compatible (Hetzner first, tested against MinIO in CI, never a shared hosted bucket); a filesystem adapter for development, refused in production and signing local addresses with a host-supplied secret; an in-memory fake refused outside tests |
| 7 | Erasure, retention, backups | Versioning off, so deletion is immediate in the live bucket. Lifecycle rules abort incomplete multipart uploads and remove unclaimed uploads under a pending prefix after 1 day. Nightly backup copy to a second bucket in the same region, kept 30 days then aged out; the consumer's erasure log is re-applied after a restore |
| 8 | Costs and limits | Storage **reports**, the consumer **enforces**. A scheduled task reports bytes and object count per tenant and group prefix, and bucket totals against host-configured provider limits, warning operators at 70% and 90%. Storage never refuses a write for allowance reasons |
| 9 | Catalogue | Reverse the consolidation of `storage-service` into `media`: `storage` is listed as a Platform capability, and media uses it through its storage port. media's design is revised to drop its own storage mechanisms |
| 10 | Clock | A separate layer and chat; storage only takes ADR-0012's `now()`. Preferred name: **`clock`** |
| 11 | Data region (added) | Hetzner offers only Germany and Finland. Westray-Papa-Westray uses **Germany** (Falkenstein or Nuremberg) under ADR-0014, recorded in its `RESOURCES.md`. Storage refuses a tenant whose configured region its bucket cannot honour |

**Later change (5 November 2026):** MinIO no longer publishes community images, so local and CI tests of the S3-compatible adapter use a disposable SeaweedFS S3 server instead (questions 1 and 6), as the owner chose.
