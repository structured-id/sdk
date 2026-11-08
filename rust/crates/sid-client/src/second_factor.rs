// SPDX-License-Identifier: Apache-2.0
//! Completing a native sign-in that owes its second factor (`auth.proto`,
//! OpaqueLoginFinishResponse `second_factors`, MfaVerifyResponse).
//!
//! The sign-in answers a pending context, its bearer token in the
//! `authorization` response metadata, and the factors that complete it.
//! [`complete`] presents that context with the factor and a fresh proof by the
//! application key binding it (`sid_cer` over the pending token), and receives
//! the session's access token and, when the sign-in asked for a renewable
//! session, its first refresh generation. A completion whose answer was lost
//! is sent again with the same pending context and factor and a new proof:
//! the issuer answers it with the sign-in the first attempt committed.

use async_trait::async_trait;
use secrecy::{ExposeSecret, SecretString};
use tonic::metadata::{MetadataMap, MetadataValue};

use crate::key::{ApplicationKey, KeyError};
use crate::native::{Family, GenerationError, PROOF_METADATA, TransportError, generation};
use crate::proof::{ProofBinding, ProofTarget, native_proof};
use crate::proto::sid::v1::authn::{StepUpMethod, VerifyRecoveryCodeRequest, VerifyTotpRequest};

/// A sign-in owing its second factor: the pending context's bearer token and
/// the factors that complete it.
pub struct PendingSignIn {
    token: SecretString,
    factors: Vec<StepUpMethod>,
}

/// Written out: the pending token is a secret and never reaches a log.
impl std::fmt::Debug for PendingSignIn {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PendingSignIn")
            .field("factors", &self.factors)
            .finish_non_exhaustive()
    }
}

/// Why an answer is not a usable pending sign-in or completion.
#[derive(Debug, thiserror::Error)]
pub enum CompletionError {
    #[error("the answer is not readable: {0}")]
    Malformed(String),
    #[error(transparent)]
    Key(#[from] KeyError),
    #[error(transparent)]
    Generation(#[from] GenerationError),
    #[error("the issuer refused the completion: {0}")]
    Refused(tonic::Status),
}

/// The bearer token of the single `authorization` value in `metadata`.
fn bearer(metadata: &MetadataMap) -> Option<SecretString> {
    let mut values = metadata.get_all("authorization").iter();
    let (Some(value), None) = (values.next(), values.next()) else {
        return None;
    };
    let (scheme, token) = value.to_str().ok()?.split_once(' ')?;
    // RFC 9110 §11.1: the auth-scheme is case-insensitive.
    (scheme.eq_ignore_ascii_case("Bearer") && !token.trim().is_empty())
        .then(|| SecretString::from(token.trim().to_owned()))
}

impl PendingSignIn {
    /// The pending context a sign-in answered with response `metadata` and
    /// the `second_factors` of its body; none when the sign-in is complete.
    pub fn of(
        metadata: &MetadataMap,
        second_factors: &[i32],
    ) -> Result<Option<Self>, CompletionError> {
        if second_factors.is_empty() {
            return Ok(None);
        }
        let factors = second_factors
            .iter()
            .map(|&m| {
                StepUpMethod::try_from(m)
                    .map_err(|_| CompletionError::Malformed(format!("unknown factor {m}")))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let token = bearer(metadata)
            .ok_or_else(|| CompletionError::Malformed("no pending context in the answer".into()))?;
        Ok(Some(Self { token, factors }))
    }

    /// The factors that complete the sign-in, in the issuer's order.
    pub fn factors(&self) -> &[StepUpMethod] {
        &self.factors
    }
}

/// The factor a completion presents.
#[derive(Clone, Copy)]
pub enum Factor<'a> {
    /// A code of the enrolled authenticator (VerifyTotp).
    Totp(&'a str),
    /// One of the account's recovery codes (VerifyRecoveryCode).
    RecoveryCode(&'a str),
}

/// Written out: a code is a secret and never reaches a log.
impl std::fmt::Debug for Factor<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Totp(_) => "Totp",
            Self::RecoveryCode(_) => "RecoveryCode",
        })
    }
}

impl Factor<'_> {
    /// The AuthService method that completes with this factor.
    pub fn rpc(&self) -> &'static str {
        match self {
            Self::Totp(_) => "VerifyTotp",
            Self::RecoveryCode(_) => "VerifyRecoveryCode",
        }
    }
}

/// The completed sign-in.
#[derive(Debug)]
pub struct Completed {
    pub session_id: sid_ids::SessionId,
    pub access_token: SecretString,
    pub expires_in: i64,
    /// The first refresh generation, when the sign-in asked for a renewable
    /// session; [`crate::native::NativeSession::adopt`] keeps it.
    pub generation: Option<Family>,
}

