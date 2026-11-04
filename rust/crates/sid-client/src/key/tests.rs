// SPDX-License-Identifier: Apache-2.0

use super::*;

/// A signature verifies under the public key the JWK names, in the 64-byte
/// `R || S` form ES256 takes (RFC 7518 §3.4).
#[tokio::test]
async fn a_signature_verifies_under_its_jwk() {
    use base64::Engine;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use p256::ecdsa::signature::Verifier;

    let key = SoftwareKey::generate();
    let signature = key.sign(b"input").await.unwrap();
    assert_eq!(signature.len(), 64);

    let jwk = key.public_jwk();
    assert_eq!(jwk["kty"], "EC");
    assert_eq!(jwk["crv"], "P-256");
    assert!(jwk.get("d").is_none(), "no private member");
    let mut point = vec![4u8];
    point.extend(URL_SAFE_NO_PAD.decode(jwk["x"].as_str().unwrap()).unwrap());
    point.extend(URL_SAFE_NO_PAD.decode(jwk["y"].as_str().unwrap()).unwrap());
    let verifying = p256::ecdsa::VerifyingKey::from_sec1_bytes(&point).unwrap();
    let signature = p256::ecdsa::Signature::from_slice(&signature).unwrap();
    verifying.verify(b"input", &signature).unwrap();
    assert!(verifying.verify(b"other", &signature).is_err());
}

/// The PKCS#8 encoding brings back the same key, so a restarted application
/// keeps renewing the sessions bound to it.
#[tokio::test]
async fn the_key_survives_its_encoding() {
    let key = SoftwareKey::generate();
    let again = SoftwareKey::from_pkcs8_der(&key.to_pkcs8_der().unwrap()).unwrap();
    assert_eq!(again.public_jwk(), key.public_jwk());
    assert!(SoftwareKey::from_pkcs8_der(b"not a key").is_err());
}
