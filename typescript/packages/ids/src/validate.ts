import { IdError, type IdErrorReason, type IdKind } from "./errors";

/**
 * The identifier shape on its own, for identifier kinds defined outside this
 * package: exactly 16 bytes of a non-nil, non-max UUID of the RFC 9562
 * variant and version 7 (RFC 9562 sections 4.1, 4.2, 5.7, 5.9, 5.10).
 * Returns why the bytes are refused, or `undefined` when they are accepted.
 */
export function checkV7(bytes: Uint8Array): IdErrorReason | undefined {
  if (bytes.length !== 16) return { type: "length", length: bytes.length };
  let zero = true;
  let ones = true;
  for (const byte of bytes) {
    zero &&= byte === 0x00;
    ones &&= byte === 0xff;
  }
  if (zero) return { type: "nil" };
  if (ones) return { type: "max" };
  // RFC 9562 4.1: the variant is the top bits of octet 8; this one is 10.
  if (((bytes[8] as number) & 0xc0) !== 0x80) return { type: "variant" };
  // RFC 9562 4.2: the version is the high nibble of octet 6.
  const version = (bytes[6] as number) >> 4;
  if (version !== 7) return { type: "version", version };
  return undefined;
}

/** Whether 16 bytes are all zero except the last, which is not. */
function isBuiltinRole(bytes: Uint8Array): boolean {
  if (bytes.length !== 16) return false;
  for (let i = 0; i < 15; i++) if (bytes[i] !== 0x00) return false;
  return bytes[15] !== 0x00;
}

/** A project: `checkV7`, or the nil UUID of the system project. */
export function checkProject(bytes: Uint8Array): IdErrorReason | undefined {
  if (bytes.length === 16 && bytes.every((byte) => byte === 0x00)) return undefined;
  return checkV7(bytes);
}

/** A role: `checkV7`, or a built-in role (15 zero bytes, a nonzero last one). */
export function checkRole(bytes: Uint8Array): IdErrorReason | undefined {
  if (isBuiltinRole(bytes)) return undefined;
  return checkV7(bytes);
}

/**
 * `kind`'s shape (`checkV7` unless the kind keeps fixed values), refused as
 * `kind`. Returns a copy, so later changes to the input cannot reach it.
 */
export function validate<K extends string = IdKind>(
  bytes: Uint8Array,
  kind: K,
  check: (bytes: Uint8Array) => IdErrorReason | undefined = checkV7,
): Uint8Array {
  const refused = check(bytes);
  if (refused) throw new IdError(kind, refused);
  return bytes.slice();
}

const HEX = /^[0-9a-fA-F]{32}$/;

/**
 * The 16 bytes of a textual UUID: hyphenated, simple (32 hex digits), braced
 * hyphenated or `urn:uuid:` hyphenated (RFC 9562 section 4), the forms the
 * Rust `sid-ids` parser accepts; `undefined` for any other text. Text is a
 * presentation form; the wire carries bytes.
 */
export function parseUuidText(text: string): Uint8Array | undefined {
  let body = text;
  if (body.length === 45 && body.startsWith("urn:uuid:")) {
    body = body.slice(9);
  } else if (body.length === 38 && body.startsWith("{") && body.endsWith("}")) {
    body = body.slice(1, 37);
  }
  let hex: string;
  if (body.length === 36) {
    if (body[8] !== "-" || body[13] !== "-" || body[18] !== "-" || body[23] !== "-") {
      return undefined;
    }
    hex =
      body.slice(0, 8) +
      body.slice(9, 13) +
      body.slice(14, 18) +
      body.slice(19, 23) +
      body.slice(24);
  } else if (body.length === 32 && text.length === 32) {
    hex = body;
  } else {
    return undefined;
  }
  if (!HEX.test(hex)) return undefined;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  }
  return bytes;
}

/** The bytes of a textual UUID, refused as `kind` when it is not one. */
export function parseText<K extends string = IdKind>(text: string, kind: K): Uint8Array {
  const bytes = parseUuidText(text);
  if (!bytes) throw new IdError(kind, { type: "malformed" });
  return bytes;
}

/** Lowercase hyphenated form (RFC 9562 section 4). */
export function formatUuid(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
