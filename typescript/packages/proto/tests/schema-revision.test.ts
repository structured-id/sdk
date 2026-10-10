// The package states the schema commit it is generated from. A schema update
// then changes a file of this package, so the release tooling, which assigns
// commits to packages by path, releases it; and the statement cannot drift
// from the proto submodule the generation actually reads.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

describe("SCHEMA_REVISION", () => {
  it("names the commit of the proto submodule", () => {
    const stated = readFileSync(`${here}../SCHEMA_REVISION`, "utf8").trim();
    const actual = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: `${here}../../../../proto`,
      encoding: "utf8",
    }).trim();
    expect(stated).toBe(actual);
  });
});
