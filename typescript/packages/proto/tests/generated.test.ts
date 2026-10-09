// The generated sid.v1 messages carry identifiers through the message objects
// of @structured-id/ids, not through a second generated copy, so a decoded
// identifier converts with that package's validation.
import { describe, it, expect } from "vitest";
import { IdError, ResourceId as CheckedResourceId, required, wire } from "@structured-id/ids";
import { ResourceId } from "../src/generated/sid/v1/ids/ids.js";
import { ProtectedResourceTarget } from "../src/generated/sid/v1/authn/issuer.js";

const UUIDV7 = "019290a4-7b3c-7d2e-8f00-112233445566";

describe("sid.v1.ids in generated messages", () => {
  it("is the message object of @structured-id/ids", () => {
    expect(ResourceId).toBe(wire.ResourceId);
  });

  it("round-trips an identifier field and converts it with validation", () => {
    const id = CheckedResourceId.parse(UUIDV7);
    const target = ProtectedResourceTarget.create({
      issuer: "https://sid.example.com",
      resource: "https://api.sid.example.com",
      active: true,
      id: id.toWire(),
    });

    const decoded = ProtectedResourceTarget.fromBinary(ProtectedResourceTarget.toBinary(target));

    expect(required(CheckedResourceId, decoded.id).toString()).toBe(UUIDV7);
  });

  it("refuses an identifier field that is not a UUIDv7", () => {
    const target = ProtectedResourceTarget.create({ id: { value: new Uint8Array(16) } });

    const decoded = ProtectedResourceTarget.fromBinary(ProtectedResourceTarget.toBinary(target));

    expect(decoded.id?.value).toHaveLength(16);
    expect(() => required(CheckedResourceId, decoded.id)).toThrow(IdError);
  });
});
