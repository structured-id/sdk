// A sign-in page follows the installation's public UI settings: whether a
// registration may start, the local sign-in methods offered before an
// identifier is typed, and whether self-service password reset is served.
import { describe, it, expect } from "vitest";
import { PublicUiSettings } from "../src/generated/sid/v1/ui/public_settings.js";
import { PublicUiSettingsServiceClient } from "../src/generated/sid/v1/ui/public_settings.client.js";
import { SignInEntry } from "../src/generated/sid/v1/authn/sign_in_entry.js";

describe("public UI settings", () => {
  it("has the read a page calls", () => {
    expect(typeof PublicUiSettingsServiceClient.prototype.getPublicUiSettings).toBe(
      "function",
    );
  });

  it("carries the offered sign-in methods and the reset switch", () => {
    const settings = PublicUiSettings.create({
      revision: 3n,
      registrationOpen: false,
      signInMethods: ["opaque", "webauthn"],
      passwordResetOpen: true,
    });
    const decoded = PublicUiSettings.fromBinary(PublicUiSettings.toBinary(settings));
    expect(decoded.signInMethods).toEqual(["opaque", "webauthn"]);
    expect(decoded.passwordResetOpen).toBe(true);
    expect(decoded.registrationOpen).toBe(false);
  });

  // An installation that signs nobody in locally names no method.
  it("reads an installation without local sign-in as no methods", () => {
    const decoded = PublicUiSettings.fromBinary(
      PublicUiSettings.toBinary(PublicUiSettings.create({ revision: 1n })),
    );
    expect(decoded.signInMethods).toEqual([]);
    expect(decoded.passwordResetOpen).toBe(false);
  });

  it("names the sign-in at the issuer's trusted authority", () => {
    expect(SignInEntry.AUTHORITY).toBe(1);
  });
});
