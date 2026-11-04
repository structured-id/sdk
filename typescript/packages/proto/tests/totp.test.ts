// A TOTP enrollment arrives as the raw shared secret and its parameters; the
// SDK builds what an authenticator app takes: the Base32 secret for manual
// entry and the `otpauth://totp` URI behind the QR code.
import { describe, it, expect } from "vitest";
import { TotpAlgorithm, TotpEnrollmentChallenge } from "../src/generated/sid/v1/authn/auth.js";
import { base32, otpauthUri } from "../src/totp.js";

const ascii = (text: string) => new TextEncoder().encode(text);

function challenge(fields: Partial<TotpEnrollmentChallenge> = {}): TotpEnrollmentChallenge {
  return TotpEnrollmentChallenge.create({
    issuer: "StructuredID",
    accountName: "alice@sid.example.com",
    sharedSecret: ascii("12345678901234567890"),
    algorithm: TotpAlgorithm.SHA1,
    digits: 6,
    periodSeconds: 30,
    ...fields,
  });
}

describe("TOTP enrollment presentation", () => {
  // RFC 4648 §10 test vectors, unpadded.
  it("encodes Base32 as RFC 4648 without padding", () => {
    const vectors: [string, string][] = [
      ["", ""],
      ["f", "MY"],
      ["fo", "MZXQ"],
      ["foo", "MZXW6"],
      ["foob", "MZXW6YQ"],
      ["fooba", "MZXW6YTB"],
      ["foobar", "MZXW6YTBOI"],
    ];
    for (const [input, encoded] of vectors) {
      expect(base32(ascii(input))).toBe(encoded);
    }
  });

  // The RFC 6238 Appendix B secret, as authenticator apps scan it.
  it("builds the otpauth URI from the secret and the server's parameters", () => {
    expect(otpauthUri(challenge())).toBe(
      "otpauth://totp/StructuredID:alice%40sid.example.com" +
        "?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=StructuredID" +
        "&algorithm=SHA1&digits=6&period=30",
    );
  });

  // Regression guard: an issuer or account holding a reserved character
  // (`:`, `?`, `&`, `+`, `#`, a space) cannot split the label or add a
  // parameter; it round-trips through the URI.
  it("percent-encodes issuer and account so they cannot change the URI", () => {
    const issuer = "Acme: Ops & Co #1";
    const account = "a+b:c?d=e&f g@sid.example.com";
    const uri = new URL(otpauthUri(challenge({ issuer, accountName: account })));
    expect(uri.protocol).toBe("otpauth:");
    expect(decodeURIComponent(uri.pathname.slice(1))).toBe(`${issuer}:${account}`);
    expect([...uri.searchParams.keys()]).toEqual([
      "secret",
      "issuer",
      "algorithm",
      "digits",
      "period",
    ]);
    expect(uri.searchParams.get("issuer")).toBe(issuer);
  });

  // The same URI as the Rust client builds for the same challenge.
  it("encodes exactly as the Rust client", () => {
    expect(
      otpauthUri(challenge({ issuer: "Acme: Ops & Co #1", accountName: "a+b:c?d=e&f g(x)!" })),
    ).toBe(
      "otpauth://totp/Acme%3A%20Ops%20%26%20Co%20%231:a%2Bb%3Ac%3Fd%3De%26f%20g%28x%29%21" +
        "?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Acme%3A%20Ops%20%26%20Co%20%231" +
        "&algorithm=SHA1&digits=6&period=30",
    );
  });

  it("names the algorithm the server selected", () => {
    for (const [algorithm, name] of [
      [TotpAlgorithm.SHA256, "SHA256"],
      [TotpAlgorithm.SHA512, "SHA512"],
    ] as const) {
      expect(otpauthUri(challenge({ algorithm }))).toContain(`&algorithm=${name}&`);
    }
  });

  // A challenge a client cannot present faithfully is refused, not guessed.
  it("refuses a challenge without its parameters", () => {
    for (const fields of [
      { algorithm: TotpAlgorithm.UNSPECIFIED },
      { digits: 0 },
      { periodSeconds: 0 },
      { sharedSecret: new Uint8Array() },
    ]) {
      expect(() => otpauthUri(challenge(fields))).toThrow();
    }
  });
});
