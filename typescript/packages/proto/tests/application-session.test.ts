// An application's UI reads its session and signs out through typed calls of
// its own UI host; the generated client names exactly those calls, and the
// messages the page reads survive the wire.
import { describe, it, expect } from "vitest";
import {
  ApplicationSession,
  EndApplicationSessionResponse,
  GrantOutcome,
} from "../src/generated/sid/v1/authn/application_session.js";
import { ApplicationSessionServiceClient } from "../src/generated/sid/v1/authn/application_session.client.js";

describe("sid.v1.authn.ApplicationSessionService", () => {
  it("offers the sign-in navigations, the session read and sign-out", () => {
    const methods = new ApplicationSessionServiceClient({} as never).methods.map((m) => m.name);
    expect(methods).toEqual([
      "StartSignIn",
      "CompleteSignIn",
      "GetApplicationSession",
      "EndApplicationSession",
    ]);
  });

  it("round-trips the session the page reads, its CSRF token included", () => {
    const session = ApplicationSession.create({
      sub: "0192f3a4-7c1e-7b2a-9d4e-3f5a6b7c8d9e",
      email: "user@sid.example.com",
      acr: "urn:sid:acr:basic",
      csrfToken: "c".repeat(64),
    });

    const decoded = ApplicationSession.fromBinary(ApplicationSession.toBinary(session));

    expect(decoded).toEqual(session);
    expect(decoded.name).toBeUndefined();
  });

  it("names what became of the grant at sign-out", () => {
    const ended = EndApplicationSessionResponse.create({ grant: GrantOutcome.REVOKED });

    const decoded = EndApplicationSessionResponse.fromBinary(
      EndApplicationSessionResponse.toBinary(ended),
    );

    expect(decoded.grant).toBe(GrantOutcome.REVOKED);
    expect(GrantOutcome[GrantOutcome.UNKNOWN]).toBe("UNKNOWN");
  });
});
