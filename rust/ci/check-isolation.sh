#!/usr/bin/env bash
# Dependency isolation checks for the Rust packages of this repository.
#
# Cargo unifies features across every package built together, so a successful
# workspace build can hide a package that never declared a feature it uses: a
# neighbour enabled it. These checks build and resolve packages on their own.
#
#   closure     no server, storage or broker crate in a package's normal
#               dependency graph, for each supported feature set and target
#   combos      each supported feature combination of each package, built alone
#   packages    the packages as `cargo package` produces them, used by a
#               project outside this workspace with no proto checkout: on the
#               host (std) and on a no_std + alloc target
#   checkout    the same consumer on a clone of HEAD whose symbolic links are
#               plain files, as Git for Windows and git dependencies see them
#   all         everything above
#
# The opt-in SQL decoding features of sid-ids are built in `combos` only; they
# are not part of an identifier-only consumer's closure.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
cd "$ROOT"
# The consumers live outside this directory, where rust-toolchain.toml does
# not apply; they build with the same pinned toolchain.
RUSTUP_TOOLCHAIN="$(rustup show active-toolchain | cut -d' ' -f1)"
export RUSTUP_TOOLCHAIN

# Targets an identifier package is consumed on.
CLIENT_TARGETS=(
  x86_64-unknown-linux-gnu
  aarch64-unknown-linux-gnu
  x86_64-apple-darwin
  aarch64-apple-darwin
  x86_64-pc-windows-msvc
  aarch64-apple-ios
  aarch64-linux-android
  wasm32-unknown-unknown
)

# Crates that belong to a server, its storage or its infrastructure.
SERVER_ONLY='^(sqlx|sqlx-core|sqlx-postgres|sqlx-sqlite|sqlx-macros|sqlx-macros-core|libsqlite3-sys|tokio|async-nats|fred|tonic|sid-[a-z-]*server|sid-storage|sid-authn|sid-infra|coordinode[a-z0-9_-]*) '

# Packages and their supported identifier-only feature sets ("pkg|flags").
CLIENT_SETS=(
  "sid-ids|"
  "sid-ids|--no-default-features --features alloc"
  "sid-ids|--no-default-features --features std"
  "sid-ids-proto|"
  "sid-ids-proto|--no-default-features"
)

# Every supported feature combination ("pkg|flags"), as named in the manifests.
COMBOS=(
  "sid-ids|"
  "sid-ids|--no-default-features"
  "sid-ids|--no-default-features --features alloc"
  "sid-ids|--no-default-features --features std"
  "sid-ids|--no-default-features --features serde"
  "sid-ids|--features sqlx-postgres"
  "sid-ids|--features sqlx-sqlite"
  "sid-ids-proto|"
  "sid-ids-proto|--no-default-features"
)

# Packages published on their own and the no_std target they must build for.
PUBLISHED=(sid-ids sid-ids-proto)
NO_STD_TARGET=thumbv7em-none-eabihf

fail=0

check_closure() {
  local entry pkg flags target found
  for entry in "${CLIENT_SETS[@]}"; do
    pkg="${entry%%|*}"
    flags="${entry#*|}"
    for target in "${CLIENT_TARGETS[@]}"; do
      # shellcheck disable=SC2086
      found="$(cargo tree --locked -p "$pkg" $flags -e normal --target "$target" \
        --prefix none -f '{p}' | grep -E "$SERVER_ONLY" | sort -u || true)"
      if [[ -n "$found" ]]; then
        echo "FAIL closure $pkg [$flags] on $target pulls server-only crates:"
        echo "$found" | sed 's/^/    /'
        fail=1
      else
        echo "ok   closure $pkg [$flags] on $target"
      fi
    done
  done
}

check_combos() {
  local entry pkg flags targets
  for entry in "${COMBOS[@]}"; do
    pkg="${entry%%|*}"
    flags="${entry#*|}"
    # Tests are written for the default features, so they are built there;
    # other combinations build the library.
    targets=""
    [[ -z "$flags" ]] && targets="--all-targets"
    # shellcheck disable=SC2086
    if cargo check --locked -p "$pkg" $flags $targets; then
      echo "ok   combo $pkg [$flags]"
    else
      echo "FAIL combo $pkg [$flags]"
      fail=1
    fi
  done
}

