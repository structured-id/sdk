// SPDX-License-Identifier: Apache-2.0
//! Behaviour of the identifier types: what is accepted, what is refused and
//! why, and that the wire form is the plain UUID string.

use core::str::FromStr;

use uuid::{Builder, Uuid, Variant, Version};

use crate::{
    AccessRequestId, ApplicationId, BindingId, CedarPolicyId, CredentialId, DeviceId, GroupId,
    IdErrorCause, IdKind, ImportedPasswordUpgradeId, InitialAccessTokenId, IssuerId, MachineUserId,
    MagicLinkId, OpaqueLoginId, OrgId, OtpSessionId, PasswordOperationId, PatId, PrincipalId,
    ProfileEmailId, ProfileId, ProfilePhoneId, ProjectId, ProvisioningConnectorId,
    ProvisioningCredentialId, ResetSessionId, ResourceId, RoleAssignmentId, RoleId, SessionId,
    StepUpChallengeId,
};

/// A fixed, valid UUIDv7 (RFC 4122 variant, version 7), for deterministic tests.
const V7: &str = "0192f3a4-7c1e-7b2a-9d4e-3f5a6b7c8d9e";
/// A version-4 UUID: valid RFC 4122, wrong version.
const V4: &str = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
/// A version-1 UUID.
const V1: &str = "c232ab00-9414-11ec-b3c8-9f6bdeced846";

/// The same 16 bytes as V7 with the variant bits set to the Microsoft (NCS
/// backward-compatible) variant instead of RFC 4122.
fn non_rfc_variant() -> Uuid {
    Builder::from_bytes(*Uuid::parse_str(V7).unwrap().as_bytes())
        .with_variant(Variant::Microsoft)
        .into_uuid()
}

// --- the shared shape check ------------------------------------------------

#[test]
fn the_shape_check_is_the_one_every_kind_applies() {
    // Kinds defined outside this crate validate with the same rule, so a
    // value one accepts is never one another refuses.
    let v7 = Uuid::parse_str(V7).unwrap();
    assert_eq!(crate::check_v7(v7), Ok(v7));
    assert_eq!(crate::check_v7_slice(v7.as_bytes()), Ok(v7));
    assert_eq!(crate::check_v7(Uuid::nil()), Err(IdErrorCause::Nil));
    assert_eq!(crate::check_v7(Uuid::max()), Err(IdErrorCause::Max));
    assert_eq!(
        crate::check_v7(Uuid::parse_str(V4).unwrap()),
        Err(IdErrorCause::Version(4))
    );
    assert_eq!(
        crate::check_v7(non_rfc_variant()),
        Err(IdErrorCause::Variant)
    );
    assert_eq!(
        crate::check_v7_slice(&v7.as_bytes()[..15]),
        Err(IdErrorCause::Length(15))
    );
    for uuid in [Uuid::nil(), Uuid::parse_str(V4).unwrap(), v7] {
        assert_eq!(
            crate::check_v7(uuid).err(),
            ProfileId::from_uuid(uuid).err().map(|e| e.cause())
        );
    }
}

// --- accepted values -------------------------------------------------------

#[test]
fn valid_v7_is_accepted_and_round_trips_by_value() {
    // Bug prevented: an accepted identifier must keep its exact bytes.
    let uuid = Uuid::parse_str(V7).unwrap();
    let id = ProfileId::from_uuid(uuid).unwrap();
    assert_eq!(id.into_uuid(), uuid);
    assert_eq!(*id.as_uuid(), uuid);
    assert_eq!(id.as_bytes(), uuid.as_bytes());
    assert_eq!(ProfileId::from_bytes(*uuid.as_bytes()).unwrap(), id);
}

#[test]
fn generated_ids_are_valid_distinct_and_time_ordered() {
    // Bug prevented: a generator that produced anything the validator refuses,
    // or two equal ids in a row.
    let a = SessionId::generate();
    let b = SessionId::generate();
    assert_eq!(a.as_uuid().get_version(), Some(Version::SortRand));
    assert!(SessionId::from_uuid(a.into_uuid()).is_ok());
    assert_ne!(a, b);
    assert!(a < b, "v7 ids minted in sequence order by time");
}

