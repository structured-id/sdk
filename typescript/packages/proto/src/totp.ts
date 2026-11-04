/**
 * Presentation of a TOTP enrollment. The server sends the raw shared secret
 * and its parameters (`TotpEnrollmentChallenge`); an authenticator app takes
 * the Base32 secret typed in, or the `otpauth://totp` URI behind a QR code.
 */
import { TotpAlgorithm, type TotpEnrollmentChallenge } from "./generated/sid/v1/authn/auth.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** `bytes` in Base32 (RFC 4648 §6), without padding. */
export function base32(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += ALPHABET[(buffer << (5 - bits)) & 0x1f];
  }
  return out;
}

/**
 * `text` percent-encoded as a URI component: only RFC 3986 §2.3 unreserved
 * characters stay, as the Rust client encodes it.
 */
function component(text: string): string {
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

const ALGORITHMS: Partial<Record<TotpAlgorithm, string>> = {
  [TotpAlgorithm.SHA1]: "SHA1",
  [TotpAlgorithm.SHA256]: "SHA256",
  [TotpAlgorithm.SHA512]: "SHA512",
};

/**
 * The `otpauth://totp/<issuer>:<account>` URI of `challenge` (Key URI
 * Format), with issuer and account percent-encoded so neither can split the
 * label or add a parameter. Throws when the challenge lacks the secret or a
 * parameter the app needs (a guess would enroll codes the server refuses),
 * or when issuer or account holds the colon the label separates them with.
 */
export function otpauthUri(challenge: TotpEnrollmentChallenge): string {
  const algorithm = ALGORITHMS[challenge.algorithm];
  if (
    algorithm === undefined ||
    challenge.digits === 0 ||
    challenge.periodSeconds === 0 ||
    challenge.sharedSecret.length === 0
  ) {
    throw new Error("the TOTP enrollment names no secret, algorithm, digits or period");
  }
  // Key URI Format, Label: the colon separates issuer and account, literal
  // or %3A, so neither may contain one.
  if (challenge.issuer.includes(":") || challenge.accountName.includes(":")) {
    throw new Error("a TOTP issuer or account cannot contain a colon");
  }
  const issuer = component(challenge.issuer);
  const label = `${issuer}:${component(challenge.accountName)}`;
  return (
    `otpauth://totp/${label}?secret=${base32(challenge.sharedSecret)}` +
    `&issuer=${issuer}&algorithm=${algorithm}` +
    `&digits=${challenge.digits}&period=${challenge.periodSeconds}`
  );
}
