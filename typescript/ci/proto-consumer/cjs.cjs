// A CommonJS consumer of the packed package, outside this workspace. The
// package ships ES modules only; Node loads them through require(esm).
const assert = require("node:assert/strict");
const { IdentityServiceClient } = require("@structured-id/proto/sid/v1/identity/identity.client");
const { Any } = require("@structured-id/proto/google/protobuf/any");

assert.equal(typeof IdentityServiceClient, "function");
assert.equal(Any.typeName, "google.protobuf.Any");
console.log("cjs ok");
