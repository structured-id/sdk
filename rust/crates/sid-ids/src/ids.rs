// SPDX-License-Identifier: Apache-2.0
//! The identifier types and the one validation they share.

use core::fmt;
use core::str::FromStr;

use uuid::{Uuid, Variant};

use crate::error::{IdError, IdErrorCause, IdKind};

/// The identifier shape on its own, for identifier kinds defined outside this
/// crate: a non-nil, non-max, RFC 9562 variant UUID of version 7, or why not.
pub fn check_v7(uuid: Uuid) -> Result<Uuid, IdErrorCause> {
    if uuid.is_nil() {
        return Err(IdErrorCause::Nil);
    }
    if uuid.is_max() {
        return Err(IdErrorCause::Max);
    }
    if uuid.get_variant() != Variant::RFC4122 {
        return Err(IdErrorCause::Variant);
    }
    match uuid.get_version_num() {
        7 => Ok(uuid),
        other => Err(IdErrorCause::Version(other)),
    }
}

/// [`check_v7`] of a binary wire value, which must be exactly 16 bytes.
pub fn check_v7_slice(bytes: &[u8]) -> Result<Uuid, IdErrorCause> {
    let bytes: [u8; 16] = bytes
        .try_into()
        .map_err(|_| IdErrorCause::Length(bytes.len()))?;
    check_v7(Uuid::from_bytes(bytes))
}

/// The system project's identifier: the nil UUID, the one project id that
/// is not a UUIDv7.
const SYSTEM_PROJECT: Uuid = Uuid::nil();

/// A project's shape: [`check_v7`], or the system project.
fn check_project(uuid: Uuid) -> Result<Uuid, IdErrorCause> {
    if uuid == SYSTEM_PROJECT {
        return Ok(uuid);
    }
    check_v7(uuid)
}

/// Whether `uuid` is in the space of built-in roles: the first 15 bytes zero,
/// the last one not.
const fn is_builtin_role(uuid: &Uuid) -> bool {
    let bytes = uuid.as_bytes();
    let mut i = 0;
    while i < 15 {
        if bytes[i] != 0 {
            return false;
        }
        i += 1;
    }
    bytes[15] != 0
}

/// A role's shape: [`check_v7`], or a built-in role.
fn check_role(uuid: Uuid) -> Result<Uuid, IdErrorCause> {
    if is_builtin_role(&uuid) {
        return Ok(uuid);
    }
    check_v7(uuid)
}

/// `check`'s verdict on `uuid`, reported for `kind`.
pub(crate) fn validate_with(
    uuid: Uuid,
    kind: IdKind,
    check: fn(Uuid) -> Result<Uuid, IdErrorCause>,
) -> Result<Uuid, IdError> {
    check(uuid).map_err(|cause| IdError::new(kind, cause))
}

pub(crate) fn parse(
    text: &str,
    kind: IdKind,
    check: fn(Uuid) -> Result<Uuid, IdErrorCause>,
) -> Result<Uuid, IdError> {
    let uuid = Uuid::try_parse(text).map_err(|_| IdError::new(kind, IdErrorCause::Malformed))?;
    validate_with(uuid, kind, check)
}

