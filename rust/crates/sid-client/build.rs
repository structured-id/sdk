// SPDX-License-Identifier: Apache-2.0
//! Generates the AuthService client (no server) and its messages from the one
//! proto source, with a pure-Rust protobuf compiler, so the build needs no
//! `protoc` and no SID server crate.
//!
//! The files under `schema/` are symbolic links to the canonical files in the
//! `proto` repository (the workspace's `proto` submodule); `cargo package`
//! replaces the links with the files, so the published crate carries the same
//! sources and builds without any checkout around it.

use std::path::{Path, PathBuf};

/// The schema files the AuthService closure reads, below `schema/`.
const SCHEMA: [&str; 7] = [
    "sid/v1/authn/auth.proto",
    "sid/v1/authn/native_session.proto",
    "sid/v1/authn/password_history.proto",
    "sid/v1/common/operation.proto",
    "sid/v1/ids/ids.proto",
    "google/api/annotations.proto",
    "google/api/http.proto",
];

/// The proto source at `path`. A checkout made with `core.symlinks=false`
/// (the Git for Windows default) holds a symbolic link as a plain file whose
/// only content is the link text; such a file is followed to the source it
/// names.
fn source_of(path: &Path) -> std::io::Result<PathBuf> {
    let text = std::fs::read(path)?;
    let link = std::str::from_utf8(&text)
        .ok()
        .filter(|t| !t.contains('\n') && t.ends_with(".proto"));
    if let Some(link) = link {
        let target = path
            .parent()
            .expect("the schema file has a parent")
            .join(link);
        if target.is_file() {
            return Ok(target);
        }
    }
    Ok(path.to_path_buf())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR")?);
    let out_dir = PathBuf::from(std::env::var("OUT_DIR")?);
    // Compiled from copies under OUT_DIR, whichever form the checkout gave.
    let schema = out_dir.join("schema");
    for file in SCHEMA {
        let link = manifest.join("schema").join(file);
        let source = source_of(&link)?;
        println!("cargo:rerun-if-changed={}", link.display());
        println!("cargo:rerun-if-changed={}", source.display());
        let copy = schema.join(file);
        std::fs::create_dir_all(copy.parent().expect("a nested path"))?;
        std::fs::copy(&source, &copy)?;
    }

    let descriptors = protox::compile(["sid/v1/authn/auth.proto"], [&schema])?;
    tonic_prost_build::configure()
        .build_server(false)
        .build_client(true)
        .build_transport(false)
        .extern_path(".sid.v1.ids", "::sid_ids_proto::sid::v1::ids")
        .compile_fds(descriptors)?;
    Ok(())
}
