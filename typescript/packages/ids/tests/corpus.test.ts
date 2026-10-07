// The identifier corpus of the proto definitions, run unchanged: the same
// file the Rust packages compute and compare. Every case checks the binary
// encoding, standard ProtoJSON both ways and the checked conversion outcome.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { IMessageType, JsonValue } from "@protobuf-ts/runtime";
import {
  BindingId,
  IdError,
  MachineUserId,
  MissingIdError,
  PasswordOperationId,
  PROTO_PATH,
  ProvisioningConnectorId,
  ProvisioningCredentialId,
  ResourceId,
  required,
  wire,
  type IdErrorReason,
  type IdType,
} from "../src/index";

interface Case {
  kind: string;
  case: string;
  about: string;
  value_hex: string | null;
  wire_hex: string | null;
  protojson: JsonValue;
  expect: string;
}

interface Corpus {
  proto: string;
  cases: Case[];
  protojson_inputs: { wire_hex: string; inputs: JsonValue[] };
  wrapper_substitution: { legacy_wire_hex: string; binding_wire_hex: string };
}

const corpusPath = join(
  import.meta.dirname,
  "../../../../proto",
  PROTO_PATH.replace(/\.proto$/, ".corpus.json"),
);
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as Corpus;

type Message = { value: Uint8Array };

/** Every delivered kind: its class and its generated message type. */
const kinds: Record<string, { type: IdType<unknown, Message>; message: IMessageType<Message> }> = {
  BindingId: { type: BindingId, message: wire.BindingId },
  MachineUserId: { type: MachineUserId, message: wire.MachineUserId },
  PasswordOperationId: { type: PasswordOperationId, message: wire.PasswordOperationId },
  ProvisioningConnectorId: {
    type: ProvisioningConnectorId,
    message: wire.ProvisioningConnectorId,
  },
  ProvisioningCredentialId: {
    type: ProvisioningCredentialId,
    message: wire.ProvisioningCredentialId,
  },
  ResourceId: { type: ResourceId, message: wire.ResourceId },
};

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The corpus spelling of a refusal, as the Rust corpus generator writes it. */
function code(reason: IdErrorReason): string {
  switch (reason.type) {
    case "length":
      return `length:${reason.length}`;
    case "version":
      return `version:${reason.version}`;
    default:
      return reason.type;
  }
}

/** The outcome of the checked conversion of a required field. */
function outcome(type: IdType<unknown, Message>, message: Message | undefined): string {
  try {
    required(type, message);
    return "valid";
  } catch (error) {
    if (error instanceof MissingIdError) return "missing";
    if (error instanceof IdError) return code(error.reason);
    throw error;
  }
}

function kindOf(name: string) {
  const kind = kinds[name];
  if (!kind) throw new Error(`the corpus names ${name}, which this package does not deliver`);
  return kind;
}

describe("identifier corpus", () => {
  it("names the schema this package carries", () => {
    expect(corpus.proto).toBe(PROTO_PATH);
  });

  it("covers exactly the kinds this package delivers", () => {
    // A kind added to the schema and the corpus without a class here, or a
    // class without corpus cases, fails.
    const named = [...new Set(corpus.cases.map((c) => c.kind))].sort();
    expect(named).toEqual(Object.keys(kinds).sort());
  });

  for (const c of corpus.cases) {
    it(`${c.kind}/${c.case}: ${c.about}`, () => {
      const { type, message } = kindOf(c.kind);
      if (c.value_hex === null || c.wire_hex === null) {
        expect(outcome(type, undefined)).toBe(c.expect);
        return;
      }
      const value = fromHex(c.value_hex);
      const msg: Message = { value };
      // Binary: encodes to the corpus bytes and decodes back to the value.
      expect(toHex(message.toBinary(msg))).toBe(c.wire_hex);
      expect(toHex(message.fromBinary(fromHex(c.wire_hex)).value)).toBe(c.value_hex);
      // Standard ProtoJSON: the same document, and it parses to the same bytes.
      expect(message.toJson(msg)).toEqual(c.protojson);
      expect(toHex(message.toBinary(message.fromJson(c.protojson)))).toBe(c.wire_hex);
      // Checked conversion.
      expect(outcome(type, message.fromBinary(fromHex(c.wire_hex)))).toBe(c.expect);
    });
  }

  it("valid identifiers encode back to their own bytes", () => {
    for (const c of corpus.cases.filter((c) => c.expect === "valid")) {
      const { type, message } = kindOf(c.kind);
      const id = required(type, message.fromBinary(fromHex(c.wire_hex as string))) as {
        toWire(): Message;
      };
      expect(toHex(message.toBinary(id.toWire()))).toBe(c.wire_hex);
    }
  });

  it("accepts every ProtoJSON base64 spelling of bytes", () => {
    // protobuf.dev ProtoJSON mapping, `bytes`: standard or URL-safe base64,
    // padded or not, on input.
    for (const input of corpus.protojson_inputs.inputs) {
      const parsed = wire.BindingId.fromJson(input);
      expect(toHex(wire.BindingId.toBinary(parsed))).toBe(corpus.protojson_inputs.wire_hex);
    }
  });

  it("encodes BindingId as a consumer's old single-bytes-field wrapper did", () => {
    const { legacy_wire_hex, binding_wire_hex } = corpus.wrapper_substitution;
    expect(binding_wire_hex).toBe(legacy_wire_hex);
    const decoded = wire.BindingId.fromBinary(fromHex(legacy_wire_hex));
    expect(toHex(wire.BindingId.toBinary(decoded))).toBe(binding_wire_hex);
  });
});
