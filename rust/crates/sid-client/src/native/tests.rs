// SPDX-License-Identifier: Apache-2.0

use std::sync::Mutex;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};

use super::*;
use crate::key::SoftwareKey;

/// A generation of `credentials` as an issuer delivers it.
fn delivered(credentials: &[&str]) -> Family {
    let set = NativeCredentialSet {
        refresh_credentials: credentials.iter().map(|c| (*c).to_owned()).collect(),
        expires_in: 3600,
        redelivery_window: 30,
    };
    let mut metadata = MetadataMap::new();
    metadata.insert_bin(
        CREDENTIALS_METADATA,
        MetadataValue::from_bytes(&set.encode_to_vec()),
    );
    generation(&metadata).unwrap().unwrap()
}

/// One request the issuer double received: the credential, the proof's
/// claims and the exchange.
#[derive(Debug, Clone)]
struct Sent {
    credential: String,
    claims: serde_json::Value,
    exchange: Exchange,
}

/// An issuer double answering each request with the next scripted answer.
struct Issuer {
    sent: Mutex<Vec<Sent>>,
    answers: Mutex<Vec<Result<Family, TransportError>>>,
}

impl Issuer {
    fn answering(answers: Vec<Result<Family, TransportError>>) -> Self {
        Self {
            sent: Mutex::new(Vec::new()),
            answers: Mutex::new(answers),
        }
    }

    fn sent(&self) -> Vec<Sent> {
        self.sent.lock().unwrap().clone()
    }
}

#[async_trait]
impl RefreshTransport for Issuer {
    fn target(&self) -> ProofTarget {
        ProofTarget::grpc("https://sid.example.com", "RefreshNativeSession")
    }

    async fn refresh(
        &self,
        credential: &str,
        proof: &str,
        exchange: &Exchange,
    ) -> Result<Renewed, TransportError> {
        let claims = serde_json::from_slice(
            &URL_SAFE_NO_PAD
                .decode(proof.split('.').nth(1).unwrap())
                .unwrap(),
        )
        .unwrap();
        self.sent.lock().unwrap().push(Sent {
            credential: credential.to_owned(),
            claims,
            exchange: *exchange,
        });
        self.answers
            .lock()
            .unwrap()
            .remove(0)
            .map(|generation| Renewed {
                session_id: sid_ids::SessionId::parse("0192f3a4-7c1e-7b2a-9d4e-3f5a6b7c8d9e")
                    .unwrap(),
                access_token: SecretString::from("access"),
                expires_in: 900,
                generation,
            })
    }
}

fn session(store: Arc<MemoryFamilyStore>) -> NativeSession {
    NativeSession::new(Arc::new(SoftwareKey::generate()), store)
}

/// A refresh presents a credential of the current generation with a proof
/// binding it and the exchange, and stores the next generation whole.
#[tokio::test]
async fn a_refresh_stores_the_next_generation() {
    let store = Arc::new(MemoryFamilyStore::default());
    let session = session(store.clone());
    session.adopt(&delivered(&["a", "b"])).await.unwrap();
    let issuer = Issuer::answering(vec![Ok(delivered(&["c", "d"]))]);

    let refreshed = session.refresh(&issuer).await.unwrap();
    assert!(
        matches!(refreshed, Refresh::Refreshed { .. }),
        "{refreshed:?}"
    );
    let sent = issuer.sent();
    assert_eq!(sent[0].credential, "a");
    assert_eq!(
        sent[0].claims["sid_rt"],
        URL_SAFE_NO_PAD.encode(Sha256::digest(b"a"))
    );
    assert_eq!(
        sent[0].claims["sid_ex"],
        URL_SAFE_NO_PAD.encode(sent[0].exchange.as_bytes())
    );
    assert_eq!(
        sent[0].claims["htu"],
        "https://sid.example.com/sid.v1.authn.AuthService/RefreshNativeSession"
    );
    let stored = store.load().await.unwrap().unwrap();
    assert_eq!(stored, delivered(&["c", "d"]));
    assert!(!stored.refresh_pending());
}

