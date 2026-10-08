// A CommonJS consumer of the packed package, outside this workspace.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { MachineUserId, wire } = require("@structured-id/ids");

const id = MachineUserId.parse("019290a4-7b3c-7d2e-8f00-112233445566");
assert.equal(MachineUserId.fromWire(wire.MachineUserId.fromJson(wire.MachineUserId.toJson(id.toWire()))).equals(id), true);
const schema = readFileSync(require.resolve("@structured-id/ids/schema/sid/v1/ids/ids.proto"), "utf8");
assert.match(schema, /package sid\.v1\.ids;/);
console.log("cjs ok");
