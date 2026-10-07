// Validation, text forms and kind separation of the identifier classes.
import { describe, expect, it } from "vitest";
import {
  BindingId,
  IdError,
  MachineUserId,
  MissingIdError,
  ResourceId,
  optional,
  required,
  wire,
} from "../src/index";

/** 019290a4-7b3c-7d2e-8f00-112233445566: version 7, RFC 9562 variant. */
const TEXT = "019290a4-7b3c-7d2e-8f00-112233445566";
const V7 = Uint8Array.from([
  0x01, 0x92, 0x90, 0xa4, 0x7b, 0x3c, 0x7d, 0x2e, 0x8f, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66,
]);

function reasonOf(f: () => unknown): unknown {
  try {
    f();
  } catch (error) {
    if (error instanceof IdError) return error.reason;
    throw error;
  }
  throw new Error("accepted");
}

describe("fromBytes", () => {
  it("accepts a UUIDv7 and keeps its bytes", () => {
    expect(BindingId.fromBytes(V7).toBytes()).toEqual(V7);
  });

  it("names the reason of every refusal, length first", () => {
    // Bug prevented: a refusal that hides why, or checks in an order that
    // reports a version for a value that is not even 16 bytes.
    expect(reasonOf(() => BindingId.fromBytes(V7.slice(0, 15)))).toEqual({
      type: "length",
      length: 15,
    });
    expect(reasonOf(() => BindingId.fromBytes(new Uint8Array(16)))).toEqual({ type: "nil" });
    expect(reasonOf(() => BindingId.fromBytes(new Uint8Array(16).fill(0xff)))).toEqual({
      type: "max",
    });
    const ncs = V7.slice();
    ncs[8] = 0x0f;
    ncs[6] = 0x4d;
    // Variant is refused before the version is read.
    expect(reasonOf(() => BindingId.fromBytes(ncs))).toEqual({ type: "variant" });
    const v4 = V7.slice();
    v4[6] = 0x4d;
    expect(reasonOf(() => BindingId.fromBytes(v4))).toEqual({ type: "version", version: 4 });
  });

  it("is not changed by later writes to the input or to toBytes output", () => {
    // Bug prevented: an identifier aliasing a caller's buffer.
    const input = V7.slice();
    const id = BindingId.fromBytes(input);
    input[0] = 0xaa;
    id.toBytes()[1] = 0xbb;
    expect(id.toBytes()).toEqual(V7);
  });

  it("reports the kind and never the value", () => {
    const error = (() => {
      try {
        MachineUserId.fromBytes(new Uint8Array(16));
      } catch (e) {
        return e as IdError;
      }
      throw new Error("accepted");
    })();
    expect(error.kind).toBe("MachineUserId");
    expect(error.message).toBe("invalid MachineUserId: the nil UUID");
  });
});

describe("text forms", () => {
  it("parses the hyphenated, simple, braced and URN forms", () => {
    for (const text of [
      TEXT,
      TEXT.toUpperCase(),
      TEXT.replaceAll("-", ""),
      `{${TEXT}}`,
      `urn:uuid:${TEXT}`,
    ]) {
      expect(BindingId.parse(text).toBytes()).toEqual(V7);
    }
  });

  it("refuses other text as malformed", () => {
    for (const text of [
      "",
      "not-a-uuid",
      TEXT.slice(1),
      `${TEXT}0`,
      TEXT.replace("-", "_"),
      `{${TEXT.replaceAll("-", "")}}`,
      `URN:UUID:${TEXT}`,
      TEXT.replace("0", "g"),
    ]) {
      expect(reasonOf(() => BindingId.parse(text))).toEqual({ type: "malformed" });
    }
  });

  it("validates parsed text like bytes", () => {
    expect(reasonOf(() => BindingId.parse("00000000-0000-0000-0000-000000000000"))).toEqual({
      type: "nil",
    });
  });

  it("prints lowercase hyphenated text, also as JSON", () => {
    const id = BindingId.parse(TEXT.toUpperCase());
    expect(id.toString()).toBe(TEXT);
    expect(JSON.stringify({ id })).toBe(`{"id":"${TEXT}"}`);
  });
});

describe("kinds", () => {
  it("keeps equal bytes of different kinds apart", () => {
    const binding = BindingId.fromBytes(V7);
    const machine = MachineUserId.fromBytes(V7);
    expect(binding.equals(BindingId.fromBytes(V7))).toBe(true);
    expect(binding.equals(machine)).toBe(false);
    // @ts-expect-error a MachineUserId is not a BindingId
    const wrong: BindingId = machine;
    expect(wrong.kind).toBe("MachineUserId");
  });
});

describe("wire conversion", () => {
  it("round-trips through the message", () => {
    const id = ResourceId.fromBytes(V7);
    expect(ResourceId.fromWire(id.toWire()).equals(id)).toBe(true);
  });

  it("required refuses absence, optional keeps it", () => {
    expect(() => required(BindingId, undefined)).toThrow(MissingIdError);
    expect(optional(BindingId, undefined)).toBeUndefined();
  });

  it("optional still refuses a present empty message", () => {
    // Bug prevented: an empty message read as absence.
    expect(() => optional(BindingId, wire.BindingId.create())).toThrow(IdError);
  });
});
