// A client decides which calls carry an operation context from the method's
// own declaration: the generated method info carries the retry rule option,
// and the operation period service is generated with it.
import { describe, it, expect } from "vitest";
import { ProjectService } from "../src/generated/sid/v1/projects/projects.js";
import { OperationService } from "../src/generated/sid/v1/common/operation.js";
import { OperationServiceClient } from "../src/generated/sid/v1/common/operation.client.js";

const RETRY = "sid.v1.common.retry";

function rule(service: { methods: readonly { name: string; options: object }[] }, name: string) {
  const method = service.methods.find((m) => m.name === name);
  if (method === undefined) {
    throw new Error(`no method ${name}`);
  }
  return (method.options as Record<string, unknown>)[RETRY];
}

describe("retry rule option", () => {
  it("marks a keyed method", () => {
    expect(rule(ProjectService, "CreateProject")).toEqual({ keyed: true });
  });

  it("states a ceremony method's own rule", () => {
    const registered = rule(ProjectService, "RegisterClient") as { ceremony?: string };
    expect(registered.ceremony).toMatch(/RFC 7591/);
  });

  it("is absent on a method without effects", () => {
    expect(rule(ProjectService, "GetProject")).toBeUndefined();
  });

  it("generates the period service", () => {
    expect(OperationService.methods.map((m) => m.name)).toEqual(["GetOperationPeriod"]);
    expect(typeof OperationServiceClient).toBe("function");
  });
});
