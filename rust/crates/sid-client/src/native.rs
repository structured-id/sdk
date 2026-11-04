// SPDX-License-Identifier: Apache-2.0
//! Native session renewal (`native_session.proto`).
//!
//! A sign-in that proved the application key gets the session's first
//! generation of refresh credentials beside its access token
//! ([`generation`] reads it from the response). [`NativeSession::refresh`]
//! presents one credential of the current generation with a fresh proof and
//! stores the next generation whole. A refresh whose answer was lost is
//! retried under the same exchange, with the next spare credential and a new
//! proof, and receives the generation the first attempt committed: the
//! exchange is stored before the request is sent, so a restart retries it
//! too. The refreshes of one session are serialized; other sessions are not
//! held by it.

use std::sync::Arc;

use async_trait::async_trait;
use prost::Message;
use secrecy::{ExposeSecret, SecretString};
use tonic::metadata::{MetadataMap, MetadataValue};

use crate::key::{ApplicationKey, KeyError};
use crate::proof::{Exchange, ProofBinding, ProofTarget, native_proof};
use crate::proto::sid::v1::authn::{NativeCredentialSet, RefreshNativeSessionRequest};

/// Response metadata carrying a generation (a NativeCredentialSet).
pub const CREDENTIALS_METADATA: &str = "sid-native-credentials-bin";
/// Request metadata carrying a SID native proof.
pub const PROOF_METADATA: &str = "sid-native-proof";
/// Request metadata carrying the presented refresh credential.
pub const REFRESH_METADATA: &str = "sid-native-refresh";
/// The most credentials a generation holds (`native_session.proto`).
pub const GENERATION_SIZE_MAX: usize = 16;

/// The renewal state of one session, stored whole: its current generation
/// and, while a refresh is unresolved, that refresh's exchange.
#[derive(Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Family {
    credentials: Vec<String>,
    /// When the credentials expire, Unix seconds.
    expires_at: u64,
    /// How long after a refresh its retry still receives the same result.
    redelivery_window: u64,
    pending: Option<Pending>,
}

/// A refresh sent and not yet answered: its exchange, and how many
/// credentials it has presented.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct Pending {
    exchange: Exchange,
    attempts: u32,
}

/// Written out: the credentials are secrets and never reach a log.
impl std::fmt::Debug for Family {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Family")
            .field("credentials", &self.credentials.len())
            .field("expires_at", &self.expires_at)
            .field("redelivery_window", &self.redelivery_window)
            .field("pending", &self.pending)
            .finish()
    }
}

impl Drop for Family {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.credentials.zeroize();
    }
}

impl Family {
    /// When the credentials expire, Unix seconds.
    pub fn expires_at(&self) -> u64 {
        self.expires_at
    }

    /// Whether a refresh of this family is unresolved: sent, its answer not
    /// received.
    pub fn refresh_pending(&self) -> bool {
        self.pending.is_some()
    }
}

/// Why a delivered generation was not accepted.
#[derive(Debug, thiserror::Error)]
pub enum GenerationError {
    #[error("the generation is not readable: {0}")]
    Malformed(String),
    #[error("a generation holds 1 to {GENERATION_SIZE_MAX} credentials, not {0}")]
    Size(usize),
}

/// Unix seconds now; a clock before 1970 reads as 1970, so credentials it
/// receives look short-lived rather than everlasting.
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The generation a response delivered in its `sid-native-credentials-bin`
/// metadata, none when it delivered none (a sign-in without a proof, a
/// pending second factor). One outside the protocol's bounds is refused.
pub fn generation(metadata: &MetadataMap) -> Result<Option<Family>, GenerationError> {
    let mut values = metadata.get_all_bin(CREDENTIALS_METADATA).iter();
    let Some(value) = values.next() else {
        return Ok(None);
    };
    if values.next().is_some() {
        return Err(GenerationError::Malformed("delivered twice".into()));
    }
    let bytes = value
        .to_bytes()
        .map_err(|e| GenerationError::Malformed(e.to_string()))?;
    let set = NativeCredentialSet::decode(bytes.as_ref())
        .map_err(|e| GenerationError::Malformed(e.to_string()))?;
    let count = set.refresh_credentials.len();
    if !(1..=GENERATION_SIZE_MAX).contains(&count) {
        return Err(GenerationError::Size(count));
    }
    if set.refresh_credentials.iter().any(String::is_empty) {
        return Err(GenerationError::Malformed("an empty credential".into()));
    }
    let lifetime = u64::try_from(set.expires_in)
        .ok()
        .filter(|&s| s > 0)
        .ok_or_else(|| GenerationError::Malformed("no lifetime left".into()))?;
    let expires_at = now()
        .checked_add(lifetime)
        .ok_or_else(|| GenerationError::Malformed("a lifetime past any clock".into()))?;
    Ok(Some(Family {
        credentials: set.refresh_credentials.clone(),
        expires_at,
        redelivery_window: u64::try_from(set.redelivery_window).unwrap_or(0),
        pending: None,
    }))
}

