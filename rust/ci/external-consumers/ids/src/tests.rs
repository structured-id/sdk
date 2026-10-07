use super::*;

/// 019290a4-7b3c-7d2e-8f00-112233445566: version 7, RFC 9562 variant.
const V7: [u8; 16] = [
    0x01, 0x92, 0x90, 0xa4, 0x7b, 0x3c, 0x7d, 0x2e, 0x8f, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66,
];

fn encoded(value: &[u8]) -> Vec<u8> {
    sid_ids_proto::BindingId {
        value: value.to_vec(),
    }
    .encode_to_vec()
}

#[test]
fn a_valid_identifier_keeps_its_bytes() {
    assert_eq!(binding_round_trip(&encoded(&V7)).unwrap(), encoded(&V7));
}

#[test]
fn nil_and_short_identifiers_are_refused() {
    assert!(binding_round_trip(&encoded(&[0; 16])).is_err());
    assert!(binding_round_trip(&encoded(&V7[..15])).is_err());
}

#[test]
fn the_proto_source_travels_with_the_crate() {
    assert!(sid_ids_proto::PROTO_SOURCE.contains("package sid.v1.ids;"));
}
