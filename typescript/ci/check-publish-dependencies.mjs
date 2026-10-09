// The packed dependency ranges, not workflow/matrix ordering, are authoritative.
// A dependency release may run concurrently or fail. Never publish an archive
// whose required runtime dependency cannot be installed from the public registry.
import { execFileSync } from "node:child_process";

const archive = process.argv[2];
if (!archive)
  throw new Error("Usage: node ci/check-publish-dependencies.mjs ARCHIVE");
const manifest = JSON.parse(
  execFileSync("tar", ["-xOzf", archive, "package/package.json"], {
    encoding: "utf8",
  }),
);
for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
  if (typeof range !== "string" || /^(workspace:|file:|link:)/.test(range)) {
    throw new Error(`Unpublishable dependency ${name}: ${range}`);
  }
  const versions = JSON.parse(
    execFileSync(
      "npm",
      [
        "view",
        `${name}@${range}`,
        "version",
        "--json",
        "--registry=https://registry.npmjs.org",
        "--fetch-retries=0",
        "--fetch-timeout=30000",
      ],
      { encoding: "utf8", timeout: 35000 },
    ),
  );
  if (
    !(typeof versions === "string" && versions.length > 0) &&
    !(
      Array.isArray(versions) &&
      versions.length > 0 &&
      versions.every((v) => typeof v === "string" && v.length > 0)
    )
  ) {
    throw new Error(`No published version satisfies ${name}@${range}`);
  }
  console.log(`Published dependency: ${name}@${range}`);
}
