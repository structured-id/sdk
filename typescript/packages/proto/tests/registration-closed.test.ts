// A closed registration is told apart from other refusals by its own reason,
// and the public UI settings carry whether a page should offer it.
import { describe, it, expect } from "vitest";
import { ErrorReason } from "../src/generated/sid/v1/common/errors.js";
import { PublicUiSettings } from "../src/generated/sid/v1/ui/public_settings.js";

describe("closed registration", () => {
  it("has a reason of its own", () => {
    expect(ErrorReason[ErrorReason.REGISTRATION_DISABLED]).toBe("REGISTRATION_DISABLED");
    expect(ErrorReason.REGISTRATION_DISABLED).not.toBe(ErrorReason.REGISTRATION_RESTRICTED);
  });

  it("round-trips in the public UI settings", () => {
    const settings = PublicUiSettings.create({ registrationOpen: true });
    const read = PublicUiSettings.fromBinary(PublicUiSettings.toBinary(settings));
    expect(read.registrationOpen).toBe(true);
  });

  it("reads as closed when the field is absent", () => {
    expect(PublicUiSettings.create().registrationOpen).toBe(false);
  });
});
