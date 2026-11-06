/**
 * The checked reading of `sid.v1.common.IpAddress` and its text for display.
 * The message carries one IP host address as data: 4 bytes for IPv4 or 16
 * for IPv6 in network order, the length giving the family. An absent field
 * means the address is unknown or was not recorded.
 */
import type { IpAddress } from "./generated/sid/v1/common/types.js";

/** An address's family, as the message's length gives it. */
export type IpFamily = "ipv4" | "ipv6";

/** An address read from its message: the family and a copy of its octets. */
export interface CheckedIpAddress {
  readonly family: IpFamily;
  /** 4 octets for IPv4, 16 for IPv6, in network order. */
  readonly octets: Uint8Array;
}

/** A message whose value is not 4 or 16 bytes. Names the length only. */
export class IpAddressError extends Error {
  constructor(readonly length: number) {
    super(`an IP address is 4 or 16 bytes, not ${length}`);
    this.name = "IpAddressError";
  }
}

/** The address `message` carries, or `IpAddressError` for another length. */
export function readIpAddress(message: IpAddress): CheckedIpAddress {
  const { length } = message.value;
  if (length === 4) return { family: "ipv4", octets: message.value.slice() };
  if (length === 16) return { family: "ipv6", octets: message.value.slice() };
  throw new IpAddressError(length);
}

/**
 * The address of an optional field: an absent message stays absent (unknown
 * or unrecorded); a present one is read as `readIpAddress` reads it.
 */
export function optionalIpAddress(message: IpAddress | undefined): CheckedIpAddress | undefined {
  return message === undefined ? undefined : readIpAddress(message);
}

/** The message carrying `address`. */
export function toIpAddress(address: CheckedIpAddress): IpAddress {
  return { value: address.octets.slice() };
}

/** Dotted-decimal text of 4 octets. */
function dotted(octets: Uint8Array): string {
  return Array.from(octets).join(".");
}

/** Whether 16 octets are an IPv4-mapped IPv6 address (RFC 4291 section 2.5.5.2). */
function isMapped(octets: Uint8Array): boolean {
  for (let i = 0; i < 10; i++) if (octets[i] !== 0) return false;
  return octets[10] === 0xff && octets[11] === 0xff;
}

/**
 * RFC 5952 text of 16 octets: lowercase hexadecimal groups without leading
 * zeros, the longest run of two or more zero groups (the first of equal
 * runs) shortened to `::`. An IPv4-mapped address is written
 * `::ffff:a.b.c.d` (RFC 5952 section 5); it stays IPv6.
 */
function ipv6Text(octets: Uint8Array): string {
  if (isMapped(octets)) return `::ffff:${dotted(octets.subarray(12))}`;
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push((octets[i]! << 8) | octets[i + 1]!);
  let bestStart = -1;
  let bestLength = 1;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  const hex = (g: number) => g.toString(16);
  if (bestStart < 0) return groups.map(hex).join(":");
  const head = groups.slice(0, bestStart).map(hex).join(":");
  const tail = groups
    .slice(bestStart + bestLength)
    .map(hex)
    .join(":");
  return `${head}::${tail}`;
}

/** The text an address is shown as: dotted IPv4, or RFC 5952 IPv6. */
export function ipAddressText(address: CheckedIpAddress): string {
  return address.family === "ipv4" ? dotted(address.octets) : ipv6Text(address.octets);
}
