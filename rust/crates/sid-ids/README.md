# sid-ids

StructuredID validated identifiers: one type per identifier kind
(`ProfileId`, `DeviceId`, `SessionId`, `MachineUserId`, `BindingId`, `OrgId`,
`IssuerId`, `ApplicationId`, `ResourceId`, `PasswordOperationId`,
`ProvisioningConnectorId`, `ProvisioningCredentialId`), each an
RFC 9562 UUIDv7. A value of one kind never converts to another, whatever its
bytes; every way in (bytes, text, serde, database) runs the same validation:
exactly 16 bytes, not nil or max, the RFC 9562 variant, version 7.

The types carry no meaning beyond their shape: holding a `BindingId` proves
nothing about who it belongs to or what it may do.

## Use

```toml
[dependencies]
sid-ids = "0.1"
```

```rust
let id = sid_ids::BindingId::parse("019290a4-7b3c-7d2e-8f00-112233445566").unwrap();
assert_eq!(id.to_string(), "019290a4-7b3c-7d2e-8f00-112233445566");

// The same bytes as another kind are another type.
let machine = sid_ids::MachineUserId::from_bytes(*id.as_bytes()).unwrap();
assert_eq!(machine.as_bytes(), id.as_bytes());

// Nil, wrong version and wrong length are refused, naming the cause.
let err = sid_ids::BindingId::from_slice(&[0; 16]).unwrap_err();
assert_eq!(err.cause(), sid_ids::IdErrorCause::Nil);
assert!(sid_ids::BindingId::parse("019290a4-7b3c-4d2e-8f00-112233445566").is_err());
assert!(sid_ids::BindingId::from_slice(&[1; 15]).is_err());
```

The binary wire messages and their checked conversions are in
[`sid-ids-proto`](https://crates.io/crates/sid-ids-proto).

## Features

| Feature         | Default | What it adds |
|-----------------|---------|--------------|
| `std`           | yes     | `generate()` (system clock and random source); implies `alloc` |
| `alloc`         | via std | `TryFrom<String>`; the minimum for a `no_std` consumer |
| `serde`         | yes     | (De)serialization as the plain UUID string, validated on read |
| `sqlx-postgres` | no      | Encode/decode as PostgreSQL `uuid`, validated on read |
| `sqlx-sqlite`   | no      | Encode/decode as SQLite text, validated on read |

`--no-default-features --features alloc` builds for `no_std` targets; CI
builds it for `thumbv7em-none-eabihf`.

## Verify

From the `rust/` directory of the SDK repository (the SQL tests need the
PostgreSQL named in `tests/sqlx_decode.rs`):

```sh
cargo nextest run -p sid-ids --all-features
ci/check-isolation.sh packages
```

## License

Apache License, version 2.0. See `LICENSE` and `NOTICE`.
