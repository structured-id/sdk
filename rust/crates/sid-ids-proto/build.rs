// SPDX-License-Identifier: Apache-2.0
//! Generates the `sid.v1.ids` messages from the one proto source, with a
//! pure-Rust protobuf compiler, so the build needs no `protoc`.
//!
//! `schema/sid/v1/ids/ids.proto` is a symbolic link to the canonical file in
//! the `proto` repository (the workspace's `proto` submodule); `cargo package`
//! replaces the link with the file, so the published crate carries the same
//! source and builds without any checkout around it.

use std::path::{Path, PathBuf};

/// The proto source at `path`. A checkout made with `core.symlinks=false`
/// (the Git for Windows default, also used for git dependencies there) holds
/// a symbolic link as a plain file whose only content is the link text; such
/// a file is followed to the source it names.
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
    let file = "sid/v1/ids/ids.proto";
    let link = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR")?)
        .join("schema")
        .join(file);
    let source = source_of(&link)?;
    println!("cargo:rerun-if-changed={}", link.display());
    println!("cargo:rerun-if-changed={}", source.display());

    let out_dir = PathBuf::from(std::env::var("OUT_DIR")?);
    // The source is compiled from a copy under OUT_DIR, whichever form the
    // checkout gave it; the same copy backs `PROTO_SOURCE`.
    let schema = out_dir.join("schema");
    let copy = schema.join(file);
    std::fs::create_dir_all(copy.parent().expect("a nested path"))?;
    std::fs::copy(&source, &copy)?;
    std::fs::copy(&source, out_dir.join("ids.proto"))?;

    let descriptors = protox::compile([file], [&schema])?;
    std::fs::write(
        out_dir.join("ids_descriptor.bin"),
        prost::Message::encode_to_vec(&descriptors),
    )?;
    prost_build::Config::new().compile_fds(descriptors)?;
    Ok(())
}