#[test]
fn parse_accepts_every_textual_uuid_form_and_displays_lowercase_hyphenated() {
    // Bug prevented: input form leaking into the stored or displayed form.
    let canonical = ProfileId::parse(V7).unwrap();
    let simple = V7.replace('-', "");
    let braced = format!("{{{V7}}}");
    let urn = format!("urn:uuid:{V7}");
    let upper = V7.to_uppercase();
    for text in [
        simple.as_str(),
        braced.as_str(),
        urn.as_str(),
        upper.as_str(),
    ] {
        let id = ProfileId::parse(text).unwrap();
        assert_eq!(id, canonical, "input {text}");
        assert_eq!(id.to_string(), V7, "input {text}");
    }
    assert_eq!(ProfileId::from_str(V7).unwrap(), canonical);
    assert_eq!(ProfileId::try_from(V7).unwrap(), canonical);
    assert_eq!(ProfileId::try_from(String::from(V7)).unwrap(), canonical);
    assert_eq!(
        ProfileId::try_from(Uuid::parse_str(V7).unwrap()).unwrap(),
        canonical
    );
}

#[test]
fn debug_names_the_kind_and_display_does_not() {
    let id = MachineUserId::parse(V7).unwrap();
    assert_eq!(format!("{id:?}"), format!("MachineUserId({V7})"));
    assert_eq!(format!("{id}"), V7);
}

// --- refused values --------------------------------------------------------

#[test]
fn nil_uuid_is_refused_with_cause_nil() {
    // Bug prevented: Uuid::nil() used as a placeholder id sneaking into storage.
    let err = ProfileId::from_uuid(Uuid::nil()).unwrap_err();
    assert_eq!(err.kind(), IdKind::Profile);
    assert_eq!(err.cause(), IdErrorCause::Nil);
    assert_eq!(err.to_string(), "invalid ProfileId: the nil UUID");
    assert!(DeviceId::parse("00000000-0000-0000-0000-000000000000").is_err());
}

#[test]
fn max_uuid_is_refused_with_cause_max() {
    let err = SessionId::from_uuid(Uuid::max()).unwrap_err();
    assert_eq!(err.kind(), IdKind::Session);
    assert_eq!(err.cause(), IdErrorCause::Max);
}

#[test]
fn wrong_versions_are_refused_and_name_the_version_found() {
    // Bug prevented: a v4 id from an old generator or a foreign system accepted as v7.
    let v4 = DeviceId::parse(V4).unwrap_err();
    assert_eq!(v4.kind(), IdKind::Device);
    assert_eq!(v4.cause(), IdErrorCause::Version(4));
    assert_eq!(
        v4.to_string(),
        "invalid DeviceId: UUID version 4, expected version 7"
    );
    let v1 = MachineUserId::parse(V1).unwrap_err();
    assert_eq!(v1.cause(), IdErrorCause::Version(1));
}

#[test]
fn non_rfc4122_variant_is_refused_before_the_version_is_read() {
    // Bug prevented: version bits interpreted on a UUID that is not RFC 4122 at all.
    let err = ProfileId::from_uuid(non_rfc_variant()).unwrap_err();
    assert_eq!(err.cause(), IdErrorCause::Variant);
}

#[test]
fn malformed_text_is_refused_with_cause_malformed() {
    for text in [
        "",
        "not-a-uuid",
        "0192f3a4-7c1e-7b2a-9d4e-3f5a6b7c8d9", // one hex digit short
        "0192f3a4-7c1e-7b2a-9d4e-3f5a6b7c8d9e0", // one too many
        "0192f3a4-7c1e-7b2a-9d4e-3f5a6b7c8d9g", // non-hex
        " 0192f3a4-7c1e-7b2a-9d4e-3f5a6b7c8d9e", // leading space
    ] {
        let err = ProfileId::parse(text).unwrap_err();
        assert_eq!(err.cause(), IdErrorCause::Malformed, "input {text:?}");
        assert_eq!(err.kind(), IdKind::Profile);
    }
}

