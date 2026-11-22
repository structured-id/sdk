// The administration console reads its installation session and settings
// through the generated clients: the browser session read on AuthService and
// the addresses and cookie scope on RealmService.
import { describe, it, expect } from "vitest";
import { AuthServiceClient } from "../src/generated/sid/v1/authn/auth.client.js";
import { BrowserSession } from "../src/generated/sid/v1/authn/auth.js";
import { RealmServiceClient } from "../src/generated/sid/v1/admin/settings.client.js";
import {
  SessionCookieDomain,
  UpdateInstallationAddressesRequest,
  UpdateSessionCookieScopeRequest,
} from "../src/generated/sid/v1/admin/settings.js";

describe("installation session and settings", () => {
  it("has the browser session read and the settings calls", () => {
    expect(typeof AuthServiceClient.prototype.getBrowserSession).toBe("function");
    const realm = RealmServiceClient.prototype;
    expect(typeof realm.getInstallationAddresses).toBe("function");
    expect(typeof realm.updateInstallationAddresses).toBe("function");
    expect(typeof realm.getSessionCookieScope).toBe("function");
    expect(typeof realm.updateSessionCookieScope).toBe("function");
  });

  it("carries the session's CSRF token and administrator flag", () => {
    const session = BrowserSession.create({ csrfToken: "abc", administrator: true });
    const decoded = BrowserSession.fromBinary(BrowserSession.toBinary(session));
    expect(decoded.csrfToken).toBe("abc");
    expect(decoded.administrator).toBe(true);
  });

  it("tells an absent address from an emptied one", () => {
    const decoded = UpdateInstallationAddressesRequest.fromBinary(
      UpdateInstallationAddressesRequest.toBinary(
        UpdateInstallationAddressesRequest.create({ consoleUrl: "" }),
      ),
    );
    expect(decoded.consoleUrl).toBe("");
    expect(decoded.publicUrl).toBeUndefined();
  });

  it("selects subdomains by list and pattern", () => {
    const request = UpdateSessionCookieScopeRequest.create({
      domain: SessionCookieDomain.SELECTED_SUBDOMAINS,
      subdomains: ["app.sid.example.com"],
      subdomainPattern: "[a-z]+\\.apps\\.sid\\.example\\.com",
    });
    const decoded = UpdateSessionCookieScopeRequest.fromBinary(
      UpdateSessionCookieScopeRequest.toBinary(request),
    );
    expect(decoded.domain).toBe(SessionCookieDomain.SELECTED_SUBDOMAINS);
    expect(decoded.subdomains).toEqual(["app.sid.example.com"]);
  });
});
