// Run the real publish script with isolated commands: no Git or npm mutations.
// Publishing proto first, continuing after ids fails, or rebuilding an already
// immutable version would violate installability/retry behavior.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

describe("sequential release publication", () => {
  it.each(["ok", "failure", "published", "dispatch"])("handles %s", (scenario) => {
    const work = mkdtempSync(join(tmpdir(), "sid-publish-order-"));
    try {
      mkdirSync(join(work, "bin"));
      mkdirSync(join(work, "ci"));
      writeFileSync(join(work, "ci/check-publish-dependencies.mjs"), "");
      for (const pkg of ["ids", "proto"]) {
        mkdirSync(join(work, "packages", pkg), { recursive: true });
        writeFileSync(
          join(work, "packages", pkg, "package.json"),
          JSON.stringify({ name: `@structured-id/${pkg}`, version: "0.1.1" }),
        );
      }
      const commands: Record<string, string> = {
        git: 'if [ "$1" = checkout ]; then printf "%s\\n" "$3" > "$WORK/current"; fi',
        corepack: "exit 0",
        yarn: "exit 0",
        npm: `if [ "$1" = view ]; then
          [ "$SCENARIO" = published ] && [ "$2" = '@structured-id/ids@0.1.1' ] && exit 0
          exit 1
        fi
        cat "$WORK/current" >> "$WORK/publishes"
        [ "$SCENARIO" != failure ]`,
      };
      for (const [name, body] of Object.entries(commands)) {
        writeFileSync(join(work, "bin", name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
      }
      const result = spawnSync(
        "bash",
        [fileURLToPath(new URL("../../../ci/publish-typescript.sh", import.meta.url))],
        {
          cwd: work,
          env: {
            ...process.env,
            WORK: work,
            SCENARIO: scenario,
            TAGS: '["typescript-proto-v0.1.1","typescript-ids-v0.1.1"]',
            DISPATCH_TAG: scenario === "dispatch" ? "typescript-proto-v0.1.1" : "",
            RUNNER_TEMP: work,
            PATH: `${join(work, "bin")}:${process.env.PATH}`,
          },
          encoding: "utf8",
        },
      );
      expect(result.status, result.stderr).toBe(scenario === "failure" ? 1 : 0);
      const expected =
        scenario === "failure" ? ["ids"] : scenario === "ok" ? ["ids", "proto"] : ["proto"];
      expect(readFileSync(join(work, "publishes"), "utf8").trim().split("\n")).toEqual(
        expected.map((pkg) => `refs/tags/typescript-${pkg}-v0.1.1`),
      );
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
