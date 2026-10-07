# @structured-id/ids

StructuredID identifiers for TypeScript: one class per identifier kind
(`BindingId`, `MachineUserId`, `PasswordOperationId`,
`ProvisioningConnectorId`, `ProvisioningCredentialId`, `ResourceId`), the
`sid.v1.ids` wire messages and checked conversions between them.

Each identifier is exactly 16 bytes of an RFC 9562 UUIDv7 in network byte
order. A value of one of these classes is always valid: it is built only
through validation, which refuses other lengths, the nil and max UUIDs, other
variants and other versions, naming the reason. Values of different kinds are
different types, even with equal bytes. A valid identifier proves only its
shape, not whom it belongs to or what it may do.

## Use

```sh
npm install @structured-id/ids
```

```ts
import { BindingId, IdError, required, optional, wire } from "@structured-id/ids";

// Wire to domain: a decoded message is an untrusted DTO until converted.
const message = wire.BindingId.fromBinary(bytes);
const id = required(BindingId, message); // throws MissingIdError or IdError

// An optional field keeps absence apart from an invalid value.
const maybe = optional(BindingId, undefined); // undefined

// Domain to wire: the same 16 bytes.
const encoded = wire.BindingId.toBinary(id.toWire());

// Text is for display; the wire carries bytes.
console.log(id.toString()); // 019290a4-7b3c-7d2e-8f00-112233445566
BindingId.parse("019290a4-7b3c-7d2e-8f00-112233445566");
```

`wire` holds the generated messages with their binary and standard ProtoJSON
codecs (`toJson` / `fromJson`): `bytes` are base64 there, as the ProtoJSON
mapping defines.

Messages of your own that carry an identifier import
`@structured-id/ids/schema/sid/v1/ids/ids.proto` (`PROTO_PATH` under an
include root) and use this package's `wire` types for those fields instead of
generating a second copy.

## Corpus

`sid/v1/ids/ids.corpus.json` in the
[proto definitions](https://github.com/structured-id/proto) holds every case
of the identifier contract for each kind. This package's tests run that file
unchanged, as the Rust crates `sid-ids` and `sid-ids-proto` do.

## Verify

From the `typescript/` directory of the SDK repository, with its `proto`
submodule checked out:

```sh
yarn install
yarn test
ci/check-package.sh
```

## License

Apache License, version 2.0. See `LICENSE` and `NOTICE`.
