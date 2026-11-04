// SPDX-License-Identifier: Apache-2.0

use super::*;
use crate::key::SoftwareKey;

fn decode(part: &str) -> serde_json::Value {
    serde_json::from_slice(&URL_SAFE_NO_PAD.decode(part).unwrap()).unwrap()
}

/// A ceremony proof is typed `sid-native+jwt`, carries the public key, names
/// the call by method and URI and binds the ceremony's digest, and nothing a
/// refresh binds.
#[tokio::test]
async fn a_ceremony_proof_binds_its_ceremony() {
    let key = SoftwareKey::generate();
    let target = ProofTarget::grpc("https://sid.example.com/", "OpaqueLoginFinish");
    assert_eq!(
        target.uri,
        "https://sid.example.com/sid.v1.authn.AuthService/OpaqueLoginFinish"
    );
    let proof = native_proof(
        &key,
        &target,
        ProofBinding::Ceremony {
            reference: b"login-state",
        },
    )
    .await
    .unwrap();
    let parts: Vec<&str> = proof.split('.').collect();
    assert_eq!(parts.len(), 3);
    let header = decode(parts[0]);
    assert_eq!(header["typ"], "sid-native+jwt");
    assert_eq!(header["alg"], "ES256");
    assert_eq!(header["jwk"], key.public_jwk());
    let claims = decode(parts[1]);
    assert_eq!(claims["htm"], "POST");
    assert_eq!(claims["htu"], target.uri);
    assert_eq!(
        claims["sid_cer"],
        URL_SAFE_NO_PAD.encode(Sha256::digest(b"login-state"))
    );
    assert!(claims.get("sid_rt").is_none() && claims.get("sid_ex").is_none());
}

/// A refresh proof binds the presented credential's digest and the exchange;
/// two proofs of one retry differ (a fresh `jti` each).
#[tokio::test]
async fn a_refresh_proof_binds_its_credential_and_exchange() {
    let key = SoftwareKey::generate();
    let target = ProofTarget::http(
        "POST",
        "https://sid.example.com/v1/auth/native-session/refresh",
    );
    let exchange = Exchange::random();
    let binding = ProofBinding::Refresh {
        credential: "credential-1",
        exchange: &exchange,
    };
    let first = native_proof(&key, &target, binding).await.unwrap();
    let second = native_proof(&key, &target, binding).await.unwrap();
    let a = decode(first.split('.').nth(1).unwrap());
    let b = decode(second.split('.').nth(1).unwrap());
    assert_eq!(
        a["sid_rt"],
        URL_SAFE_NO_PAD.encode(Sha256::digest(b"credential-1"))
    );
    assert_eq!(a["sid_ex"], URL_SAFE_NO_PAD.encode(exchange.as_bytes()));
    assert!(a.get("sid_cer").is_none());
    assert_ne!(a["jti"], b["jti"]);
    assert_eq!(a["sid_ex"], b["sid_ex"]);
}
