// SPDX-License-Identifier: Apache-2.0
//! The identifier messages on the wire (binary and standard ProtoJSON) and
//! their conversions to validated identifiers.

use alloc::vec::Vec;

use prost::Message;
use prost_reflect::{DescriptorPool, DynamicMessage};
use sid_ids::{IdErrorCause, IdKind};

use super::*;

/// A fixed valid UUIDv7.
const V7: [u8; 16] = [
    0x01, 0x92, 0xf3, 0xa4, 0x7c, 0x1e, 0x7b, 0x2a, 0x9d, 0x4e, 0x3f, 0x5a, 0x6b, 0x7c, 0x8d, 0x9e,
];
/// Its standard base64 (ProtoJSON `bytes`).
const V7_BASE64: &str = "AZLzpHweeyqdTj9aa3yNng==";

fn binding() -> sid_ids::BindingId {
    sid_ids::BindingId::from_bytes(V7).unwrap()
}

fn machine() -> sid_ids::MachineUserId {
    sid_ids::MachineUserId::from_bytes(V7).unwrap()
}

fn pool() -> DescriptorPool {
    DescriptorPool::decode(FILE_DESCRIPTOR_SET).unwrap()
}

/// The binary form is field 1, length-delimited, 16 bytes: `0a 10 <uuid>`.
#[test]
fn binary_form_is_one_bytes_field_of_sixteen_bytes() {
    let mut expected = Vec::from([0x0a, 0x10]);
    expected.extend_from_slice(&V7);
    assert_eq!(BindingId::from(binding()).encode_to_vec(), expected);
    assert_eq!(MachineUserId::from(machine()).encode_to_vec(), expected);
}

#[test]
fn binary_round_trips_to_the_same_identifier() {
    let wire = BindingId::from(binding()).encode_to_vec();
    let back = BindingId::decode(wire.as_slice()).unwrap();
    assert_eq!(sid_ids::BindingId::try_from(&back).unwrap(), binding());

    let wire = MachineUserId::from(machine()).encode_to_vec();
    let back = MachineUserId::decode(wire.as_slice()).unwrap();
    assert_eq!(sid_ids::MachineUserId::try_from(back).unwrap(), machine());
}

/// Standard ProtoJSON: `bytes` as standard base64 under the JSON field name,
/// no UUID text rendering.
#[test]
fn protojson_is_standard_base64_and_round_trips() {
    let pool = pool();
    for (name, wire) in [
        (
            "sid.v1.ids.BindingId",
            BindingId::from(binding()).encode_to_vec(),
        ),
        (
            "sid.v1.ids.MachineUserId",
            MachineUserId::from(machine()).encode_to_vec(),
        ),
    ] {
        let desc = pool.get_message_by_name(name).unwrap();
        let msg = DynamicMessage::decode(desc.clone(), wire.as_slice()).unwrap();
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json, serde_json::json!({ "value": V7_BASE64 }), "{name}");

        let back: DynamicMessage = DynamicMessage::deserialize(desc, json).unwrap();
        assert_eq!(back.encode_to_vec(), wire, "{name}");
    }
}

/// An empty message is `{}` in ProtoJSON and carries no identifier: the
/// conversion refuses it rather than reading it as some default.
#[test]
fn an_empty_message_is_refused_as_zero_bytes() {
    let desc = pool().get_message_by_name("sid.v1.ids.BindingId").unwrap();
    let msg = DynamicMessage::deserialize(desc, serde_json::json!({})).unwrap();
    let wire = BindingId::decode(msg.encode_to_vec().as_slice()).unwrap();
    assert_eq!(
        sid_ids::BindingId::try_from(&wire).unwrap_err().cause(),
        IdErrorCause::Length(0)
    );
}

#[test]
fn a_missing_required_message_is_refused_with_its_kind() {
    assert_eq!(
        required::<BindingId>(None),
        Err(WireIdError::Missing(IdKind::Binding))
    );
    assert_eq!(
        required::<MachineUserId>(None),
        Err(WireIdError::Missing(IdKind::MachineUser))
    );
    assert_eq!(required(Some(&BindingId::from(binding()))), Ok(binding()));
}

