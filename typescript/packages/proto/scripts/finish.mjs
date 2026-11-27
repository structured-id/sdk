// Finishes the generated modules after `buf generate`:
//
// - sid/v1/ids/ids.ts is replaced by a module that re-exports the message
//   objects of @structured-id/ids, so the identifier messages have one owner
//   and one identity in every consumer.
// - sid/v1/admin/admin_roles.ts keeps exporting AssuranceLevel, which the
//   schema declares in login_policy_types.proto: the module re-exports the
//   enum of that file, so both paths name one object.
// - Relative imports get their `.js` extension, which ES modules in Node
//   resolve and bundlers accept.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const generated = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "generated");
const idsModule = join(generated, "sid", "v1", "ids", "ids.ts");

const names = [
  ...readFileSync(idsModule, "utf8").matchAll(/^export const (\w+) = new \1\$Type\(\);$/gm),
].map((m) => m[1]);
if (names.length === 0) {
  console.error(`${idsModule}: no message types found`);
  process.exit(1);
}
writeFileSync(
  idsModule,
  [
    "// The sid.v1.ids messages are owned by @structured-id/ids; this module",
    "// re-exports its objects so generated messages that carry an identifier",
    "// share them instead of a second generated copy.",
    'import type { MessageType } from "@protobuf-ts/runtime";',
    'import { wire } from "@structured-id/ids";',
    "",
    ...names.flatMap((name) => [
      `export const ${name}: MessageType<wire.${name}> = wire.${name};`,
      `export type ${name} = wire.${name};`,
    ]),
    "",
  ].join("\n"),
);

const adminRoles = join(generated, "sid", "v1", "admin", "admin_roles.ts");
const reexport = 'export { AssuranceLevel } from "./login_policy_types";';
const roles = readFileSync(adminRoles, "utf8");
if (/^export enum AssuranceLevel\b/m.test(roles)) {
  console.error(`${adminRoles}: declares AssuranceLevel itself; the re-export is obsolete`);
  process.exit(1);
}
if (!roles.includes(reexport)) writeFileSync(adminRoles, `${roles}${reexport}\n`);

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (path.endsWith(".ts")) yield path;
  }
}

for (const file of files(generated)) {
  const source = readFileSync(file, "utf8");
  const fixed = source.replace(/(from ")(\.{1,2}\/[^"]+?)(")/g, (match, open, path, close) =>
    path.endsWith(".js") ? match : `${open}${path}.js${close}`,
  );
  if (fixed !== source) writeFileSync(file, fixed);
}