/// A failure of the family store. A locked or unreachable store is reported,
/// never read as a missing session.
#[derive(Debug, thiserror::Error)]
#[error("the session store failed: {0}")]
pub struct StoreError(pub String);

/// Where one session's [`Family`] is kept, by the application: typically
/// secure storage scoped to the OS user, issuer, client and session. Each
/// write replaces the whole record at once, so a crash never leaves
/// credentials of two generations mixed.
#[async_trait]
pub trait FamilyStore: Send + Sync {
    async fn load(&self) -> Result<Option<Family>, StoreError>;
    async fn save(&self, family: &Family) -> Result<(), StoreError>;
    async fn clear(&self) -> Result<(), StoreError>;
}

/// A family kept in process memory only: the session ends with the process
/// (a no-persistence policy).
#[derive(Default)]
pub struct MemoryFamilyStore(tokio::sync::Mutex<Option<Family>>);

#[async_trait]
impl FamilyStore for MemoryFamilyStore {
    async fn load(&self) -> Result<Option<Family>, StoreError> {
        Ok(self.0.lock().await.clone())
    }
    async fn save(&self, family: &Family) -> Result<(), StoreError> {
        *self.0.lock().await = Some(family.clone());
        Ok(())
    }
    async fn clear(&self) -> Result<(), StoreError> {
        *self.0.lock().await = None;
        Ok(())
    }
}

/// What a refresh request received.
pub struct Renewed {
    pub session_id: String,
    pub access_token: SecretString,
    pub expires_in: i64,
    pub generation: Family,
}

/// Why a refresh request has no answer.
#[derive(Debug)]
pub enum TransportError {
    /// No answer, or one that says the issuer could not answer now: the
    /// refresh may or may not have taken effect.
    Unresolved(String),
    /// The issuer answered with a refusal.
    Refused(tonic::Status),
}

/// The issuer's RefreshNativeSession, over whatever transport the
/// application uses.
#[async_trait]
pub trait RefreshTransport: Send + Sync {
    /// The request as the proof must name it.
    fn target(&self) -> ProofTarget;
    /// One RefreshNativeSession call presenting `credential` with `proof` in
    /// `exchange`.
    async fn refresh(
        &self,
        credential: &str,
        proof: &str,
        exchange: &Exchange,
    ) -> Result<Renewed, TransportError>;
}

/// The outcome of [`NativeSession::refresh`].
#[derive(Debug)]
pub enum Refresh {
    /// Renewed: the access token and seconds until it expires.
    Refreshed {
        session_id: String,
        access_token: SecretString,
        expires_in: i64,
    },
    /// The session ended at the issuer (or never renewed): sign in again.
    Ended,
    /// No answer now: the refresh may have taken effect; the next call
    /// retries it under the same exchange.
    Unavailable(String),
}

