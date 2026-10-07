// Copies the canonical identifier schema from the repository's `proto`
// checkout into the package, so the generated messages and the published
// package carry the exact schema they were built from.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = "sid/v1/ids/ids.proto";
const source = join(pkg, "../../../proto", path);
const target = join(pkg, "schema", path);

if (!existsSync(source)) {
  console.error(
    `${source} is missing; check out the proto submodule (git submodule update --init)`,
  );
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