#[test]
fn error_kind_follows_the_type_that_validated() {
    // Bug prevented: one shared validator reporting the wrong type in messages.
    assert_eq!(ProfileId::parse(V4).unwrap_err().kind(), IdKind::Profile);
    assert_eq!(DeviceId::parse(V4).unwrap_err().kind(), IdKind::Device);
    assert_eq!(SessionId::parse(V4).unwrap_err().kind(), IdKind::Session);
    assert_eq!(
        MachineUserId::parse(V4).unwrap_err().kind(),
        IdKind::MachineUser
    );
    assert_eq!(BindingId::parse(V4).unwrap_err().kind(), IdKind::Binding);
    assert_eq!(OrgId::parse(V4).unwrap_err().kind(), IdKind::Organization);
    assert_eq!(IssuerId::parse(V4).unwrap_err().kind(), IdKind::Issuer);
    assert_eq!(IdKind::Issuer.type_name(), "IssuerId");
    assert_eq!(
        ApplicationId::parse(V4).unwrap_err().kind(),
        IdKind::Application
    );
    assert_eq!(IdKind::Application.type_name(), "ApplicationId");
    assert_eq!(ResourceId::parse(V4).unwrap_err().kind(), IdKind::Resource);
    assert_eq!(IdKind::Resource.type_name(), "ResourceId");
    assert_eq!(
        PasswordOperationId::parse(V4).unwrap_err().kind(),
        IdKind::PasswordOperation
    );
    assert_eq!(IdKind::PasswordOperation.type_name(), "PasswordOperationId");
    assert_eq!(
        ProvisioningConnectorId::parse(V4).unwrap_err().kind(),
        IdKind::ProvisioningConnector
    );
    assert_eq!(
        IdKind::ProvisioningConnector.type_name(),
        "ProvisioningConnectorId"
    );
    assert_eq!(
        ProvisioningCredentialId::parse(V4).unwrap_err().kind(),
        IdKind::ProvisioningCredential
    );
    assert_eq!(
        IdKind::ProvisioningCredential.type_name(),
        "ProvisioningCredentialId"
    );
    assert_eq!(
        OpaqueLoginId::parse(V4).unwrap_err().kind(),
        IdKind::OpaqueLogin
    );
    assert_eq!(IdKind::OpaqueLogin.type_name(), "OpaqueLoginId");
    assert_eq!(
        CredentialId::parse(V4).unwrap_err().kind(),
        IdKind::Credential
    );
    assert_eq!(IdKind::Credential.type_name(), "CredentialId");
    assert_eq!(
        OtpSessionId::parse(V4).unwrap_err().kind(),
        IdKind::OtpSession
    );
    assert_eq!(IdKind::OtpSession.type_name(), "OtpSessionId");
    assert_eq!(
        MagicLinkId::parse(V4).unwrap_err().kind(),
        IdKind::MagicLink
    );
    assert_eq!(IdKind::MagicLink.type_name(), "MagicLinkId");
    assert_eq!(
        StepUpChallengeId::parse(V4).unwrap_err().kind(),
        IdKind::StepUpChallenge
    );
    assert_eq!(IdKind::StepUpChallenge.type_name(), "StepUpChallengeId");
    assert_eq!(
        ResetSessionId::parse(V4).unwrap_err().kind(),
        IdKind::ResetSession
    );
    assert_eq!(IdKind::ResetSession.type_name(), "ResetSessionId");
    assert_eq!(
        ImportedPasswordUpgradeId::parse(V4).unwrap_err().kind(),
        IdKind::ImportedPasswordUpgrade
    );
    assert_eq!(
        IdKind::ImportedPasswordUpgrade.type_name(),
        "ImportedPasswordUpgradeId"
    );
    assert_eq!(
        PrincipalId::parse(V4).unwrap_err().kind(),
        IdKind::Principal
    );
    assert_eq!(IdKind::Principal.type_name(), "PrincipalId");
    assert_eq!(
        ProfileEmailId::parse(V4).unwrap_err().kind(),
        IdKind::ProfileEmail
    );
    assert_eq!(IdKind::ProfileEmail.type_name(), "ProfileEmailId");
    assert_eq!(
        ProfilePhoneId::parse(V4).unwrap_err().kind(),
        IdKind::ProfilePhone
    );
    assert_eq!(IdKind::ProfilePhone.type_name(), "ProfilePhoneId");
    for (kind, name, refused) in [
        (
            IdKind::Project,
            "ProjectId",
            ProjectId::parse(V4).unwrap_err().kind(),
        ),
        (
            IdKind::Role,
            "RoleId",
            RoleId::parse(V4).unwrap_err().kind(),
        ),
        (
            IdKind::Group,
            "GroupId",
            GroupId::parse(V4).unwrap_err().kind(),
        ),
        (
            IdKind::RoleAssignment,
            "RoleAssignmentId",
            RoleAssignmentId::parse(V4).unwrap_err().kind(),
        ),
        (
            IdKind::CedarPolicy,
            "CedarPolicyId",
            CedarPolicyId::parse(V4).unwrap_err().kind(),
        ),
        (
            IdKind::AccessRequest,
            "AccessRequestId",
            AccessRequestId::parse(V4).unwrap_err().kind(),
        ),
        (
            IdKind::InitialAccessToken,
            "InitialAccessTokenId",
            InitialAccessTokenId::parse(V4).unwrap_err().kind(),
        ),
        (IdKind::Pat, "PatId", PatId::parse(V4).unwrap_err().kind()),
    ] {
        assert_eq!(refused, kind);
        assert_eq!(kind.type_name(), name);
    }
}

// --- kinds with fixed values beside UUIDv7 ----------------------------------

