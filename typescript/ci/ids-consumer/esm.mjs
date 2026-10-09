// An ES module consumer of the packed package, outside this workspace.
import assert from "node:assert/strict";
import { BindingId, IdError, MissingIdError, PROTO_PATH, required, wire } from "@structured-id/ids";

const text = "019290a4-7b3c-7d2e-8f00-112233445566";
const encoded = wire.BindingId.toBinary(BindingId.parse(text).toWire());
assert.equal(Buffer.from(encoded).toString("hex"), "0a10019290a47b3c7d2e8f00112233445566");
assert.equal(required(BindingId, wire.BindingId.fromBinary(encoded)).toString(), text);
assert.throws(() => required(BindingId, undefined), MissingIdError);
assert.throws(() => BindingId.fromBytes(new Uint8Array(16)), IdError);
assert.equal(PROTO_PATH, "sid/v1/ids/ids.proto");
console.log("esm ok");
