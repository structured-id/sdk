import { IdError, type IdKind } from "./errors";

/**
 * The only accepted shape: exactly 16 bytes of a non-nil, non-max UUID of
 * the RFC 9562 variant and version 7 (RFC 9562 sections 4.1, 4.2, 5.7, 5.9,
 * 5.10). Returns a copy, so later changes to the input cannot reach it.
 */
export function validate(bytes: Uint8Array, kind: IdKind): Uint8Array {
  if (bytes.length !== 16) {
    throw new IdError(kind, { type: "length", length: bytes.length });
  }
  let zero = true;
  let ones = true;
  for (const byte of bytes) {
    zero &&= byte === 0x00;
    ones &&= byte === 0xff;
  }
  if (zero) throw new IdError(kind, { type: "nil" });
  if (ones) throw new IdError(kind, { type: "max" });
  // RFC 9562 4.1: the variant is the top bits of octet 8; this one is 10.
  if (((bytes[8] as number) & 0xc0) !== 0x80) {
    throw new IdError(kind, { type: "variant" });
  }
  // RFC 9562 4.2: the version is the high nibble of octet 6.
  const version = (bytes[6] as number) >> 4;
  if (version !== 7) throw new IdError(kind, { type: "version", version });
  return bytes.slice();
}

const HEX = /^[0-9a-fA-F]{32}$/;

/**
 * The 16 bytes of a textual UUID: hyphenated, simple (32 hex digits), braced
 * hyphenated or `urn:uuid:` hyphenated (RFC 9562 section 4), the forms the
 * Rust `sid-ids` parser accepts. Text is a presentation form; the wire
 * carries bytes.
 */
export function parseText(text: string, kind: IdKind): Uint8Array {
  let body = text;
  if (body.length === 45 && body.startsWith("urn:uuid:")) {
    body = body.slice(9);
  } else if (body.length === 38 && body.startsWith("{") && body.endsWith("}")) {
    body = body.slice(1, 37);
  }
  let hex: string;
  if (body.length === 36) {
    if (body[8] !== "-" || body[13] !== "-" || body[18] !== "-" || body[23] !== "-") {
      throw new IdError(kind, { type: "malformed" });
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
    throw new IdError(kind, { type: "malformed" });
  }
  if (!HEX.test(hex)) throw new IdError(kind, { type: "malformed" });
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  }
  return bytes;
}

/** Lowercase hyphenated form (RFC 9562 section 4). */
export function formatText(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
