# Plan

> **In short:** what is done, in progress and next for the storage layer.

| Item | Status |
|---|---|
| Discussion agreed with the owner | Done |
| Design, and the catalogue and media design changes | Done |
| Verify Hetzner Object Storage against the design: presigned URLs, multipart, lifecycle rules, bucket policies and key scope, at-rest encryption; record the revision in `RESOURCES.md` | Next |
| Contract and port shapes | Done |
| S3-compatible adapter, tested against SeaweedFS in CI | Done |
| Service, filesystem adapter and fakes | In review |
| `examples/minimal-host`, `capability.json` and `STORAGE-REGISTER.md` | Next |
| `CONTRACT.md`, marked in development and following `master`; no tag until a release lifecycle is approved (layer standard §7) | Next |
| Composing into media and Westray-Papa-Westray | Later, separate work |