# The consumer fixture in $1, pointed at the package sources in $2.
make_consumer() {
  cp -R "$ROOT/ci/external-consumers/ids" "$1"
  sed -i.bak "s|@PKG@|$2|g" "$1/Cargo.toml"
  rm "$1/Cargo.toml.bak"
  cp "$ROOT/Cargo.lock" "$1/Cargo.lock"
  # Every platform's dependencies, so the offline builds and the all-target
  # dependency tree below resolve without a network.
  (cd "$1" && cargo fetch --quiet)
}

check_packages() {
  local work name crate dir found file
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN
  # cargo package builds each packaged crate on its own (its verify step):
  # anything outside the crate directory, such as a path into the proto
  # submodule, fails here.
  local pkgs=()
  for name in "${PUBLISHED[@]}"; do pkgs+=(-p "$name"); done
  if ! cargo package --locked "${pkgs[@]}" --target-dir "$work/package-target"; then
    echo "FAIL packages: cargo package"
    fail=1
    return
  fi
  echo "ok   packages: cargo package ${PUBLISHED[*]}"
  # The consumer uses the unpacked .crate files, not the workspace.
  mkdir "$work/src"
  for crate in "$work"/package-target/package/*.crate; do
    tar -xzf "$crate" -C "$work/src"
  done
  for name in "${PUBLISHED[@]}"; do
    dir="$(find "$work/src" -maxdepth 1 -type d -name "$name-[0-9]*" | head -1)"
    mv "$dir" "$work/src/$name"
  done
  # Apache-2.0 4(a) and 4(d): the license text and the NOTICE travel with
  # the crate as files, not as links back into the repository.
  for name in "${PUBLISHED[@]}"; do
    for file in LICENSE NOTICE README.md; do
      if [[ -f "$work/src/$name/$file" && ! -L "$work/src/$name/$file" ]]; then
        echo "ok   packages: $name carries $file"
      else
        echo "FAIL packages: $name does not carry $file"
        fail=1
      fi
    done
  done
  if [[ -f "$work/src/sid-ids-proto/schema/sid/v1/ids/ids.proto" \
    && ! -L "$work/src/sid-ids-proto/schema/sid/v1/ids/ids.proto" ]]; then
    echo "ok   packages: sid-ids-proto carries its schema"
  else
    echo "FAIL packages: sid-ids-proto does not carry its schema"
    fail=1
  fi
  make_consumer "$work/consumer" "$work/src"
  (
    cd "$work/consumer"
    export CARGO_TARGET_DIR="$work/target"
    cargo test --offline --features std \
      && cargo test --offline \
      && cargo check --offline --target "$NO_STD_TARGET"
  ) && echo "ok   packages: consumer (std, no_std host, $NO_STD_TARGET)" || {
    echo "FAIL packages: consumer"
    fail=1
  }
  found="$(cd "$work/consumer" && cargo tree --offline --features std -e normal --target all \
    --prefix none -f '{p}' | grep -E "$SERVER_ONLY" | sort -u || true)"
  if [[ -n "$found" ]]; then
    echo "FAIL packages: consumer pulls server-only crates:"
    echo "$found" | sed 's/^/    /'
    fail=1
  fi
}

check_checkout() {
  local work link
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN
  # Git for Windows defaults to core.symlinks=false: a symbolic link is checked
  # out as a plain file holding the link text. A git dependency or a Windows
  # clone builds the published crates from such a checkout of HEAD.
  git clone --quiet -c core.symlinks=false "$REPO" "$work/sdk"
  link="$work/sdk/rust/crates/sid-ids-proto/schema/sid/v1/ids/ids.proto"
  if [[ ! -f "$link" || -L "$link" ]]; then
    echo "FAIL checkout: the schema link is not checked out as a plain file"
    fail=1
    return
  fi
  # The submodule as HEAD records it, without a network fetch.
  mkdir -p "$work/sdk/proto"
  git -C "$REPO/proto" archive "$(git -C "$REPO" rev-parse HEAD:proto)" | tar -x -C "$work/sdk/proto"
  make_consumer "$work/consumer" "$work/sdk/rust/crates"
  if (cd "$work/consumer" && CARGO_TARGET_DIR="$work/target" cargo test --offline --features std); then
    echo "ok   checkout: consumer of a checkout without symbolic links"
  else
    echo "FAIL checkout: consumer of a checkout without symbolic links"
    fail=1
  fi
}

case "${1:-all}" in
  closure) check_closure ;;
  combos) check_combos ;;
  packages) check_packages ;;
  checkout) check_checkout ;;
  all) check_closure; check_combos; check_packages; check_checkout ;;
  *) echo "usage: $0 [closure|combos|packages|checkout|all]"; exit 2 ;;
esac

exit "$fail"
