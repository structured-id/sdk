# sid-ids-proto

StructuredID identifier messages (`sid.v1.ids`) and their checked conversions
to the validated [`sid-ids`](https://crates.io/crates/sid-ids) types.

Each identifier kind is its own message (`BindingId`, `MachineUserId`,
`PasswordOperationId`, `ProvisioningConnectorId`, `ProvisioningCredentialId`,
`ResourceId`), carrying exactly 16 bytes of an RFC 9562 UUIDv7 in
network byte order. A decoded message is an untrusted DTO: converting it to
the domain type validates the bytes (length, nil, max, variant, version), and
a required message that is absent is an error, never a default. A
`BindingId` and a `MachineUserId` with the same bytes stay different types;
there is no conversion between them. Parsing proves nothing about who the
identifier belongs to or what it may do.

## Use

```toml
[dependencies]
sid-ids = "0.1"
sid-ids-proto = "0.1"
prost = "0.14"
```

```rust
use prost::Message;

// 019290a4-7b3c-7d2e-8f00-112233445566
let bytes = [
    0x01, 0x92, 0x90, 0xa4, 0x7b, 0x3c, 0x7d, 0x2e,
    0x8f, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66,
];
let wire = sid_ids_proto::BindingId { value: bytes.to_vec() };

// Wire to domain: validated, and a missing message is an error.
let id: sid_ids::BindingId = sid_ids_proto::required(Some(&wire)).unwrap();
assert!(sid_ids_proto::required::<sid_ids_proto::BindingId>(None).is_err());
assert!(sid_ids::BindingId::try_from(&sid_ids_proto::BindingId { value: vec![0; 16] }).is_err());

// Domain to wire: the same 16 bytes, field 1.
let encoded = sid_ids_proto::BindingId::from(id).encode_to_vec();
assert_eq!(encoded[..2], [0x0a, 0x10]);
```

Messages of your own that carry an identifier import the schema and map the
package to this crate, so one Rust type exists per identifier:

```rust,ignore
// build.rs
let mut config = prost_build::Config::new();
config.extern_path(".sid.v1.ids", "::sid_ids_proto::sid::v1::ids");
// Write sid_ids_proto::PROTO_SOURCE to <include>/sid/v1/ids/ids.proto
// (sid_ids_proto::PROTO_PATH) and add <include> to the include paths.
```

`FILE_DESCRIPTOR_SET` serves reflection-based standard ProtoJSON (for
example `prost-reflect`): `bytes` are standard base64, as the ProtoJSON
mapping defines; no UUID text rendering on the wire.

## Features

| Feature | Default | What it adds |
|---------|---------|--------------|
| `std`   | yes     | `std::error::Error` for the conversion error; enables `sid-ids/std` |

Without default features the crate is `no_std` with `alloc`; it is built for
`thumbv7em-none-eabihf` in CI. Generating code needs no `protoc`: the schema
is compiled by `protox` at build time from `schema/sid/v1/ids/ids.proto`,
which the crate carries.

## Corpus

`sid/v1/ids/ids.corpus.json` in the
[proto definitions](https://github.com/structured-id/proto) holds every case
of the identifier contract for each kind: the bytes, the binary message, the
standard ProtoJSON and the outcome of the checked conversion. This crate's
tests compute the corpus from the implementation and compare it with that
file; the TypeScript package `@structured-id/ids` runs the same file.

## Verify

From the `rust/` directory of the SDK repository, with its `proto` submodule
checked out:

```sh
cargo nextest run --workspace                 # unit tests and the corpus
ci/check-isolation.sh packages                # packaged, used from outside
```

## License

Apache License, version 2.0. See `LICENSE` and `NOTICE`.
