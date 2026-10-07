// SPDX-License-Identifier: Apache-2.0
//! StructuredID identifier messages (`sid.v1.ids`) and their conversions.
//!
//! The generated messages are wire DTOs: decoding one proves nothing about its
//! bytes. Every conversion to a domain identifier goes through the one
//! validation in `sid-ids` (exactly 16 bytes of an RFC 9562 UUIDv7, not nil
//! or max). A `BindingId` and a `MachineUserId` with equal bytes stay two
//! types here as in `sid-ids`; there is no conversion between them.
//!
//! A consumer that references these messages from its own `.proto` files
//! compiles against [`PROTO_SOURCE`] (placed at [`PROTO_PATH`] under an
//! include root) and maps the package to this crate, so one Rust type exists
//! per identifier: `extern_path(".sid.v1.ids", "::sid_ids_proto::sid::v1::ids")`.

#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

extern crate alloc;

use sid_ids::{IdError, IdKind};

/// The generated messages, at the path of their protobuf package.
pub mod sid {
    /// `sid.v1`
    pub mod v1 {
        /// `sid.v1.ids`
        #[allow(missing_docs)]
        pub mod ids {
            include!(concat!(env!("OUT_DIR"), "/sid.v1.ids.rs"));
        }
    }
}

pub use sid::v1::ids::{
    BindingId, MachineUserId, PasswordOperationId, ProvisioningConnectorId,
    ProvisioningCredentialId, ResourceId,
};

/// The include-relative path of the identifier proto file.
pub const PROTO_PATH: &str = "sid/v1/ids/ids.proto";

/// The identifier proto file these messages were generated from, byte for byte.
pub const PROTO_SOURCE: &str = include_str!(concat!(env!("OUT_DIR"), "/ids.proto"));

/// Encoded `FileDescriptorSet` of [`PROTO_SOURCE`], for reflection-based
/// standard ProtoJSON (for example `prost-reflect`).
pub const FILE_DESCRIPTOR_SET: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/ids_descriptor.bin"));

/// Why an identifier field could not become its domain identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireIdError {
    /// A required identifier message was absent.
    Missing(IdKind),
    /// The message was present but its bytes are not a valid identifier.
    Invalid(IdError),
}

impl core::fmt::Display for WireIdError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Missing(kind) => write!(f, "missing {kind}"),
            Self::Invalid(err) => core::fmt::Display::fmt(err, f),
        }
    }
}

impl core::error::Error for WireIdError {}

impl From<IdError> for WireIdError {
    fn from(err: IdError) -> Self {
        Self::Invalid(err)
    }
}

/// An identifier message and the domain identifier it carries.
pub trait WireId: Sized {
    /// The validated `sid-ids` type.
    type Domain;
    /// The domain kind, for errors.
    const KIND: IdKind;
    /// Validate this message's bytes as the domain identifier.
    fn to_domain(&self) -> Result<Self::Domain, IdError>;
}

/// The domain identifier of a required message field (`Option` in prost):
/// absence is an error, never a default.
pub fn required<W: WireId>(field: Option<&W>) -> Result<W::Domain, WireIdError> {
    field
        .ok_or(WireIdError::Missing(W::KIND))?
        .to_domain()
        .map_err(WireIdError::Invalid)
}

macro_rules! wire_id {
    ($wire:ident, $domain:ty) => {
        impl WireId for $wire {
            type Domain = $domain;
            const KIND: IdKind = <$domain>::KIND;
            fn to_domain(&self) -> Result<$domain, IdError> {
                <$domain>::from_slice(&self.value)
            }
        }

        impl From<$domain> for $wire {
            fn from(id: $domain) -> Self {
                Self {
                    value: id.as_bytes().to_vec(),
                }
            }
        }

        impl TryFrom<&$wire> for $domain {
            type Error = IdError;
            fn try_from(wire: &$wire) -> Result<Self, IdError> {
                wire.to_domain()
            }
        }

        impl TryFrom<$wire> for $domain {
            type Error = IdError;
            fn try_from(wire: $wire) -> Result<Self, IdError> {
                wire.to_domain()
            }
        }
    };
}

wire_id!(BindingId, sid_ids::BindingId);
wire_id!(MachineUserId, sid_ids::MachineUserId);
wire_id!(PasswordOperationId, sid_ids::PasswordOperationId);
wire_id!(ProvisioningConnectorId, sid_ids::ProvisioningConnectorId);
wire_id!(ProvisioningCredentialId, sid_ids::ProvisioningCredentialId);
wire_id!(ResourceId, sid_ids::ResourceId);

/// The README's examples run as doctests, so they stay true.
#[doc = include_str!("../README.md")]
#[cfg(doctest)]
pub struct ReadmeDoctests;

#[cfg(test)]
mod tests;
