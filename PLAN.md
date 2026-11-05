# Plan

> **In short:** what is done, in progress and next for the storage layer.

| Item | Status |
|---|---|
| Discussion agreed with the owner | Done |
| Design, and the catalogue and media design changes | Done |
| Verify Hetzner Object Storage against the design: presigned URLs, multipart, lifecycle rules, bucket policies and key scope, at-rest encryption; record the revision in `RESOURCES.md` | Next |
| Contract and port shapes | Done |
| S3-compatible adapter, tested against MinIO in CI | In review |
| Filesystem adapter and fakes | Next |
| `examples/minimal-host`, `capability.json` and `STORAGE-REGISTER.md` | Next |
| `CONTRACT.md` and a tagged release | Next |
| Composing into media and Westray-Papa-Westray | Later, separate work |
