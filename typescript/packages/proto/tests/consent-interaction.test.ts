// The browser authorization consent interaction is generated with its client,
// and the operation it names carries the identifier through @structured-id/ids,
// so a consent page reads and submits one validated operation id.
import { describe, it, expect } from "vitest";
import { AuthorizationOperationId, required } from "@structured-id/ids";
import { AuthFlowServiceClient } from "../src/generated/sid/v1/authn/auth_flow.client.js";
import {
  ClaimSharing,
  ConsentDecision,
  ConsentDetails,
  SubmitConsentRequest,
} from "../src/generated/sid/v1/authn/auth_flow.js";

const UUIDV7 = "019290a4-7b3c-7d2e-8f00-112233445566";

describe("sid.v1.authn.AuthFlowService", () => {
  it("has a client with the review, decision and state calls", () => {
    const methods = AuthFlowServiceClient.prototype;
    expect(typeof methods.getConsent).toBe("function");
    expect(typeof methods.submitConsent).toBe("function");
    expect(typeof methods.getFlowState).toBe("function");
  });

  it("carries the reviewed operation and its disclosed value", () => {
    const id = AuthorizationOperationId.parse(UUIDV7);
    const details = ConsentDetails.create({
      operationId: id.toWire(),
      revision: 3n,
      claims: [
        {
          name: "email",
          allowed: [ClaimSharing.NONE, ClaimSharing.STATIC],
          value: "a@sid.example.com",
        },
      ],
    });

    const decoded = ConsentDetails.fromBinary(ConsentDetails.toBinary(details));

    expect(required(AuthorizationOperationId, decoded.operationId).toString()).toBe(UUIDV7);
    expect(decoded.claims[0]?.value).toBe("a@sid.example.com");
  });

  it("submits a decision for the reviewed revision", () => {
    const request = SubmitConsentRequest.create({
      revision: 3n,
      decision: ConsentDecision.APPROVE,
      choices: [{ name: "email", sharing: ClaimSharing.STATIC }],
    });

    const decoded = SubmitConsentRequest.fromBinary(SubmitConsentRequest.toBinary(request));

    expect(decoded.decision).toBe(ConsentDecision.APPROVE);
    expect(decoded.choices).toEqual([{ name: "email", sharing: ClaimSharing.STATIC }]);
  });
});
