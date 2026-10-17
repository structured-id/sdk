// An ES module consumer of the packed package, outside this workspace.
import assert from "node:assert/strict";
import { ResourceId, required } from "@structured-id/ids";
import { ProtectedResourceTarget } from "@structured-id/proto/sid/v1/authn/issuer";
import { IdentityServiceClient } from "@structured-id/proto/sid/v1/identity/identity.client";
import { Status } from "@structured-id/proto/google/rpc/status";

// A message carrying an identifier decodes into the checked type of
// @structured-id/ids.
const text = "019290a4-7b3c-7d2e-8f00-112233445566";
const target = ProtectedResourceTarget.create({ resource: "https://api.sid.example.com", id: ResourceId.parse(text).toWire() });
const decoded = ProtectedResourceTarget.fromBinary(ProtectedResourceTarget.toBinary(target));
assert.equal(required(ResourceId, decoded.id).toString(), text);

// The error model every refusal carries.
assert.equal(Status.fromBinary(Status.toBinary(Status.create({ code: 7, message: "denied" }))).code, 7);

// A generated client runs on the transport the application supplies
// (gRPC-web in a browser, gRPC on a server).
const transport = { mergeOptions: (options) => options ?? {} };
assert.equal(typeof new IdentityServiceClient(transport).getProfile, "function");
console.log("esm ok");