/// The outcome of [`complete`].
#[derive(Debug)]
pub enum Completion {
    Completed(Completed),
    /// No answer now: the completion may have taken effect. Call [`complete`]
    /// again with the same pending sign-in and factor.
    Unavailable(String),
}

/// The issuer's second-factor verifications, over whatever transport the
/// application uses.
#[async_trait]
pub trait CompletionTransport: Send + Sync {
    /// The request completing with `factor`, as the proof must name it.
    fn target(&self, factor: Factor<'_>) -> ProofTarget;
    /// One verification presenting the pending context `pending` and `factor`
    /// with `proof`.
    async fn complete(
        &self,
        pending: &str,
        proof: &str,
        factor: Factor<'_>,
    ) -> Result<Completed, TransportError>;
}

/// Complete `pending` with `factor` over `transport`, proving `key`.
pub async fn complete(
    key: &dyn ApplicationKey,
    transport: &dyn CompletionTransport,
    pending: &PendingSignIn,
    factor: Factor<'_>,
) -> Result<Completion, CompletionError> {
    let token = pending.token.expose_secret();
    // A fresh proof for every attempt: the issuer refuses a replayed one.
    let proof = native_proof(
        key,
        &transport.target(factor),
        ProofBinding::Ceremony {
            reference: token.as_bytes(),
        },
    )
    .await?;
    match transport.complete(token, &proof, factor).await {
        Ok(completed) => Ok(Completion::Completed(completed)),
        Err(TransportError::Unresolved(why)) => Ok(Completion::Unavailable(why)),
        Err(TransportError::Refused(status)) => Err(CompletionError::Refused(status)),
    }
}

/// The verifications over the generated gRPC client, at the issuer whose
/// public origin is `origin` (the proof names the gRPC path there).
pub struct GrpcCompletion<T> {
    client: crate::proto::sid::v1::authn::auth_service_client::AuthServiceClient<T>,
    origin: String,
}

impl<T> GrpcCompletion<T> {
    pub fn new(
        client: crate::proto::sid::v1::authn::auth_service_client::AuthServiceClient<T>,
        origin: impl Into<String>,
    ) -> Self {
        Self {
            client,
            origin: origin.into(),
        }
    }
}

#[async_trait]
impl<T> CompletionTransport for GrpcCompletion<T>
where
    T: tonic::client::GrpcService<tonic::body::Body> + Clone + Send + Sync + 'static,
    T::Future: Send,
    T::ResponseBody: tonic::codegen::Body<Data = tonic::codegen::Bytes> + Send + 'static,
    <T::ResponseBody as tonic::codegen::Body>::Error: Into<tonic::codegen::StdError> + Send,
{
    fn target(&self, factor: Factor<'_>) -> ProofTarget {
        ProofTarget::grpc(&self.origin, factor.rpc())
    }

    async fn complete(
        &self,
        pending: &str,
        proof: &str,
        factor: Factor<'_>,
    ) -> Result<Completed, TransportError> {
        let mut metadata = MetadataMap::new();
        for (name, value) in [
            ("authorization", format!("Bearer {pending}")),
            (PROOF_METADATA, proof.to_owned()),
        ] {
            let mut value: MetadataValue<_> = value
                .parse()
                .map_err(|_| TransportError::Unresolved(format!("{name} is not a header value")))?;
            value.set_sensitive(true);
            metadata.insert(name, value);
        }
        let mut client = self.client.clone();
        let answer = match factor {
            Factor::Totp(code) => {
                let mut request = tonic::Request::new(VerifyTotpRequest {
                    code: code.to_owned(),
                });
                *request.metadata_mut() = metadata;
                client.verify_totp(request).await
            }
            Factor::RecoveryCode(code) => {
                let mut request = tonic::Request::new(VerifyRecoveryCodeRequest {
                    code: code.to_owned(),
                });
                *request.metadata_mut() = metadata;
                client.verify_recovery_code(request).await
            }
        };
        let response = match answer {
            Ok(response) => response,
            Err(status) if crate::native::unresolved(status.code()) => {
                return Err(TransportError::Unresolved(status.message().to_owned()));
            }
            Err(status) => return Err(TransportError::Refused(status)),
        };
        // An answer the issuer committed but this client cannot read leaves
        // the outcome unknown to it: sent again, it is redelivered.
        let unreadable = |why: String| TransportError::Unresolved(why);
        let access_token = bearer(response.metadata())
            .ok_or_else(|| unreadable("no access token in the answer".into()))?;
        let generation = generation(response.metadata()).map_err(|e| unreadable(e.to_string()))?;
        let body = response.into_inner();
        let session_id = sid_ids_proto::required(body.session_id.as_ref())
            .map_err(|e| unreadable(e.to_string()))?;
        Ok(Completed {
            session_id,
            access_token,
            expires_in: body.expires_in.unwrap_or(0),
            generation,
        })
    }
}

#[cfg(all(test, feature = "software-key"))]
mod tests;
