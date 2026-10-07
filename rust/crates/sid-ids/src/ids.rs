// SPDX-License-Identifier: Apache-2.0
//! The identifier types and the one validation they share.

use core::fmt;
use core::str::FromStr;

use uuid::{Uuid, Variant};

use crate::error::{IdError, IdErrorCause, IdKind};

/// The only accepted shape: a non-nil, non-max, RFC 4122 UUID of version 7.
pub(crate) fn validate(uuid: Uuid, kind: IdKind) -> Result<Uuid, IdError> {
    if uuid.is_nil() {
        return Err(IdError::new(kind, IdErrorCause::Nil));
    }
    if uuid.is_max() {
        return Err(IdError::new(kind, IdErrorCause::Max));
    }
    if uuid.get_variant() != Variant::RFC4122 {
        return Err(IdError::new(kind, IdErrorCause::Variant));
    }
    match uuid.get_version_num() {
        7 => Ok(uuid),
        other => Err(IdError::new(kind, IdErrorCause::Version(other))),
    }
}

pub(crate) fn parse(text: &str, kind: IdKind) -> Result<Uuid, IdError> {
    let uuid = Uuid::try_parse(text).map_err(|_| IdError::new(kind, IdErrorCause::Malformed))?;
    validate(uuid, kind)
}

macro_rules! define_id {
    ($(#[$doc:meta])* $name:ident, $kind:expr) => {
        $(#[$doc])*
        ///
        /// A value of this type is always a valid UUIDv7: construction goes
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
                validate(uuid, Self::KIND).map(Self)
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
                parse(text, Self::KIND).map(Self)
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
