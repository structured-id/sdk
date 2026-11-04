// SPDX-License-Identifier: Apache-2.0
//! The application instance's key: the key a native session's refresh
//! credentials are bound to. The client never needs the private key itself;
//! a platform key store implements [`ApplicationKey`] over its own handle.

use async_trait::async_trait;

/// Why the key could not sign. A locked or missing store is reported, never
/// replaced by another key: a session bound to this key cannot be renewed
/// with any other.
#[derive(Debug, thiserror::Error)]
pub enum KeyError {
    /// The store holding the key is locked or unreachable now; it may sign
    /// later.
    #[error("the application key is unavailable: {0}")]
    Unavailable(String),
    /// The key cannot sign at all (removed, damaged).
    #[error("the application key cannot sign: {0}")]
    Failed(String),
}

/// The application instance's key, held wherever the platform keeps keys.
#[async_trait]
pub trait ApplicationKey: Send + Sync {
    /// The JWS `alg` of its signatures (RFC 7518 §3.1), for example `ES256`.
    fn algorithm(&self) -> &'static str;

    /// Its public key as a JWK (RFC 7517 §4), without private members.
    fn public_jwk(&self) -> serde_json::Value;

    /// The JWS signature of `signing_input` (RFC 7515 §5.1), in the form the
    /// algorithm defines (for ES256 the 64-byte `R || S`, RFC 7518 §3.4).
    async fn sign(&self, signing_input: &[u8]) -> Result<Vec<u8>, KeyError>;
}

/// A P-256 key held in process memory (ES256). For a platform that keeps no
/// key of its own; its PKCS#8 encoding is the application's to keep.
#[cfg(feature = "software-key")]
pub struct SoftwareKey {
    signing: p256::ecdsa::SigningKey,
}

#[cfg(feature = "software-key")]
impl SoftwareKey {
    /// A new random key.
    pub fn generate() -> Self {
        use p256::elliptic_curve::Generate;
        let secret = p256::SecretKey::generate_from_rng(&mut rand::rng());
        Self {
            signing: p256::ecdsa::SigningKey::from(&secret),
        }
    }

    /// The key a PKCS#8 DER private key holds (RFC 5958).
    pub fn from_pkcs8_der(der: &[u8]) -> Result<Self, KeyError> {
        use p256::pkcs8::DecodePrivateKey;
        let secret =
            p256::SecretKey::from_pkcs8_der(der).map_err(|e| KeyError::Failed(e.to_string()))?;
        Ok(Self {
            signing: p256::ecdsa::SigningKey::from(&secret),
        })
    }

    /// The key's PKCS#8 DER encoding, for the application's secure storage.
    pub fn to_pkcs8_der(&self) -> Result<zeroize::Zeroizing<Vec<u8>>, KeyError> {
        use p256::pkcs8::EncodePrivateKey;
        let document = self
            .signing
            .to_pkcs8_der()
            .map_err(|e| KeyError::Failed(e.to_string()))?;
        Ok(zeroize::Zeroizing::new(document.as_bytes().to_vec()))
    }
}

#[cfg(feature = "software-key")]
#[async_trait]
impl ApplicationKey for SoftwareKey {
    fn algorithm(&self) -> &'static str {
        "ES256"
    }

    fn public_jwk(&self) -> serde_json::Value {
        use base64::Engine;
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        let point = self.signing.verifying_key().to_sec1_point(false);
        serde_json::json!({
            "kty": "EC",
            "crv": "P-256",
            "x": URL_SAFE_NO_PAD.encode(point.x().expect("an uncompressed point has x")),
            "y": URL_SAFE_NO_PAD.encode(point.y().expect("an uncompressed point has y")),
        })
    }

    async fn sign(&self, signing_input: &[u8]) -> Result<Vec<u8>, KeyError> {
        use p256::ecdsa::signature::Signer;
        let signature: p256::ecdsa::Signature = self.signing.sign(signing_input);
        Ok(signature.to_bytes().to_vec())
    }
}

#[cfg(all(test, feature = "software-key"))]
mod tests;
