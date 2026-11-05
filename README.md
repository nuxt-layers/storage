# @nuxt-layers/storage

> **In short:** a Platform capability that saves and retrieves files (documents and images) in a backend object store, agnostic to the provider. It keeps only bytes and object metadata; the capability using it, such as media, keeps each item's record.

- [Design](docs/design.md): what the layer does and why.
- [Discussion](docs/discussion.md): the questions agreed with the owner.
- [Plan](PLAN.md), [Resources](RESOURCES.md) and [Changelog](CHANGELOG.md).

Hosts will compose it from `CONTRACT.md` alone, once written.

To run every check CI runs, on your own machine (Node.js, Docker and `openssl` needed): `scripts/local-check.sh` (on Windows, from Git Bash with Docker Desktop running). It checks the branch you are on. Add `--commit-lockfile` to commit and push a changed lockfile.
