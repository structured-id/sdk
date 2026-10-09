# @structured-id/proto

The public StructuredID `sid.v1` API for TypeScript: the messages and service
clients generated from the [proto definitions](https://github.com/structured-id/proto)
with [protobuf-ts](https://github.com/timostamm/protobuf-ts), the
`google.rpc` error model, and a browser transport that speaks gRPC-web and,
where the server offers it, WebTransport.

It carries no UI code and no framework dependency: a Vue, React or plain
TypeScript application, a worker or a Node script use the same modules.

## Use

```sh
npm install @structured-id/proto
```

Every schema file is its own module, under the path of the `.proto` file:

```ts
import { IdentityServiceClient } from "@structured-id/proto/sid/v1/identity/identity.client";
import { GetCurrentProfileRequest } from "@structured-id/proto/sid/v1/identity/identity";
import { Status } from "@structured-id/proto/google/rpc/status";
import { AdaptiveRpcTransport } from "@structured-id/proto/transport";

const transport = new AdaptiveRpcTransport({
  grpcWebUrl: "https://sid.example.com",
  // Optional: WebTransport (HTTP/3) with per-call fallback to gRPC-web.
  webTransportUrl: "https://sid.example.com:4433",
  // Send the session cookie of a backend-for-frontend.
  fetchInit: { credentials: "include" },
});
await transport.init();

const identity = new IdentityServiceClient(transport);
const { response } = await identity.getCurrentProfile(GetCurrentProfileRequest.create());
```

A refusal arrives as an `RpcError` whose `grpc-status-details-bin` metadata
holds a `google.rpc.Status`; decode it with `Status.fromBinary` and branch on
the `google.rpc.ErrorInfo` reason and domain in its details, never on the
message text.

### Transport

`AdaptiveRpcTransport` sends every unary call over WebTransport while the
connection is up. A locally observed connection or stream I/O failure retries
that call over gRPC-web and reconnects WebTransport in the background. Server
statuses, including `UNAVAILABLE`, `CANCELLED` and `UNKNOWN`, are returned as is:
a status code alone is not evidence of a failed connection. Malformed protobuf
responses report `DATA_LOSS`; local encoding errors report `INTERNAL`. Neither
triggers failover. A server error status rejects the call's headers, response,
status and trailers promises, preserving its metadata on `RpcError`.
Server streaming always goes over
gRPC-web. Without a `webTransportUrl`, or where the runtime has no
`WebTransport`, it is plain gRPC-web.

`RpcOptions.abort` cancels an active stream and prevents a fallback attempt for
that cancelled call. `close()` stops background reconnects, including an
attempt already in progress. Transport-change callbacks are observers: an
exception in one cannot change connection health or the call's result.
Remote closure also switches to gRPC-web and starts recovery when no RPC is
active. A late failure from a retired connection cannot disable its replacement.

`WebTransportRpcTransport`, `WebTransportConnection` and the frame helpers are
exported for applications that manage the connection themselves.

The declarations use the DOM types (`WebTransport`, streams, `RequestInit`):
a TypeScript project compiling against them includes the `DOM` library.

### Identifiers

The `sid.v1.ids` messages are those of
[`@structured-id/ids`](https://www.npmjs.com/package/@structured-id/ids): a
field such as `ProtectedResourceTarget.id` decodes into its `wire` type, and
converts with that package's validation:

```ts
import { ResourceId, required } from "@structured-id/ids";

const id = required(ResourceId, target.id); // throws on a missing or invalid identifier
```

### Modules

ES modules only. Node loads them from CommonJS through `require` (Node 20.19
and later).

### Other TypeScript protobuf clients

There is no message-key rewriting layer. The protobuf-ts generator uses its
standard lowerCamelCase local field names and numeric TypeScript enums. On
binary transports, fields are identified by number, `bytes` remain `Uint8Array`,
64-bit integers remain `bigint`, and timestamps retain `{ seconds: bigint,
nanos: number }`. The finishing script only reuses the identifier message
objects and adds `.js` to relative module imports.

Use message `toJson`/`fromJson` for ProtoJSON, rather than `JSON.stringify`
on a message object. ProtoJSON uses decimal strings for 64-bit integers,
base64 for bytes, full schema names for enums, and RFC 3339 timestamps.
Explicit schema `json_name` is honored: `UserInfo.givenName` becomes
`given_name` at the OIDC JSON boundary; ordinary fields use lowerCamelCase.

For independent [ts-proto](https://github.com/stephenh/ts-proto) clients, this
tested generator profile preserves binary values without Date conversion:

```text
forceLong=bigint,useDate=false,snakeToCamel=keys_json,useJsonName=false,stringEnums=false
```

`useDate=false` gives the matching seconds/nanos structure. In ts-proto
2.13.0, that option's default JSON conversion goes through `Date` and loses
sub-millisecond precision; it is not a lossless Timestamp ProtoJSON bridge.
The `string-nano` alternative tested with nano-date 4.1.0 also failed
pre-epoch and calendar-boundary round trips. Keep timestamps structured on
binary transports, and use the SDK's standard Timestamp ProtoJSON codec when
exact JSON interchange is needed. `useJsonTimestamp=raw` emits an object
instead of the standard RFC 3339 string and is not an equivalent REST contract.
JavaScript `Date` should only be a display conversion when that precision is
not needed.

Local enum constant names can differ between generators; use named constants
from your own generated module. Both codecs preserve unknown enum numbers in
binary protobuf. ts-proto 2.13.0's generated JSON enum helpers map unknown
values to `UNRECOGNIZED`; that path does not preserve future numeric values.
The interop suite checks both codecs against the actual SID schema, in both
directions for binary values and for JSON scalars, including 64-bit boundaries,
nanosecond calendar boundaries, optional zero/false values and explicit OIDC
JSON field names. Timestamp JSON precision is checked against the SDK codec;
the ts-proto limitations above are not declared compatible. The independent
codec is test-only, outside this package's runtime closure.

## Verify

From the `typescript/` directory of the SDK repository, with its `proto`
submodule checked out:

```sh
yarn install
yarn build
yarn test
ci/check-package.sh
```

The release workflow checks every runtime dependency range in the **packed
archive** against npm before publishing. Missing dependencies or registry
errors fail the job before a registry write; rerun the existing release's
publish job after the dependency is available. This applies even when different
package releases execute in concurrent workflows.
Within a run, one publish job processes release tags sequentially, with `ids`
before `proto`; a failed publication stops the sequence. Each package is built
from its own immutable release tag.

The registry bootstrap already published `0.1.0`. The first automated release
starts at `0.1.1`, so it publishes the reviewed implementation rather than
skipping an immutable version that already exists in npm.

## License

Apache License, version 2.0. See `LICENSE` and `NOTICE`.
