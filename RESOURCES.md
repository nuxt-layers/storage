# Resources

> **In short:** every external architectural document this layer relies on, at the revision reviewed.

| Document | Revision | Why |
|---|---|---|
| [ADR-0002 Composition-supplied persistence](https://github.com/nuxt-layers/architecture-rules/blob/fdf9e5f8f4a2163c14a50ebd37b29d49d9e640d4/docs/decisions/ADR-0002-composition-supplied-persistence-and-capability-owned-schemas.md) | `fdf9e5f` | Host supplies the client; fail closed; fakes only in tests; no provider SDK types in the contract |
| [ADR-0006 Polyglot persistence and data-store security](https://github.com/nuxt-layers/architecture-rules/blob/fdf9e5f8f4a2163c14a50ebd37b29d49d9e640d4/docs/decisions/ADR-0006-polyglot-persistence-and-data-store-security.md) | `fdf9e5f` | Object stores behind ports; one system of record; tenant isolation; data region |
| [ADR-0010 Documentation style](https://github.com/nuxt-layers/architecture-rules/blob/fdf9e5f8f4a2163c14a50ebd37b29d49d9e640d4/docs/decisions/ADR-0010-documentation-style.md) | `fdf9e5f` | Which files exist and what each holds |
| [ADR-0012 Trivial composition](https://github.com/nuxt-layers/architecture-rules/blob/fdf9e5f8f4a2163c14a50ebd37b29d49d9e640d4/docs/decisions/ADR-0012-trivial-composition.md) | `fdf9e5f` | Shared shapes (`resolveCaller`, `decide`, `tasks`, `now()`), 50-line budget, `CONTRACT.md` |
| [ADR-0014 Hosting and storage providers](https://github.com/nuxt-layers/architecture-rules/blob/fdf9e5f8f4a2163c14a50ebd37b29d49d9e640d4/docs/decisions/ADR-0014-hosting-and-storage-providers.md) | `fdf9e5f` | Providers outside the UK, as Hetzner in Germany is |
| [Security §16 Data stores](https://github.com/nuxt-layers/architecture-rules/blob/fdf9e5f8f4a2163c14a50ebd37b29d49d9e640d4/docs/security.md) | `fdf9e5f` | Credentials, isolation, signed URLs, erasure and data region |
| [Layer standard](https://github.com/nuxt-layers/architecture-rules/blob/fdf9e5f8f4a2163c14a50ebd37b29d49d9e640d4/docs/layer-standard.md) | `fdf9e5f` | Repository layout, manifest and tests |
| [Catalogue](https://github.com/nuxt-layers/architecture-rules/blob/fdf9e5f8f4a2163c14a50ebd37b29d49d9e640d4/docs/catalogue.md) | `fdf9e5f` | Storage's place among the capabilities |
| [clock contract](https://github.com/nuxt-layers/clock/blob/b504dee074a1c1cca9fc29db41a3e089585d78b0/CONTRACT.md) | `b504dee` | Its `now()` port returns an ISO 8601 UTC string, which storage accepts as well as a `Date` |
| [media design](https://github.com/nuxt-layers/media/blob/1f35b23601edf3ecdd637d923627a31a5397c376/docs/design.md) | `1f35b23` | The first consumer, whose storage port this layer fills |
