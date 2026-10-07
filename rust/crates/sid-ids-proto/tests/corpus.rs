// SPDX-License-Identifier: Apache-2.0
//! The identifier corpus shared with the TypeScript package: every case's
//! identifier bytes, its binary message, its standard ProtoJSON and the
//! outcome of the checked conversion. The corpus lives beside the schema, at
//! `sid/v1/ids/ids.corpus.json` of the pinned `proto` checkout; this test
//! computes each case from the implementation and compares it with that
//! file, which the TypeScript suite runs unchanged.
//!
//! `SID_IDS_CORPUS_WRITE=1 cargo nextest run -p sid-ids-proto --test corpus`
//! rewrites the file in the `proto` checkout after an intended change; review
//! the diff and land it in the proto repository.

use prost::Message;
use prost_reflect::{DescriptorPool, DynamicMessage};
use serde_json::{Value, json};
use sid_ids::IdErrorCause;
use sid_ids_proto::{
    BindingId, FILE_DESCRIPTOR_SET, MachineUserId, PasswordOperationId, ProvisioningConnectorId,
    ProvisioningCredentialId, ResourceId, WireId,
};

/// The corpus in the repository's `proto` checkout.
fn corpus_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../proto")
        .join(sid_ids_proto::PROTO_PATH)
        .with_extension("corpus.json")
}

/// 019290a4-7b3c-7d2e-8f00-112233445566: version 7, RFC 9562 variant.
const V7: [u8; 16] = [
    0x01, 0x92, 0x90, 0xa4, 0x7b, 0x3c, 0x7d, 0x2e, 0x8f, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66,
];

/// `V7` with one byte changed by `f`.
fn with(index: usize, value: u8) -> Vec<u8> {
    let mut bytes = V7.to_vec();
    bytes[index] = value;
    bytes
}

/// The cases: (name, what it shows, identifier bytes; `None` is an absent
/// message where one is required).
fn cases() -> Vec<(&'static str, &'static str, Option<Vec<u8>>)> {
    vec![
        (
            "valid",
            "a UUIDv7 of the RFC 9562 variant",
            Some(V7.to_vec()),
        ),
        (
            "empty",
            "a present message with no bytes; ProtoJSON {} and wire empty",
            Some(Vec::new()),
        ),
        ("short", "15 bytes", Some(V7[..15].to_vec())),
        ("long", "17 bytes", Some([&V7[..], &[0x77]].concat())),
        ("nil", "the nil UUID", Some(vec![0x00; 16])),
        ("max", "the max UUID", Some(vec![0xff; 16])),
        (
            "version_4",
            "an RFC 9562 UUID of version 4",
            Some(with(6, 0x4d)),
        ),
        (
            "variant_ncs",
            "variant bits 0xx: refused before the version is read",
            Some(with(8, 0x0f)),
        ),
        (
            "variant_microsoft",
            "variant bits 110: refused",
            Some(with(8, 0xcf)),
        ),
        (
            "absent",
            "the required message is missing; distinct from an empty one",
            None,
        ),
    ]
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn cause(cause: IdErrorCause) -> String {
    match cause {
        IdErrorCause::Malformed => "malformed".into(),
        IdErrorCause::Length(n) => format!("length:{n}"),
        IdErrorCause::Nil => "nil".into(),
        IdErrorCause::Max => "max".into(),
        IdErrorCause::Variant => "variant".into(),
        IdErrorCause::Version(v) => format!("version:{v}"),
    }
}

/// One kind's cases, computed from the implementation.
fn kind_cases<W>(name: &str, make: fn(Vec<u8>) -> W, pool: &DescriptorPool) -> Vec<Value>
where
    W: WireId + Message + Default,
{
    let desc = pool
        .get_message_by_name(&format!("sid.v1.ids.{name}"))
        .expect("descriptor");
    cases()
        .into_iter()
        .map(|(case, about, value)| {
            let Some(value) = value else {
                assert!(matches!(
                    sid_ids_proto::required::<W>(None),
                    Err(sid_ids_proto::WireIdError::Missing(_))
                ));
                return json!({
                    "kind": name, "case": case, "about": about,
                    "value_hex": null, "wire_hex": null, "protojson": null,
                    "expect": "missing",
                });
            };
            let wire = make(value.clone());
            let encoded = wire.encode_to_vec();
            // The binary form decodes back to the same bytes.
            assert_eq!(
                W::decode(encoded.as_slice()).unwrap().encode_to_vec(),
                encoded
            );
            let dynamic = DynamicMessage::decode(desc.clone(), encoded.as_slice()).unwrap();
            let protojson = serde_json::to_value(&dynamic).unwrap();
            // Standard ProtoJSON parses back to the same binary form.
            let back = DynamicMessage::deserialize(desc.clone(), protojson.clone()).unwrap();
            assert_eq!(back.encode_to_vec(), encoded, "{name}/{case}");
            let expect = match sid_ids_proto::required(Some(&wire)) {
                Ok(_) => "valid".to_owned(),
                Err(sid_ids_proto::WireIdError::Invalid(err)) => cause(err.cause()),
                Err(other) => panic!("{name}/{case}: {other}"),
            };
            json!({
                "kind": name, "case": case, "about": about,
                "value_hex": hex(&value), "wire_hex": hex(&encoded),
                "protojson": protojson, "expect": expect,
            })
        })
        .collect()
}

fn corpus() -> Value {
    let pool = DescriptorPool::decode(FILE_DESCRIPTOR_SET).unwrap();
    let mut cases = Vec::new();
    cases.extend(kind_cases("BindingId", |value| BindingId { value }, &pool));
    cases.extend(kind_cases(
        "MachineUserId",
        |value| MachineUserId { value },
        &pool,
    ));
    cases.extend(kind_cases(
        "PasswordOperationId",
        |value| PasswordOperationId { value },
        &pool,
    ));
    cases.extend(kind_cases(
        "ProvisioningConnectorId",
        |value| ProvisioningConnectorId { value },
        &pool,
    ));
    cases.extend(kind_cases(
        "ProvisioningCredentialId",
        |value| ProvisioningCredentialId { value },
        &pool,
    ));
    cases.extend(kind_cases(
        "ResourceId",
        |value| ResourceId { value },
        &pool,
    ));
    // A consumer's own wrapper `message SidBinding { bytes binding_id = 1; }`
    // replaced at the same outer field by sid.v1.ids.BindingId: the inner
    // field is number 1 of type bytes in both, so the encoding is identical.
    let legacy = {
        let mut bytes = vec![0x0a, 0x10];
        bytes.extend_from_slice(&V7);
        bytes
    };
    assert_eq!(BindingId { value: V7.to_vec() }.encode_to_vec(), legacy);
    // ProtoJSON parsers accept standard and URL-safe base64, padded or not
    // (protobuf.dev ProtoJSON mapping, `bytes`); output is standard padded.
    let desc = pool.get_message_by_name("sid.v1.ids.BindingId").unwrap();
    let max = BindingId {
        value: vec![0xff; 16],
    }
    .encode_to_vec();
    let inputs: Vec<Value> = [
        "/////////////////////w==",
        "/////////////////////w",
        "_____________________w==",
        "_____________________w",
    ]
    .into_iter()
    .map(|text| {
        let parsed = DynamicMessage::deserialize(desc.clone(), json!({ "value": text })).unwrap();
        assert_eq!(parsed.encode_to_vec(), max, "{text}");
        json!({ "value": text })
    })
    .collect();
    json!({
        "about": "sid.v1.ids identifier corpus: binary, ProtoJSON and checked conversion",
        "proto": sid_ids_proto::PROTO_PATH,
        "cases": cases,
        "protojson_inputs": {
            "about": "accepted spellings of the max-UUID BindingId; all parse to wire_hex",
            "wire_hex": hex(&max),
            "inputs": inputs,
        },
        "wrapper_substitution": {
            "about": "message SidBinding { bytes binding_id = 1; } encodes as sid.v1.ids.BindingId",
            "legacy_wire_hex": hex(&legacy),
            "binding_wire_hex": hex(&BindingId { value: V7.to_vec() }.encode_to_vec()),
        },
    })
}

/// `value` with every object's keys in sorted order, so the written file is
/// the same whether or not `serde_json`'s `preserve_order` is enabled (a
/// workspace build unifies it in through other packages).
fn sorted(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut entries: Vec<(String, Value)> = map.into_iter().collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            Value::Object(entries.into_iter().map(|(k, v)| (k, sorted(v))).collect())
        }
        Value::Array(items) => Value::Array(items.into_iter().map(sorted).collect()),
        other => other,
    }
}