/// A lost answer: the retry keeps the exchange, presents the next spare
/// credential with a new proof, and stores what it receives.
#[tokio::test]
async fn a_lost_answer_is_retried_under_the_same_exchange() {
    let store = Arc::new(MemoryFamilyStore::default());
    let session = session(store.clone());
    session.adopt(&delivered(&["a", "b"])).await.unwrap();
    let issuer = Issuer::answering(vec![
        Err(TransportError::Unresolved("connection reset".into())),
        Ok(delivered(&["c", "d"])),
    ]);

    let lost = session.refresh(&issuer).await.unwrap();
    assert!(matches!(lost, Refresh::Unavailable(_)), "{lost:?}");
    assert!(store.load().await.unwrap().unwrap().refresh_pending());
    let retried = session.refresh(&issuer).await.unwrap();
    assert!(matches!(retried, Refresh::Refreshed { .. }), "{retried:?}");

    let sent = issuer.sent();
    assert_eq!(sent[0].exchange, sent[1].exchange);
    assert_eq!(sent[0].credential, "a");
    assert_eq!(sent[1].credential, "b");
    assert_ne!(sent[0].claims["jti"], sent[1].claims["jti"]);
}

/// A crash after the request was sent: a new process over the same store
/// retries the same exchange with another spare.
#[tokio::test]
async fn a_restart_retries_the_unresolved_exchange() {
    let store = Arc::new(MemoryFamilyStore::default());
    let issuer = Issuer::answering(vec![
        Err(TransportError::Unresolved("process ended".into())),
        Ok(delivered(&["c", "d"])),
    ]);
    {
        let before = session(store.clone());
        before.adopt(&delivered(&["a", "b"])).await.unwrap();
        before.refresh(&issuer).await.unwrap();
    }
    // The same key across the restart is the application's; a new process
    // here only shows the exchange comes from the store.
    let after = session(store.clone());
    after.refresh(&issuer).await.unwrap();
    let sent = issuer.sent();
    assert_eq!(sent[0].exchange, sent[1].exchange);
    assert_eq!(sent[1].credential, "b");
}

/// An ended session (UNAUTHENTICATED) clears the store: the user signs in
/// again. Another refusal keeps the generation.
#[tokio::test]
async fn an_ended_session_is_cleared() {
    let store = Arc::new(MemoryFamilyStore::default());
    let session = session(store.clone());
    session.adopt(&delivered(&["a", "b"])).await.unwrap();
    let issuer = Issuer::answering(vec![
        Err(TransportError::Refused(tonic::Status::invalid_argument(
            "proof",
        ))),
        Err(TransportError::Refused(tonic::Status::unauthenticated(
            "ended",
        ))),
    ]);
    assert!(matches!(
        session.refresh(&issuer).await,
        Err(NativeError::Refused(_))
    ));
    assert!(store.load().await.unwrap().is_some());
    assert!(matches!(
        session.refresh(&issuer).await.unwrap(),
        Refresh::Ended
    ));
    assert!(store.load().await.unwrap().is_none());
    assert!(matches!(
        session.refresh(&issuer).await,
        Err(NativeError::NoSession)
    ));
}

/// Two refreshes of one session at once run one after the other: the second
/// presents a credential of the generation the first stored, never a spare of
/// the rotated one.
#[tokio::test]
async fn refreshes_of_one_session_are_serialized() {
    let store = Arc::new(MemoryFamilyStore::default());
    let session = Arc::new(session(store));
    session.adopt(&delivered(&["a", "b"])).await.unwrap();
    let issuer = Arc::new(Issuer::answering(vec![
        Ok(delivered(&["c", "d"])),
        Ok(delivered(&["e", "f"])),
    ]));
    let (first, second) = tokio::join!(
        session.refresh(issuer.as_ref()),
        session.refresh(issuer.as_ref())
    );
    first.unwrap();
    second.unwrap();
    let sent = issuer.sent();
    assert_eq!(sent[0].credential, "a");
    assert_eq!(sent[1].credential, "c");
}

/// A delivered generation outside the protocol's bounds is refused; a
/// response delivering none has none.
#[test]
fn a_generation_outside_its_bounds_is_refused() {
    assert!(generation(&MetadataMap::new()).unwrap().is_none());
    let set = |credentials: Vec<String>, expires_in| NativeCredentialSet {
        refresh_credentials: credentials,
        expires_in,
        redelivery_window: 30,
    };
    for set in [
        set(vec![], 3600),
        set((0..17).map(|i| i.to_string()).collect(), 3600),
        set(vec![String::new()], 3600),
        set(vec!["a".into()], 0),
    ] {
        let mut metadata = MetadataMap::new();
        metadata.insert_bin(
            CREDENTIALS_METADATA,
            MetadataValue::from_bytes(&set.encode_to_vec()),
        );
        assert!(generation(&metadata).is_err());
    }
}

/// The family's debug output names no credential.
#[test]
fn credentials_never_reach_a_log() {
    let family = delivered(&["secret-credential"]);
    assert!(!format!("{family:?}").contains("secret-credential"));
}