#[test]
fn the_system_project_is_the_one_nil_identifier() {
    // Bug prevented: the system project every installation has, named by the
    // nil UUID, refused as a project, or the nil UUID accepted as any other
    // kind.
    let system = ProjectId::from_uuid(Uuid::nil()).unwrap();
    assert_eq!(system, ProjectId::SYSTEM);
    assert!(system.is_system());
    assert!(!ProjectId::parse(V7).unwrap().is_system());
    assert_eq!(
        ProjectId::from_uuid(Uuid::max()).unwrap_err().cause(),
        IdErrorCause::Max
    );
    assert_eq!(
        ProjectId::from_uuid(Uuid::from_u128(1))
            .unwrap_err()
            .cause(),
        IdErrorCause::Variant
    );
    assert_eq!(
        RoleId::from_uuid(Uuid::nil()).unwrap_err().cause(),
        IdErrorCause::Nil
    );
    assert_eq!(
        GroupId::from_uuid(Uuid::nil()).unwrap_err().cause(),
        IdErrorCause::Nil
    );
}

#[test]
fn built_in_roles_keep_their_fixed_identifiers() {
    // Bug prevented: a built-in role (the same id in every installation)
    // refused as a role, or its id space accepted as another kind.
    let first = RoleId::from_uuid(Uuid::from_u128(1)).unwrap();
    assert_eq!(first, RoleId::builtin(core::num::NonZeroU8::MIN));
    assert!(first.is_builtin());
    assert!(
        RoleId::from_uuid(Uuid::from_u128(0xff))
            .unwrap()
            .is_builtin()
    );
    assert!(!RoleId::parse(V7).unwrap().is_builtin());
    assert_eq!(
        RoleId::from_uuid(Uuid::from_u128(0x100))
            .unwrap_err()
            .cause(),
        IdErrorCause::Variant
    );
    assert_eq!(
        GroupId::from_uuid(Uuid::from_u128(1)).unwrap_err().cause(),
        IdErrorCause::Variant
    );
    assert_eq!(
        ProfileId::from_uuid(Uuid::from_u128(1))
            .unwrap_err()
            .cause(),
        IdErrorCause::Variant
    );
}

#[test]
fn sign_in_references_of_one_value_stay_distinct_types() {
    // Bug prevented: a reference of one ceremony accepted as another's. The
    // same bytes validate as each kind, and only the type the caller named
    // tells them apart (a reset id is never a session id).
    let reset = ResetSessionId::generate();
    let same_bytes = SessionId::from_bytes(*reset.as_bytes()).unwrap();
    assert_eq!(same_bytes.as_bytes(), reset.as_bytes());
    assert_eq!(
        CredentialId::from_slice(&reset.as_bytes()[..15])
            .unwrap_err()
            .cause(),
        IdErrorCause::Length(15)
    );
}

#[test]
fn an_opaque_login_id_round_trips_through_its_binary_form() {
    // Bug prevented: a login finish naming another login than the one it
    // started, or bytes no login was started with being accepted.
    let login = OpaqueLoginId::generate();
    assert_eq!(OpaqueLoginId::from_slice(login.as_bytes()).unwrap(), login);
    assert_eq!(
        OpaqueLoginId::from_slice(&login.as_bytes()[..15])
            .unwrap_err()
            .cause(),
        IdErrorCause::Length(15)
    );
}

#[test]
fn a_provisioning_credential_id_round_trips_through_its_binary_form() {
    // Bug prevented: the credential reference an audit record or a revoke
    // carries decoding to another credential.
    let credential = ProvisioningCredentialId::generate();
    assert_eq!(
        ProvisioningCredentialId::from_slice(credential.as_bytes()).unwrap(),
        credential
    );
}

#[test]
fn a_provisioning_connector_id_round_trips_through_its_binary_form() {
    // Bug prevented: a connector reference in an audit record or a credential
    // decoding to another connector.
    let connector = ProvisioningConnectorId::generate();
    assert_eq!(
        ProvisioningConnectorId::from_slice(connector.as_bytes()).unwrap(),
        connector
    );
}

#[test]
fn a_password_operation_id_round_trips_through_its_binary_form() {
    // Bug prevented: the operation reference a retry carries decoding to
    // another operation, or accepting bytes no operation was issued with.
    let op = PasswordOperationId::generate();
    assert_eq!(PasswordOperationId::from_slice(op.as_bytes()).unwrap(), op);
    assert_eq!(
        PasswordOperationId::from_slice(&op.as_bytes()[..15])
            .unwrap_err()
            .cause(),
        IdErrorCause::Length(15)
    );
}

