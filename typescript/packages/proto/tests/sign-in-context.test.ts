// A shared sign-in page reads where it completes an authorization request
// from the issuer; the generated client offers that read, and the context
// it answers survives the wire.
import { describe, it, expect } from "vitest";
import { GetSignInContextRequest, SignInContext } from "../src/generated/sid/v1/authn/auth.js";
import { AuthServiceClient } from "../src/generated/sid/v1/authn/auth.client.js";

describe("sid.v1.authn.AuthService.GetSignInContext", () => {
  it("is offered beside the authorization call", () => {
    const methods = new AuthServiceClient({} as never).methods.map((m) => m.name);
    expect(methods).toContain("GetSignInContext");
  });

  it("round-trips the request the page was sent with and its context", () => {
    const request = GetSignInContextRequest.create({
      authorizationRequest:
        "https://sid.example.com/i/0123456789abcdef0123456789abcdef/oauth2/authorize?client_id=c&request_uri=urn%3Aietf%3Aparams%3Aoauth%3Arequest_uri%3Ar",
    });
    expect(GetSignInContextRequest.fromBinary(GetSignInContextRequest.toBinary(request))).toEqual(
      request,
    );

    const context = SignInContext.create({
      issuer: "https://sid.example.com/i/0123456789abcdef0123456789abcdef",
      clientName: "Ops console",
    });
    expect(SignInContext.fromBinary(SignInContext.toBinary(context))).toEqual(context);
  });
});
