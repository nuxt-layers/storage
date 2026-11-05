# Changelog

> **In short:** major changes, newest first.

## 2026-11-05

- `now()` may return an ISO 8601 UTC instant as well as a `Date`, so the clock layer's port fits.
- `CONTRACT.md`: the consumer contract.
- Composition from runtime configuration, `examples/minimal-host` with its budget check and smoke test, `capability.json` and `STORAGE-REGISTER.md`.
- Service, filesystem adapter and in-memory fake; local check script.
- Integration tests use SeaweedFS instead of MinIO, whose community images are no longer published.
- Design written from the agreed discussion.
- Discussion with the owner agreed.