macro_rules! define_id {
    ($(#[$doc:meta])* $name:ident, $kind:expr) => {
        define_id! { $(#[$doc])* $name, $kind, check_v7 }
    };
    ($(#[$doc:meta])* $name:ident, $kind:expr, $check:path) => {
        $(#[$doc])*
        ///
        /// A value of this type always has its kind's shape: construction goes
        /// through validation and the wrapped value is private.
        #[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub struct $name(Uuid);

        impl $name {
            /// Which identifier kind this type is, for error reporting.
            pub const KIND: IdKind = $kind;

            /// Mint a fresh time-ordered identifier.
            #[cfg(feature = "std")]
            #[must_use]
            pub fn generate() -> Self {
                Self(Uuid::now_v7())
            }

            /// Accept an existing UUID as this identifier, or say why not.
            pub fn from_uuid(uuid: Uuid) -> Result<Self, IdError> {
                validate_with(uuid, Self::KIND, $check).map(Self)
            }

            /// Accept 16 big-endian bytes as this identifier, or say why not.
            pub fn from_bytes(bytes: [u8; 16]) -> Result<Self, IdError> {
                Self::from_uuid(Uuid::from_bytes(bytes))
            }

            /// Accept the binary wire form, a byte string that must be exactly
            /// 16 big-endian bytes, or say why not.
            pub fn from_slice(bytes: &[u8]) -> Result<Self, IdError> {
                let bytes: [u8; 16] = bytes
                    .try_into()
                    .map_err(|_| IdError::new(Self::KIND, IdErrorCause::Length(bytes.len())))?;
                Self::from_bytes(bytes)
            }

            /// Parse the textual UUID forms `uuid` accepts (hyphenated, simple, braced, URN).
            pub fn parse(text: &str) -> Result<Self, IdError> {
                parse(text, Self::KIND, $check).map(Self)
            }

            /// The wrapped UUID.
            #[must_use]
            pub const fn as_uuid(&self) -> &Uuid {
                &self.0
            }

            /// The wrapped UUID by value.
            #[must_use]
            pub const fn into_uuid(self) -> Uuid {
                self.0
            }

            /// The 16 big-endian bytes.
            #[must_use]
            pub const fn as_bytes(&self) -> &[u8; 16] {
                self.0.as_bytes()
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}({})", Self::KIND.type_name(), self.0.hyphenated())
            }
        }

        impl fmt::Display for $name {
            /// Lowercase hyphenated form, the wire and JSON representation.
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                fmt::Display::fmt(&self.0.hyphenated(), f)
            }
        }

        impl FromStr for $name {
            type Err = IdError;

            fn from_str(text: &str) -> Result<Self, IdError> {
                Self::parse(text)
            }
        }

        impl TryFrom<Uuid> for $name {
            type Error = IdError;

            fn try_from(uuid: Uuid) -> Result<Self, IdError> {
                Self::from_uuid(uuid)
            }
        }

        impl TryFrom<&str> for $name {
            type Error = IdError;

            fn try_from(text: &str) -> Result<Self, IdError> {
                Self::parse(text)
            }
        }

        #[cfg(feature = "alloc")]
        impl TryFrom<alloc::string::String> for $name {
            type Error = IdError;

            fn try_from(text: alloc::string::String) -> Result<Self, IdError> {
                Self::parse(&text)
            }
        }

        impl From<$name> for Uuid {
            fn from(id: $name) -> Uuid {
                id.0
            }
        }

        impl AsRef<Uuid> for $name {
            fn as_ref(&self) -> &Uuid {
                &self.0
            }
        }

        #[cfg(feature = "serde")]
        impl serde::Serialize for $name {
            /// Same representation as `Uuid`: a hyphenated string in
            /// human-readable formats, 16 bytes otherwise.
            fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                self.0.serialize(serializer)
            }
        }

        #[cfg(feature = "serde")]
        impl<'de> serde::Deserialize<'de> for $name {
            fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                let uuid = Uuid::deserialize(deserializer)?;
                Self::from_uuid(uuid).map_err(serde::de::Error::custom)
            }
        }
    };
}

define_id! {
    /// A user's Profile within an instance. Internal to the instance:
    /// never exposed to an external service, which sees a pairwise binding instead.
    ProfileId, IdKind::Profile
}

define_id! {
    /// A device enrolled to a Profile. Describes a record, not an acting principal.
    DeviceId, IdKind::Device
}

define_id! {
    /// An authenticated session.
    SessionId, IdKind::Session
}

define_id! {
    /// A non-human actor with its own credentials: a service, a bot or an agent.
    MachineUserId, IdKind::MachineUser
}

define_id! {
    /// A Profile's identity at one organization: the pairwise `sub` and the
    /// Binding Passport subject there. Opaque and unlinkable across
    /// organizations; carries no prefix.
    BindingId, IdKind::Binding
}

define_id! {
    /// An organization, fixed at its creation. Keys pairwise bindings: every
    /// service of one organization sees the same BindingId for a Profile.
    OrgId, IdKind::Organization
}

define_id! {
    /// A logical OIDC issuer: one issuing authority for one recipient
    /// organization. Internal; the public URL names it by an opaque handle.
    IssuerId, IdKind::Issuer
}

define_id! {
    /// A managed application: the container of an OAuth client role, a
    /// protected resource role, or both.
    ApplicationId, IdKind::Application
}

define_id! {
    /// A protected resource registration. Internal; outside SID a resource is
    /// named by its resource indicator URI, which is the token audience.
    ResourceId, IdKind::Resource
}

define_id! {
    /// One password-installing operation (a registration, change or authorized
    /// reset) from its preparation to its commit. Retries of the operation carry
    /// it, so a lost response resolves to the same outcome instead of a second one.
    PasswordOperationId, IdKind::PasswordOperation
}

define_id! {
    /// A provisioning connector: one directory source (an HR system or IdP
    /// sending SCIM to this installation) or one downstream target, acting as
    /// its own non-human actor with its own credentials and grants. Neither a
    /// Profile nor a machine user.
    ProvisioningConnectorId, IdKind::ProvisioningConnector
}

define_id! {
    /// One credential of a provisioning connector: the reference listings,
    /// rotations, revocations and audit records name. Never the secret.
    ProvisioningCredentialId, IdKind::ProvisioningCredential
}

define_id! {
    /// One OPAQUE login (RFC 9807 §6) from its start to its finish: the
    /// reference to the login state the server keeps between the two steps,
    /// never a part of that state.
    OpaqueLoginId, IdKind::OpaqueLogin
}

define_id! {
    /// One authentication credential of a Profile (a password, passkey, TOTP
    /// or recovery code set): the reference management and change operations
    /// name. Never the secret, nor an authenticator's WebAuthn credential ID.
    CredentialId, IdKind::Credential
}

define_id! {
    /// One emailed one-time code from its request to its verification: the
    /// reference verify and resend carry, never a part of the code.
    OtpSessionId, IdKind::OtpSession
}

define_id! {
    /// One magic link from its request to its verification: the reference
    /// the link carries beside its secret token, which alone authorizes.
    MagicLinkId, IdKind::MagicLink
}

define_id! {
    /// One two-phase step-up of a session from its challenge to its
    /// completion: the reference to the challenge kept for that session.
    StepUpChallengeId, IdKind::StepUpChallenge
}

define_id! {
    /// One password reset from its emailed link to its completion: the
    /// reference the link carries beside its secret token, which alone
    /// authorizes.
    ResetSessionId, IdKind::ResetSession
}

define_id! {
    /// One upgrade of an imported password to OPAQUE from its start to its
    /// finish: the reference to the upgrade state kept between the two steps.
    ImportedPasswordUpgradeId, IdKind::ImportedPasswordUpgrade
}

define_id! {
    /// One login handle of a Profile (an email, phone or username it signs in
    /// with): the reference its management names. Not the handle's value.
    PrincipalId, IdKind::Principal
}

define_id! {
    /// One email address recorded for a Profile, a contact that may or may
    /// not be a login handle: the reference its management names.
    ProfileEmailId, IdKind::ProfileEmail
}

define_id! {
    /// One phone number recorded for a Profile, a contact that may or may
    /// not be a login handle: the reference its management names.
    ProfilePhoneId, IdKind::ProfilePhone
}

define_id! {
    /// A project of an installation: the scope its roles, groups and
    /// policies belong to. A UUIDv7, or the nil UUID of the system project
    /// every installation has.
    ProjectId, IdKind::Project, check_project
}

impl ProjectId {
    /// The installation's system project.
    pub const SYSTEM: Self = Self(SYSTEM_PROJECT);

    /// Whether this is the system project.
    #[must_use]
    pub fn is_system(&self) -> bool {
        self.0 == SYSTEM_PROJECT
    }
}

define_id! {
    /// A role of a project: the named set of permissions an assignment
    /// grants. A UUIDv7, or a built-in role every installation has: 15 zero
    /// bytes and a nonzero last one.
    RoleId, IdKind::Role, check_role
}

impl RoleId {
    /// The built-in role `number`, the same in every installation.
    #[must_use]
    pub const fn builtin(number: core::num::NonZeroU8) -> Self {
        Self(Uuid::from_u128(number.get() as u128))
    }

    /// Whether this is a built-in role.
    #[must_use]
    pub const fn is_builtin(&self) -> bool {
        is_builtin_role(&self.0)
    }
}

define_id! {
    /// A group of a project whose members hold the roles assigned to it.
    GroupId, IdKind::Group
}

define_id! {
    /// One assignment of a role to a principal: the reference its
    /// revocation, administration and audit name.
    RoleAssignmentId, IdKind::RoleAssignment
}

define_id! {
    /// One Cedar policy of a scope: the reference its management names. Not
    /// its name, which is unique within the scope only.
    CedarPolicyId, IdKind::CedarPolicy
}

define_id! {
    /// One request for a role from its submission to its decision.
    AccessRequestId, IdKind::AccessRequest
}

define_id! {
    /// One initial access token for dynamic client registration (RFC 7591
    /// §3): the reference its listing and revocation name. Never the bearer
    /// value.
    InitialAccessTokenId, IdKind::InitialAccessToken
}

define_id! {
    /// One personal access token of a Profile: the reference its listing,
    /// revocation and audit name. Never the token itself.
    PatId, IdKind::Pat
}