/// The committed corpus is exactly what the implementation produces. The
/// comparison is of JSON values, not text: key order is not part of the
/// contract.
#[test]
fn committed_corpus_matches_the_implementation() {
    let path = corpus_path();
    let computed = sorted(corpus());
    if std::env::var_os("SID_IDS_CORPUS_WRITE").is_some() {
        std::fs::write(
            &path,
            serde_json::to_string_pretty(&computed).unwrap() + "\n",
        )
        .unwrap();
        return;
    }
    assert_eq!(committed(), computed, "{} is stale", path.display());
}

/// The corpus file as committed in the `proto` checkout.
fn committed() -> Value {
    let path = corpus_path();
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "{}: {e}; is the proto submodule checked out?",
            path.display()
        )
    }))
    .expect("the corpus is JSON")
}

/// Every message of the identifier schema is a delivered kind: the committed
/// corpus, which the TypeScript suite also runs, has its cases. A message
/// added to the schema without them fails this test.
#[test]
fn committed_corpus_covers_every_schema_message() {
    let pool = DescriptorPool::decode(FILE_DESCRIPTOR_SET).unwrap();
    let corpus = committed();
    let cases = corpus["cases"].as_array().unwrap();
    let file = pool
        .get_file_by_name(sid_ids_proto::PROTO_PATH)
        .expect("the identifier schema");
    let mut names: Vec<String> = file.messages().map(|m| m.name().to_owned()).collect();
    names.sort();
    let mut kinds: Vec<String> = cases
        .iter()
        .map(|c| c["kind"].as_str().unwrap().to_owned())
        .collect();
    kinds.sort();
    kinds.dedup();
    assert_eq!(kinds, names, "corpus kinds differ from the schema messages");
}

/// Every refusal the conversion knows for binary input appears in the corpus,
/// and every kind has every case.
#[test]
fn corpus_covers_every_refusal_and_kind() {
    let corpus = corpus();
    let cases = corpus["cases"].as_array().unwrap();
    for expect in [
        "valid",
        "missing",
        "length:0",
        "length:15",
        "length:17",
        "nil",
        "max",
        "version:4",
        "variant",
    ] {
        assert!(
            cases.iter().any(|c| c["expect"] == expect),
            "no case expects {expect}"
        );
    }
    assert_eq!(cases.len(), 6 * self::cases().len());
}
