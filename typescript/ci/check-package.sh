#!/usr/bin/env bash
# Packs @structured-id/ids as it would be published and uses it from a project
# outside this workspace: ES module and CommonJS imports, the declarations
# under strict NodeNext resolution, the carried schema, the archive contents
# and the runtime dependency closure.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail=0

cd "$ROOT"
yarn workspace @structured-id/ids pack --out "$work/ids.tgz"

# The archive holds the build, the schema, the license files and, once
# released, the changelog; nothing of the sources, tests or build scripts.
listing="$(tar -tzf "$work/ids.tgz" | sort)"
for file in dist/index.js dist/index.cjs dist/index.d.ts schema/sid/v1/ids/ids.proto \
  LICENSE NOTICE README.md package.json; do
  if grep -qx "package/$file" <<<"$listing"; then
    echo "ok   archive carries $file"
  else
    echo "FAIL archive lacks $file"
    fail=1
  fi
done
unexpected="$(grep -Ev '^package/(dist/|schema/|LICENSE$|NOTICE$|README.md$|CHANGELOG.md$|package.json$)' <<<"$listing" || true)"
if [[ -n "$unexpected" ]]; then
  echo "FAIL archive carries unexpected files:"
  echo "$unexpected" | sed 's/^/    /'
  fail=1
fi

mkdir "$work/consumer"
cp "$ROOT"/ci/consumer/* "$work/consumer/"
cd "$work/consumer"
printf '{ "name": "ids-consumer", "private": true, "version": "0.0.0" }\n' >package.json
npm install --no-audit --no-fund --omit=dev "$work/ids.tgz"

node esm.mjs || fail=1
node cjs.cjs || fail=1
if "$ROOT/node_modules/.bin/tsc" -p tsconfig.json; then
  echo "ok   declarations"
else
  echo "FAIL declarations"
  fail=1
fi

# Runtime closure: the package and the protobuf runtime, under permissive
# licenses only (every SPDX identifier of each license expression).
closure="$(npm ls --all --omit=dev --json | jq -r '.. | .dependencies? // empty | keys[]' | sort -u)"
expected="$(printf '%s\n' "@protobuf-ts/runtime" "@structured-id/ids")"
if [[ "$closure" == "$expected" ]]; then
  echo "ok   runtime closure: $(tr '\n' ' ' <<<"$closure")"
else
  echo "FAIL runtime closure:"
  echo "$closure" | sed 's/^/    /'
  fail=1
fi
permissive=' Apache-2.0 MIT BSD-2-Clause BSD-3-Clause ISC '
for pkg in $closure; do
  license="$(node -p "require('./node_modules/$pkg/package.json').license")"
  ok=1
  for id in $(tr '()' '  ' <<<"$license"); do
    [[ "$id" == AND || "$id" == OR ]] && continue
    [[ "$permissive" == *" $id "* ]] || ok=0
  done
  if [[ "$ok" == 1 ]]; then
    echo "ok   $pkg is $license"
  else
    echo "FAIL $pkg is $license"
    fail=1
  fi
done

exit "$fail"
