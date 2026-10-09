#!/usr/bin/env bash
# Publish each release from its own tag, serially: ids must exist before proto.
# The packed registry gate also protects against separate overlapping runs.
set -euo pipefail

publish_releases() {
  local tag package dir name version
  local -a tags
  if [[ -n "${DISPATCH_TAG:-}" ]]; then
    tags=("$DISPATCH_TAG")
  else
    # Validate before checkout/build; these are release-please outputs, not code.
    jq -e 'type == "array" and all(.[]; type == "string" and test("^typescript-(ids|proto)-v[0-9]+\\.[0-9]+\\.[0-9]+$"))' <<<"$TAGS" >/dev/null
    while IFS= read -r tag; do tags+=("$tag"); done < <(jq -r 'sort | .[]' <<<"$TAGS")
  fi
  for tag in "${tags[@]}"; do
    if [[ ! "$tag" =~ ^typescript-(ids|proto)-v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "Unsupported release tag: $tag" >&2
      return 1
    fi
    git checkout --detach "refs/tags/$tag"
    git submodule update --init --recursive
    package="${tag#typescript-}"
    package="${package%-v*}"
    dir="packages/$package"
    name="$(node -p "require('./$dir/package.json').name")"
    version="$(node -p "require('./$dir/package.json').version")"
    if [[ "$tag" != "typescript-$package-v$version" ]]; then
      echo "Release tag $tag does not name $name $version." >&2
      return 1
    fi
    if npm view "$name@$version" version >/dev/null 2>&1; then
      echo "$name@$version is already published; nothing to do."
      continue
    fi
    corepack install
    yarn install --immutable
    yarn build
    yarn test
    yarn workspace "$name" pack --out "$RUNNER_TEMP/package.tgz"
    node ci/check-publish-dependencies.mjs "$RUNNER_TEMP/package.tgz"
    npm publish "$RUNNER_TEMP/package.tgz" --access public --provenance
  done
}

publish_releases
