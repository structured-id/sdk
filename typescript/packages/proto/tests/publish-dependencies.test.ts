// Exercise the release gate as a separate process with a fake registry command.
// A cross-workflow race or registry failure must stop publication, while an
// available dependency allows it; no tags or registry writes occur in the test.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

describe("packed publication dependency gate", () => {
  it.each([
    ["0.1.0", true],
    [[], false],
    [null, false],
  ])("checks the actual registry result %j", (versions, succeeds) => {
    const work = mkdtempSync(join(tmpdir(), "sid-publish-gate-"));
    try {
      mkdirSync(join(work, "package"));
      mkdirSync(join(work, "bin"));
      writeFileSync(
        join(work, "package/package.json"),
        JSON.stringify({ dependencies: { "@structured-id/ids": "^0.1.0" } }),
      );
      const archive = join(work, "package.tgz");
      execFileSync("tar", ["-czf", archive, "package/package.json"], { cwd: work });
      // Validate that the gate asks for the packed range, not a workspace version.
      writeFileSync(
        join(work, "bin/npm"),
        `#!/bin/sh
test "$1" = view && test "$2" = '@structured-id/ids@^0.1.0' || exit 2
printf '%s' '${JSON.stringify(versions)}'
`,
        { mode: 0o755 },
      );
      const gate = fileURLToPath(
        new URL("../../../ci/check-publish-dependencies.mjs", import.meta.url),
      );
      const result = spawnSync(process.execPath, [gate, archive], {
        env: { ...process.env, PATH: `${join(work, "bin")}:${process.env.PATH}` },
        encoding: "utf8",
      });
      expect(result.status === 0, result.stderr).toBe(succeeds);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
