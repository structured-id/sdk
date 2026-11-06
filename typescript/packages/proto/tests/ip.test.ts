// The binary IP address: its checked reading and the text it is shown as.
import { describe, expect, it } from "vitest";
import {
  IpAddressError,
  ipAddressText,
  optionalIpAddress,
  readIpAddress,
  toIpAddress,
} from "../src/ip.js";

const bytes = (...values: number[]) => ({ value: Uint8Array.from(values) });

/** 16 octets from eight 16-bit groups. */
function v6(...groups: number[]) {
  const out = new Uint8Array(16);
  groups.forEach((g, i) => {
    out[2 * i] = g >> 8;
    out[2 * i + 1] = g & 0xff;
  });
  return { value: out };
}

describe("an IP address", () => {
  // The length is the family; the octets come back as they were sent.
  it("reads IPv4 and IPv6 by length and writes them back", () => {
    const four = readIpAddress(bytes(192, 0, 2, 7));
    expect(four.family).toBe("ipv4");
    expect(ipAddressText(four)).toBe("192.0.2.7");
    expect(toIpAddress(four)).toEqual(bytes(192, 0, 2, 7));

    const six = readIpAddress(v6(0x2001, 0xdb8, 0, 0, 0, 0, 0, 7));
    expect(six.family).toBe("ipv6");
    expect(ipAddressText(six)).toBe("2001:db8::7");
    expect(toIpAddress(six)).toEqual(v6(0x2001, 0xdb8, 0, 0, 0, 0, 0, 7));
  });

  // Zero addresses are addresses, not absence.
  it("reads zero addresses as addresses", () => {
    expect(ipAddressText(readIpAddress(bytes(0, 0, 0, 0)))).toBe("0.0.0.0");
    expect(ipAddressText(readIpAddress(v6(0, 0, 0, 0, 0, 0, 0, 0)))).toBe("::");
  });

  // An IPv4-mapped address stays IPv6 and is shown in its mixed form
  // (RFC 5952 section 5).
  it("keeps an IPv4-mapped address IPv6", () => {
    const mapped = readIpAddress(v6(0, 0, 0, 0, 0, 0xffff, 0xc000, 0x0207));
    expect(mapped.family).toBe("ipv6");
    expect(ipAddressText(mapped)).toBe("::ffff:192.0.2.7");
  });

  // RFC 5952 section 4: lowercase, no leading zeros, the longest zero run
  // shortened (the first of equal ones), a single zero group kept.
  it("writes IPv6 in its RFC 5952 form", () => {
    const cases: [number[], string][] = [
      [[0x2001, 0xdb8, 0, 0, 1, 0, 0, 1], "2001:db8::1:0:0:1"],
      [[0x2001, 0xdb8, 0, 1, 1, 1, 1, 1], "2001:db8:0:1:1:1:1:1"],
      [[0x2001, 0, 0, 1, 0, 0, 0, 1], "2001:0:0:1::1"],
      [[0xabcd, 0xef, 0, 0, 0, 0, 0, 0], "abcd:ef::"],
      [[0, 0, 0, 0, 0, 0, 0, 1], "::1"],
    ];
    for (const [groups, text] of cases) {
      expect(ipAddressText(readIpAddress(v6(...groups)))).toBe(text);
    }
  });

  // Bug prevented: any length was shown as an address.
  it("refuses any length but 4 or 16, naming only the length", () => {
    for (const length of [0, 1, 5, 15, 17]) {
      const message = { value: new Uint8Array(length).fill(9) };
      expect(() => readIpAddress(message)).toThrow(IpAddressError);
      expect(() => readIpAddress(message)).toThrow(`an IP address is 4 or 16 bytes, not ${length}`);
    }
  });

  // An absent field is an unknown address; a present empty one is invalid.
  it("keeps an absent address absent", () => {
    expect(optionalIpAddress(undefined)).toBeUndefined();
    expect(() => optionalIpAddress({ value: new Uint8Array() })).toThrow(IpAddressError);
  });

  // The reading is a copy: changing the message afterwards changes nothing.
  it("copies the octets", () => {
    const message = bytes(192, 0, 2, 7);
    const address = readIpAddress(message);
    message.value[0] = 10;
    expect(ipAddressText(address)).toBe("192.0.2.7");
  });
});
