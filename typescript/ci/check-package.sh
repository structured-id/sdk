#!/usr/bin/env bash
# Packs every TypeScript package as it would be published and uses it from a
# project outside this workspace: module imports, the declarations under strict
# NodeNext resolution, the archive contents and the runtime dependency closure
# with its licenses.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail=0

cd "$ROOT"
yarn workspace @structured-id/ids pack --out "$work/ids.tgz"
yarn workspace @structured-id/proto pack --out "$work/proto.tgz"

# check_archive <tgz> <allowed path regex> <required file>...: the archive holds
# the build, the license files and, once released, the changelog; nothing of
# the sources, tests or build scripts.
check_archive() {
  local tgz="$1" allowed="$2"
  shift 2
  local listing unexpected
  listing="$(tar -tzf "$tgz" | sort)"
  for file in "$@" LICENSE NOTICE README.md package.json; do
    if grep -qx "package/$file" <<<"$listing"; then
      echo "ok   $(basename "$tgz") carries $file"
    else
      echo "FAIL $(basename "$tgz") lacks $file"
      fail=1
    fi
  done
  unexpected="$(grep -Ev "^package/($allowed|LICENSE\$|NOTICE\$|README.md\$|CHANGELOG.md\$|package.json\$)" <<<"$listing" || true)"
  if [[ -n "$unexpected" ]]; then
    echo "FAIL $(basename "$tgz") carries unexpected files:"
    echo "$unexpected" | sed 's/^/    /'
    fail=1
  fi
}

check_archive "$work/ids.tgz" 'dist/|schema/' \
  dist/index.js dist/index.cjs dist/index.d.ts schema/sid/v1/ids/ids.proto
# The generated tree is checked by the consumer's imports below; .ts sources
# and tests must not ship.
check_archive "$work/proto.tgz" 'dist/.*\.(js|js\.map|d\.ts)$' \
  dist/transport/index.js dist/transport/index.d.ts \
  dist/generated/sid/v1/ids/ids.js dist/generated/google/rpc/status.js

# consume <name> <expected closure>...: installs the packed packages into a
# fresh project with that package's consumer files and runs them.
consume() {
  local name="$1"
  shift
  local dir="$work/$name-consumer" closure expected
  mkdir "$dir"
  cp "$ROOT/ci/$name-consumer/"* "$dir/"
  (
    cd "$dir"
    printf '{ "name": "%s-consumer", "private": true, "version": "0.0.0" }\n' "$name" >package.json
    # Both archives: the proto package depends on the ids package of this
    # checkout, not on a published one.
    npm install --no-audit --no-fund --omit=dev "$work/ids.tgz" "$work/proto.tgz" >/dev/null
  )
  (cd "$dir" && node esm.mjs) || fail=1
  (cd "$dir" && node cjs.cjs) || fail=1
  if "$ROOT/node_modules/.bin/tsc" -p "$dir/tsconfig.json"; then
    echo "ok   $name declarations"
  else
    echo "FAIL $name declarations"
    fail=1
  fi
}

consume ids
consume proto

# Runtime closure of both packages: the packages and the protobuf runtime,
# under permissive licenses only (every SPDX identifier of each expression).
cd "$work/proto-consumer"
closure="$(npm ls --all --omit=dev --json | jq -r '.. | .dependencies? // empty | keys[]' | sort -u)"
expected="$(printf '%s\n' "@protobuf-ts/grpcweb-transport" "@protobuf-ts/runtime" "@protobuf-ts/runtime-rpc" \
  "@structured-id/ids" "@structured-id/proto")"
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
