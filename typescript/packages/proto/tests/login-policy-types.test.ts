// The login policy value types live in a module of their own, and the admin
// roles module keeps exporting the assurance level its consumers import from
// it: the same enum object, not a second copy.
import { describe, it, expect } from "vitest";
import * as roles from "../src/generated/sid/v1/admin/admin_roles.js";
import { ActiveAdminSession } from "../src/generated/sid/v1/admin/admin_roles.js";
import {
  AssuranceLevel,
  EnforcementMode,
} from "../src/generated/sid/v1/admin/login_policy_types.js";

describe("login policy value types", () => {
  it("exports one assurance level from both modules", () => {
    expect(roles.AssuranceLevel).toBe(AssuranceLevel);
  });

  it("keeps the assurance values", () => {
    expect([
      AssuranceLevel.UNSPECIFIED,
      AssuranceLevel.BASIC,
      AssuranceLevel.STANDARD,
      AssuranceLevel.ELEVATED,
      AssuranceLevel.CRITICAL,
    ]).toEqual([0, 1, 2, 3, 4]);
  });

  it("states the enforcement modes", () => {
    expect([
      EnforcementMode.UNSPECIFIED,
      EnforcementMode.HARD,
      EnforcementMode.SOFT,
      EnforcementMode.AUDIT,
    ]).toEqual([0, 1, 2, 3]);
  });

  it("carries the assurance of an admin session", () => {
    const session = ActiveAdminSession.create({ assurance: roles.AssuranceLevel.ELEVATED });
    const decoded = ActiveAdminSession.fromBinary(ActiveAdminSession.toBinary(session));
    expect(decoded.assurance).toBe(AssuranceLevel.ELEVATED);
  });
});