/// Why a refresh could not be attempted or was refused.
#[derive(Debug, thiserror::Error)]
pub enum NativeError {
    #[error("no renewable session is stored")]
    NoSession,
    #[error(transparent)]
    Key(#[from] KeyError),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("the issuer refused the refresh: {0}")]
    Refused(tonic::Status),
    #[error(transparent)]
    Generation(#[from] GenerationError),
}

/// One renewable session: its application key, its store, and the lock that
/// serializes its refreshes (and only its own).
pub struct NativeSession {
    key: Arc<dyn ApplicationKey>,
    store: Arc<dyn FamilyStore>,
    refreshing: tokio::sync::Mutex<()>,
}

impl NativeSession {
    pub fn new(key: Arc<dyn ApplicationKey>, store: Arc<dyn FamilyStore>) -> Self {
        Self {
            key,
            store,
            refreshing: tokio::sync::Mutex::new(()),
        }
    }

    /// Keep `generation`, delivered by the sign-in that bound this session to
    /// the key, replacing whatever the store held.
    pub async fn adopt(&self, generation: &Family) -> Result<(), NativeError> {
        let _serialized = self.refreshing.lock().await;
        self.store.save(generation).await?;
        Ok(())
    }

    /// Renew the session over `transport`.
    pub async fn refresh(&self, transport: &dyn RefreshTransport) -> Result<Refresh, NativeError> {
        let _serialized = self.refreshing.lock().await;
        let mut family = self.store.load().await?.ok_or(NativeError::NoSession)?;
        if family.credentials.is_empty() {
            return Err(NativeError::Generation(GenerationError::Size(0)));
        }
        let mut pending = family.pending.unwrap_or_else(|| Pending {
            exchange: Exchange::random(),
            attempts: 0,
        });
        let index = usize::try_from(pending.attempts).unwrap_or(0) % family.credentials.len();
        let credential = SecretString::from(family.credentials[index].clone());
        // Recorded before sending: a crash after the request moves the next
        // attempt to another spare, under the same exchange.
        // A refresh is answered or ends long before four billion attempts.
        pending.attempts += 1;
        family.pending = Some(pending);
        self.store.save(&family).await?;

        let proof = native_proof(
            self.key.as_ref(),
            &transport.target(),
            ProofBinding::Refresh {
                credential: credential.expose_secret(),
                exchange: &pending.exchange,
            },
        )
        .await?;
        match transport
            .refresh(credential.expose_secret(), &proof, &pending.exchange)
            .await
        {
            Ok(renewed) => {
                self.store.save(&renewed.generation).await?;
                Ok(Refresh::Refreshed {
                    session_id: renewed.session_id,
                    access_token: renewed.access_token,
                    expires_in: renewed.expires_in,
                })
            }
            Err(TransportError::Unresolved(why)) => Ok(Refresh::Unavailable(why)),
            Err(TransportError::Refused(status))
                if status.code() == tonic::Code::Unauthenticated =>
            {
                self.store.clear().await?;
                Ok(Refresh::Ended)
            }
            Err(TransportError::Refused(status)) => Err(NativeError::Refused(status)),
        }
    }
}

/// RefreshNativeSession over the generated gRPC client, at the issuer whose
/// public origin is `origin` (the proof names the gRPC path there).
pub struct GrpcRefresh<T> {
    client: crate::proto::sid::v1::authn::auth_service_client::AuthServiceClient<T>,
    origin: String,
}

impl<T> GrpcRefresh<T> {
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

/// Whether a gRPC failure leaves the refresh's outcome unknown.
fn unresolved(code: tonic::Code) -> bool {
    matches!(
        code,
        tonic::Code::Unavailable
            | tonic::Code::DeadlineExceeded
            | tonic::Code::Cancelled
            | tonic::Code::Unknown
            | tonic::Code::Internal
            | tonic::Code::Aborted
    )
}

#[async_trait]
impl<T> RefreshTransport for GrpcRefresh<T>
where
    T: tonic::client::GrpcService<tonic::body::Body> + Clone + Send + Sync + 'static,
    T::Future: Send,
    T::ResponseBody: tonic::codegen::Body<Data = tonic::codegen::Bytes> + Send + 'static,
    <T::ResponseBody as tonic::codegen::Body>::Error: Into<tonic::codegen::StdError> + Send,
{
    fn target(&self) -> ProofTarget {
        ProofTarget::grpc(&self.origin, "RefreshNativeSession")
    }

    async fn refresh(
        &self,
        credential: &str,
        proof: &str,
        exchange: &Exchange,
    ) -> Result<Renewed, TransportError> {
        let mut request = tonic::Request::new(RefreshNativeSessionRequest {
            exchange: exchange.as_bytes().to_vec(),
        });
        for (name, value) in [(REFRESH_METADATA, credential), (PROOF_METADATA, proof)] {
            let mut value: MetadataValue<_> = value
                .parse()
                .map_err(|_| TransportError::Unresolved(format!("{name} is not a header value")))?;
            value.set_sensitive(true);
            request.metadata_mut().insert(name, value);
        }
        let response = match self.client.clone().refresh_native_session(request).await {
            Ok(response) => response,
            Err(status) if unresolved(status.code()) => {
                return Err(TransportError::Unresolved(status.message().to_owned()));
            }
            Err(status) => return Err(TransportError::Refused(status)),
        };
        // An answer the issuer committed but this client cannot read leaves
        // the outcome unknown to it: retried under the same exchange.
        let unreadable = |why: String| TransportError::Unresolved(why);
        let access_token = response
            .metadata()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(|t| SecretString::from(t.to_owned()))
            .ok_or_else(|| unreadable("no access token in the answer".into()))?;
        let generation = generation(response.metadata())
            .map_err(|e| unreadable(e.to_string()))?
            .ok_or_else(|| unreadable("no generation in the answer".into()))?;
        let body = response.into_inner();
        Ok(Renewed {
            session_id: body.session_id,
            access_token,
            expires_in: body.expires_in,
            generation,
        })
    }
}

#[cfg(all(test, feature = "software-key"))]
mod tests;
