// Type-level use of the packed package's declarations.
import type { RpcTransport } from "@protobuf-ts/runtime-rpc";
import { wire } from "@structured-id/ids";
import type { ProtectedResourceTarget } from "@structured-id/proto/sid/v1/authn/issuer";
import { IdentityServiceClient } from "@structured-id/proto/sid/v1/identity/identity.client";

// The identifier field is the message type of @structured-id/ids.
const target: ProtectedResourceTarget = {
  issuer: "",
  resource: "",
  active: false,
  id: { value: new Uint8Array(16) } satisfies wire.ResourceId,
};
// A generated client takes any protobuf-ts transport the application supplies.
declare const transport: RpcTransport;
const client = new IdentityServiceClient(transport);
export { target, client };
