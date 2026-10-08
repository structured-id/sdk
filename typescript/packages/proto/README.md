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
connection is up. A transport-level failure (`UNAVAILABLE`, `CANCELLED`,
`UNKNOWN` or a stream error) retries that call over gRPC-web and reconnects
WebTransport in the background; an application error (`NOT_FOUND`,
`PERMISSION_DENIED`, ...) is returned as is. Server streaming always goes over
gRPC-web. Without a `webTransportUrl`, or where the runtime has no
`WebTransport`, it is plain gRPC-web.

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

## Verify

From the `typescript/` directory of the SDK repository, with its `proto`
submodule checked out:

```sh
yarn install
yarn build
yarn test
ci/check-package.sh
```

## License

Apache License, version 2.0. See `LICENSE` and `NOTICE`.
