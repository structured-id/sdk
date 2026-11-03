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

describe("first-factor finish responses", () => {
  it("round-trip the second factors and the browser CSRF token", () => {
    const fields = {
      sessionId: "0192f3a4-7c1e-7b2a-9d4e-3f5a6b7c8d9e",
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

  it("is empty when the session is complete", () => {
    const response = OpaqueLoginFinishResponse.create({ sessionId: "s", expiresIn: 900n });
    expect(response.secondFactors).toEqual([]);
    expect(response.browserCsrf).toBeUndefined();
  });
});
