// SPDX-License-Identifier: Apache-2.0
//! Validated StructuredID identifiers.
//!
//! Every identifier here is a UUIDv7 wrapped in its own nominal type; the
//! system project and the built-in roles keep their fixed values beside it.
//! The wrapped value is private: the only way to obtain a `ProfileId` is to
//! generate one or to validate an existing UUID, so a value of the type is
//! always well-formed. Malformed, nil, max, non-RFC-4122 and wrong-version
//! values are rejected at every entry point, including database decoding;
//! corruption is an error, never a default.
//!
//! On SID's protobuf transports an identifier travels as its 16 bytes
//! (`from_slice` / `as_bytes`); the hyphenated text form (`Display` /
//! `FromStr`) is for display. Conversions to the generated protobuf messages
//! live in the crate that owns them (`sid-ids-proto`); this crate has no
//! protobuf dependency. Two identifier types with equal bytes are still
//! different types: there is no conversion between them.
//!
//! A valid identifier proves only its shape. It does not prove that the
//! entity exists, who owns it, or that the caller may act on it.

#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]
#![warn(missing_docs)]

#[cfg(feature = "alloc")]
extern crate alloc;

mod error;
mod ids;
#[cfg(any(feature = "sqlx-postgres", feature = "sqlx-sqlite"))]
mod sqlx_impl;

pub use error::{IdError, IdErrorCause, IdKind};
pub use ids::{
    AccessRequestId, ApplicationId, BindingId, BrandingConfigId, CedarPolicyId, CredentialId,
    DeviceAttestationId, DeviceEnrollmentId, DeviceId, FlowActionId, GroupId,
    ImportedPasswordUpgradeId, InitialAccessTokenId, InviteId, IssuerId, MachineUserId,
    MagicLinkId, OpaqueLoginId, OrgId, OtpSessionId, PasswordOperationId, PatId, PrincipalId,
    ProfileEmailId, ProfileId, ProfilePhoneId, ProjectId, ProvisioningConnectorId,
    ProvisioningCredentialId, ResetSessionId, ResourceId, RoleAssignmentId, RoleId, SessionId,
    StepUpChallengeId, UpstreamProviderId, check_v7, check_v7_slice,
};
pub use uuid::Uuid;

/// The README's examples run as doctests, so they stay true.
#[doc = include_str!("../README.md")]
#[cfg(doctest)]
pub struct ReadmeDoctests;

#[cfg(test)]
mod tests;