// --- binary wire form ------------------------------------------------------

#[test]
fn from_slice_accepts_exactly_sixteen_valid_bytes() {
    // Bug prevented: the binary wire form accepting what the typed forms refuse.
    let uuid = Uuid::parse_str(V7).unwrap();
    let id = BindingId::from_slice(uuid.as_bytes()).unwrap();
    assert_eq!(id.as_bytes(), uuid.as_bytes());
}

#[test]
fn from_slice_refuses_other_lengths_naming_the_length_found() {
    // Bug prevented: a truncated or padded field read as some other id, or
    // an empty field read as absent.
    let bytes = *Uuid::parse_str(V7).unwrap().as_bytes();
    for len in [0usize, 1, 15, 17, 32] {
        let mut buf = [0u8; 32];
        buf[..16.min(len)].copy_from_slice(&bytes[..16.min(len)]);
        let err = MachineUserId::from_slice(&buf[..len]).unwrap_err();
        assert_eq!(err.kind(), IdKind::MachineUser);
        assert_eq!(err.cause(), IdErrorCause::Length(len), "length {len}");
    }
    assert_eq!(
        BindingId::from_slice(&[]).unwrap_err().to_string(),
        "invalid BindingId: 0 bytes, expected 16"
    );
}

#[test]
fn from_slice_applies_the_one_validation() {
    assert_eq!(
        BindingId::from_slice(Uuid::nil().as_bytes())
            .unwrap_err()
            .cause(),
        IdErrorCause::Nil
    );
    assert_eq!(
        BindingId::from_slice(Uuid::max().as_bytes())
            .unwrap_err()
            .cause(),
        IdErrorCause::Max
    );
    assert_eq!(
        BindingId::from_slice(Uuid::parse_str(V4).unwrap().as_bytes())
            .unwrap_err()
            .cause(),
        IdErrorCause::Version(4)
    );
    assert_eq!(
        BindingId::from_slice(non_rfc_variant().as_bytes())
            .unwrap_err()
            .cause(),
        IdErrorCause::Variant
    );
}

// --- serde -----------------------------------------------------------------

#[test]
fn serde_json_is_the_plain_uuid_string_and_round_trips() {
    // Bug prevented: a wire format change on existing v1 JSON/proto string fields.
    let id = ProfileId::parse(V7).unwrap();
    let json = serde_json::to_string(&id).unwrap();
    assert_eq!(json, format!("\"{V7}\""));
    let back: ProfileId = serde_json::from_str(&json).unwrap();
    assert_eq!(back, id);
    // Identical bytes to a bare Uuid, so stored JSON written before this
    // crate existed still decodes.
    assert_eq!(json, serde_json::to_string(&id.into_uuid()).unwrap());
}

#[test]
fn serde_refuses_invalid_ids_with_the_validation_message() {
    // Bug prevented: deserialization as the one path that skips validation.
    let nil = serde_json::from_str::<SessionId>("\"00000000-0000-0000-0000-000000000000\"");
    assert!(nil.unwrap_err().to_string().contains("the nil UUID"));
    let v4 = serde_json::from_str::<SessionId>(&format!("\"{V4}\""));
    assert!(v4.unwrap_err().to_string().contains("expected version 7"));
    let malformed = serde_json::from_str::<SessionId>("\"nope\"");
    assert!(malformed.is_err());
    let wrong_json_type = serde_json::from_str::<SessionId>("42");
    assert!(wrong_json_type.is_err());
}

// --- nominal typing --------------------------------------------------------

#[test]
fn same_bytes_are_different_types_with_no_conversion() {
    // Compile-time property, asserted at runtime through the only shared
    // representation: the same UUID accepted by two kinds stays two values
    // whose Debug names differ. `let _: SessionId = profile_id;` does not compile.
    let uuid = Uuid::parse_str(V7).unwrap();
    let p = ProfileId::from_uuid(uuid).unwrap();
    let s = SessionId::from_uuid(uuid).unwrap();
    assert_eq!(p.into_uuid(), s.into_uuid());
    assert_ne!(format!("{p:?}"), format!("{s:?}"));
}

#[test]
fn ordering_and_hashing_follow_the_uuid() {
    use std::collections::HashSet;
    let a = ProfileId::parse("0192f3a4-7c1e-7b2a-9d4e-3f5a6b7c8d9e").unwrap();
    let b = ProfileId::parse("0192f3a5-1d2b-7c3d-9d4e-3f5a6b7c8d9e").unwrap();
    assert!(a < b);
    let set: HashSet<ProfileId> = [a, b, a].into_iter().collect();
    assert_eq!(set.len(), 2);
}