#[test]
fn wrong_lengths_are_refused_naming_the_length() {
    for len in [0usize, 15, 17] {
        let mut value = V7.to_vec();
        value.resize(len, 0x42);
        let wire = MachineUserId { value };
        assert_eq!(
            required(Some(&wire)),
            Err(WireIdError::Invalid(
                sid_ids::MachineUserId::from_slice(&wire.value).unwrap_err()
            ))
        );
        assert_eq!(
            sid_ids::MachineUserId::try_from(&wire).unwrap_err().cause(),
            IdErrorCause::Length(len)
        );
    }
}

#[test]
fn nil_max_version_and_variant_are_refused() {
    let cause = |bytes: [u8; 16]| {
        sid_ids::BindingId::try_from(BindingId {
            value: bytes.to_vec(),
        })
        .unwrap_err()
        .cause()
    };
    assert_eq!(cause([0; 16]), IdErrorCause::Nil);
    assert_eq!(cause([0xff; 16]), IdErrorCause::Max);
    let v4 = *uuid::Uuid::from_u128(0xf47ac10b_58cc_4372_a567_0e02b2c3d479).as_bytes();
    assert_eq!(cause(v4), IdErrorCause::Version(4));
    let mut ncs = V7;
    ncs[8] &= 0x7f; // variant bits 0xx: NCS, not RFC 9562
    assert_eq!(cause(ncs), IdErrorCause::Variant);
}

/// The two kinds share a wire shape but not a type: the schema names them
/// apart, each converts only to its own domain type, and the conversion
/// errors name the kind that was expected.
#[test]
fn the_two_actor_kinds_stay_distinct() {
    let pool = pool();
    let b = pool.get_message_by_name("sid.v1.ids.BindingId").unwrap();
    let m = pool
        .get_message_by_name("sid.v1.ids.MachineUserId")
        .unwrap();
    assert_ne!(b.full_name(), m.full_name());

    let wire_b = BindingId {
        value: [0; 16].to_vec(),
    };
    let wire_m = MachineUserId {
        value: [0; 16].to_vec(),
    };
    assert_eq!(
        sid_ids::BindingId::try_from(&wire_b).unwrap_err().kind(),
        IdKind::Binding
    );
    assert_eq!(
        sid_ids::MachineUserId::try_from(&wire_m)
            .unwrap_err()
            .kind(),
        IdKind::MachineUser
    );
    // `let _: sid_ids::MachineUserId = sid_ids::BindingId::try_from(&wire_b)?;`
    // does not compile: there is no conversion between the two kinds.
}

/// A password operation reference crosses the wire in the same binary shape
/// and comes back as the same operation, never as an actor identifier.
#[test]
fn a_password_operation_id_round_trips_and_names_its_kind() {
    let op = sid_ids::PasswordOperationId::from_bytes(V7).unwrap();
    let wire = PasswordOperationId::from(op).encode_to_vec();
    let mut expected = Vec::from([0x0a, 0x10]);
    expected.extend_from_slice(&V7);
    assert_eq!(wire, expected);
    let back = PasswordOperationId::decode(wire.as_slice()).unwrap();
    assert_eq!(required(Some(&back)), Ok(op));
    assert_eq!(
        required::<PasswordOperationId>(None),
        Err(WireIdError::Missing(IdKind::PasswordOperation))
    );
    assert!(
        pool()
            .get_message_by_name("sid.v1.ids.PasswordOperationId")
            .is_some()
    );
}

/// A protected resource reference crosses the wire in the same binary shape
/// and comes back as the same resource; absence names its kind.
#[test]
fn a_resource_id_round_trips_and_names_its_kind() {
    let resource = sid_ids::ResourceId::from_bytes(V7).unwrap();
    let wire = ResourceId::from(resource).encode_to_vec();
    let mut expected = Vec::from([0x0a, 0x10]);
    expected.extend_from_slice(&V7);
    assert_eq!(wire, expected);
    let back = ResourceId::decode(wire.as_slice()).unwrap();
    assert_eq!(required(Some(&back)), Ok(resource));
    assert_eq!(
        required::<ResourceId>(None),
        Err(WireIdError::Missing(IdKind::Resource))
    );
    assert!(
        pool()
            .get_message_by_name("sid.v1.ids.ResourceId")
            .is_some()
    );
}

#[test]
fn the_proto_source_is_the_generated_package() {
    assert!(PROTO_SOURCE.contains("package sid.v1.ids;"));
    assert!(!PROTO_SOURCE.contains("import "), "the file stands alone");
    assert_eq!(PROTO_PATH, "sid/v1/ids/ids.proto");
}
