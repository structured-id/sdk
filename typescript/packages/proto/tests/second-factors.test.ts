// A first-factor sign-in that still owes its second factor names the
// factors that complete it and, for a browser, the CSRF token the
// completion sends; the generated messages carry both over the wire.
import { describe, it, expect } from "vitest";
import {
  LegacyMigrateFinishResponse,
  OpaqueLoginFinishResponse,
  StepUpMethod,
  WebAuthnAuthenticationFinishResponse,
} from "../src/generated/sid/v1/authn/auth.js";
import { UpstreamAuthSuccess } from "../src/generated/sid/v1/federation/upstream.js";

// 0192f3a4-7c1e-7b2a-9d4e-3f5a6b7c8d9e: a UUIDv7 session id in its wire bytes.
const session = {
  value: Uint8Array.from([
    0x01, 0x92, 0xf3, 0xa4, 0x7c, 0x1e, 0x7b, 0x2a, 0x9d, 0x4e, 0x3f, 0x5a, 0x6b, 0x7c, 0x8d, 0x9e,
  ]),
};

describe("first-factor finish responses", () => {
  it("round-trip the second factors and the browser CSRF token", () => {
    const fields = {
      sessionId: session,
      expiresIn: 300n,
      secondFactors: [StepUpMethod.TOTP],
      browserCsrf: "csrf-token",
    };
    for (const message of [
      OpaqueLoginFinishResponse,
      WebAuthnAuthenticationFinishResponse,
      LegacyMigrateFinishResponse,
    ]) {
      const response = message.create(fields);
      expect(message.fromBinary(message.toBinary(response))).toEqual(response);
    }
  });

  // An upstream sign-in owes its second factor as a password sign-in does:
  // the callback answer names the factors, the enrollable ones and the CSRF
  // token the browser completes the pending context with.
  it("round-trip the pending factors of an upstream sign-in", () => {
    const success = UpstreamAuthSuccess.create({
      sessionId: session,
      expiresIn: 300n,
      newProfileCreated: false,
      secondFactors: [StepUpMethod.TOTP],
      browserCsrf: "csrf-token",
      enrollableFactors: [StepUpMethod.WEBAUTHN],
    });
    expect(UpstreamAuthSuccess.fromBinary(UpstreamAuthSuccess.toBinary(success))).toEqual(success);
  });

  it("is empty when the session is complete", () => {
    const response = OpaqueLoginFinishResponse.create({ sessionId: session, expiresIn: 900n });
    expect(response.secondFactors).toEqual([]);
    expect(response.browserCsrf).toBeUndefined();
  });
});
