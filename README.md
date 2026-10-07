# StructuredID SDK

Client packages for applications that talk to StructuredID, one workspace per
language. Each package is versioned, released and installed on its own:
installing one does not install the rest.

| Package | Language | Registry | What it is |
|---------|----------|----------|------------|
| [`sid-ids`](rust/crates/sid-ids) | Rust | crates.io | Validated identifier types, `no_std` with `alloc` |
| [`sid-ids-proto`](rust/crates/sid-ids-proto) | Rust | crates.io | The `sid.v1.ids` wire messages and checked conversions to `sid-ids` |
| [`@structured-id/ids`](typescript/packages/ids) | TypeScript | npm | Checked identifier types, the `sid.v1.ids` wire messages and conversions |

## Schema and corpus

The protobuf definitions live in [structured-id/proto](https://github.com/structured-id/proto),
pinned here as the `proto` submodule. The identifier corpus
(`sid/v1/ids/ids.corpus.json`) beside the schema is the language-neutral
contract every identifier implementation runs: both languages are tested
against the same pinned revision. Published packages carry the schema they
were built from; installing them needs no checkout.

```sh
git clone --recurse-submodules https://github.com/structured-id/sdk.git
```

## Develop

```sh
cd rust && cargo nextest run --workspace       # Rust packages
cd typescript && yarn install && yarn test     # TypeScript packages
```

Releases are automated from conventional commits: Rust packages through
release-plz (tags `rust-<crate>-v<version>`), TypeScript packages through
release-please (tags `typescript-<package>-v<version>`).

## License

Apache License, version 2.0. See [LICENSE](LICENSE) and each package's NOTICE.
