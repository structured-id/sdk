// Type-level use of the packed package's declarations.
import type { RpcTransport } from "@protobuf-ts/runtime-rpc";
import { wire } from "@structured-id/ids";
import type { ProtectedResourceTarget } from "@structured-id/proto/sid/v1/authn/issuer";
import { IdentityServiceClient } from "@structured-id/proto/sid/v1/identity/identity.client";
import { AdaptiveRpcTransport, type TransportType } from "@structured-id/proto/transport";

// The identifier field is the message type of @structured-id/ids.
const target: ProtectedResourceTarget = {
  issuer: "",
  resource: "",
  active: false,
  id: { value: new Uint8Array(16) } satisfies wire.ResourceId,
};
const transport: RpcTransport = new AdaptiveRpcTransport({ grpcWebUrl: "https://sid.example.com" });
const client = new IdentityServiceClient(transport);
const kind: TransportType = "grpc-web";
// @ts-expect-error only the two transports exist
const wrong: TransportType = "http";
export { target, client, kind, wrong };
