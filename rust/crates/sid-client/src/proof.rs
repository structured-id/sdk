// SPDX-License-Identifier: Apache-2.0
//! SID native proofs (`native_session.proto`, NativeProofClaims): a JWS by
//! the application key over the request as the client addressed it (RFC 9449
//! §4.2 claims), plus what standard DPoP does not bind (RFC 9449 §11.7): the
//! ceremony a sign-in completes (`sid_cer`), or the refresh credential and
//! logical exchange a refresh presents (`sid_rt`, `sid_ex`).

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rand::Rng;
use sha2::{Digest, Sha256};

use crate::key::{ApplicationKey, KeyError};

/// JWS `typ` of a SID native proof; an OAuth DPoP proof (`dpop+jwt`) is not
/// one.
pub const NATIVE_PROOF_TYPE: &str = "sid-native+jwt";

/// The gRPC service the native ceremonies and the refresh belong to.
pub const AUTH_SERVICE: &str = "sid.v1.authn.AuthService";

/// The request a proof names (RFC 9449 §4.2 `htm`, `htu`): the one the
/// client actually sends, so a proof for one endpoint passes at no other.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProofTarget {
    pub method: String,
    pub uri: String,
}

impl ProofTarget {
    /// A direct gRPC call of AuthService `rpc` at the issuer whose public
    /// origin (scheme and authority) is `origin`: a POST to its RPC path.
    pub fn grpc(origin: &str, rpc: &str) -> Self {
        Self {
            method: "POST".into(),
            uri: format!("{}/{AUTH_SERVICE}/{rpc}", origin.trim_end_matches('/')),
        }
    }

    /// An HTTP call of `method` to `url` (without query or fragment), for a
    /// client using the issuer's HTTP routes.
    pub fn http(method: &str, url: &str) -> Self {
        Self {
            method: method.into(),
            uri: url.into(),
        }
    }
}

/// The logical refresh exchange: 16 random bytes the client chooses once and
/// keeps across every retry of that refresh.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Exchange([u8; 16]);

impl Exchange {
    /// A new exchange.
    pub fn random() -> Self {
        let mut bytes = [0u8; 16];
        rand::rng().fill_bytes(&mut bytes);
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }
}

/// What a proof binds beyond RFC 9449's claims.
#[derive(Debug, Clone, Copy)]
pub enum ProofBinding<'a> {
    /// A ceremony completion echoing `reference`, as its method documents
    /// it (for OpaqueLoginFinish the request's `server_login_state`).
    Ceremony { reference: &'a [u8] },
    /// A refresh presenting `credential` in `exchange`.
    Refresh {
        credential: &'a str,
        exchange: &'a Exchange,
    },
}

/// base64url (no padding) SHA-256 of `bytes`.
fn digest(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(bytes))
}

/// A fresh SID native proof by `key` for `target`, binding `binding`. Each
/// call is a new proof (a new `jti`): a retry is never sent with a proof
/// already used.
pub async fn native_proof(
    key: &dyn ApplicationKey,
    target: &ProofTarget,
    binding: ProofBinding<'_>,
) -> Result<String, KeyError> {
    let header = serde_json::json!({
        "typ": NATIVE_PROOF_TYPE,
        "alg": key.algorithm(),
        "jwk": key.public_jwk(),
    });
    let mut jti = [0u8; 16];
    rand::rng().fill_bytes(&mut jti);
    let iat = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| KeyError::Failed(format!("the clock is before 1970: {e}")))?
        .as_secs();
    let mut claims = serde_json::json!({
        "jti": URL_SAFE_NO_PAD.encode(jti),
        "htm": target.method,
        "htu": target.uri,
        "iat": iat,
    });
    match binding {
        ProofBinding::Ceremony { reference } => {
            claims["sid_cer"] = digest(reference).into();
        }
        ProofBinding::Refresh {
            credential,
            exchange,
        } => {
            claims["sid_rt"] = digest(credential.as_bytes()).into();
            claims["sid_ex"] = URL_SAFE_NO_PAD.encode(exchange.as_bytes()).into();
        }
    }
    let signing_input = format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(header.to_string()),
        URL_SAFE_NO_PAD.encode(claims.to_string())
    );
    let signature = key.sign(signing_input.as_bytes()).await?;
    Ok(format!(
        "{signing_input}.{}",
        URL_SAFE_NO_PAD.encode(signature)
    ))
}

#[cfg(all(test, feature = "software-key"))]
mod tests;
