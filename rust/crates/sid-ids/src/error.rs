// SPDX-License-Identifier: Apache-2.0
//! Validation errors for identifiers.

use core::fmt;

/// Which identifier type a value was validated as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum IdKind {
    /// A user's Profile within an instance.
    Profile,
    /// A device enrolled to a Profile.
    Device,
    /// An authenticated session.
    Session,
    /// A non-human actor (service, bot, agent).
    MachineUser,
    /// A Profile's pairwise identity at one organization.
    Binding,
    /// An organization.
    Organization,
    /// A logical OIDC issuer.
    Issuer,
    /// A managed application registration.
    Application,
    /// A protected resource registration.
    Resource,
    /// One password-installing operation: a registration, change or reset.
    PasswordOperation,
    /// A provisioning connector: a directory source or target acting as its
    /// own actor.
    ProvisioningConnector,
    /// One credential of a provisioning connector.
    ProvisioningCredential,
}

impl IdKind {
    /// The Rust type name of the identifier, as written in code.
    pub const fn type_name(self) -> &'static str {
        match self {
            Self::Profile => "ProfileId",
            Self::Device => "DeviceId",
            Self::Session => "SessionId",
            Self::MachineUser => "MachineUserId",
            Self::Binding => "BindingId",
            Self::Organization => "OrgId",
            Self::Issuer => "IssuerId",
            Self::Application => "ApplicationId",
            Self::Resource => "ResourceId",
            Self::PasswordOperation => "PasswordOperationId",
            Self::ProvisioningConnector => "ProvisioningConnectorId",
            Self::ProvisioningCredential => "ProvisioningCredentialId",
        }
    }
}

impl fmt::Display for IdKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.type_name())
    }
}

/// Why a value was rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum IdErrorCause {
    /// The text is not a UUID in any accepted textual form.
    Malformed,
    /// Binary form of a length other than 16 bytes (the length found).
    Length(usize),
    /// The nil UUID (all zero bits). Never a real identifier.
    Nil,
    /// The max UUID (all one bits). Never a real identifier.
    Max,
    /// The variant bits are not RFC 4122.
    Variant,
    /// An RFC 4122 UUID of a version other than 7.
    Version(usize),
}

impl fmt::Display for IdErrorCause {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Malformed => f.write_str("not a UUID"),
            Self::Length(n) => write!(f, "{n} bytes, expected 16"),
            Self::Nil => f.write_str("the nil UUID"),
            Self::Max => f.write_str("the max UUID"),
            Self::Variant => f.write_str("not an RFC 4122 UUID"),
            Self::Version(v) => write!(f, "UUID version {v}, expected version 7"),
        }
    }
}

/// A value that is not a valid identifier of the requested kind.
///
/// Carries which kind was expected and why the value failed, and nothing of
/// the value itself, so it can be logged and returned to callers freely.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct IdError {
    kind: IdKind,
    cause: IdErrorCause,
}

impl IdError {
    pub(crate) const fn new(kind: IdKind, cause: IdErrorCause) -> Self {
        Self { kind, cause }
    }

    /// The identifier type the value was validated as.
    pub const fn kind(&self) -> IdKind {
        self.kind
    }

    /// Why the value was rejected.
    pub const fn cause(&self) -> IdErrorCause {
        self.cause
    }
}

impl fmt::Display for IdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid {}: {}", self.kind, self.cause)
    }
}

impl core::error::Error for IdError {}
