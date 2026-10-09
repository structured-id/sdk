// A CommonJS consumer of the packed package, outside this workspace. The
// package ships ES modules only; Node loads them through require(esm).
const assert = require("node:assert/strict");
const { FrameReader, AdaptiveRpcTransport } = require("@structured-id/proto/transport");
const { Any } = require("@structured-id/proto/google/protobuf/any");

assert.equal(typeof FrameReader, "function");
assert.equal(typeof AdaptiveRpcTransport, "function");
assert.equal(Any.typeName, "google.protobuf.Any");
console.log("cjs ok");
