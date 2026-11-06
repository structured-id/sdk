// SPDX-License-Identifier: Apache-2.0
//! Native session renewal end to end: this client against a SID issuer over
//! the network (the issuer's own test build, `sid-test-issuer`). A password
//! sign-in proves the application key and receives a refresh generation; the
//! client renews with it through lost answers, a second replica, a restart
//! of either side, and refuses to let a wrong key or endpoint end the
//! session.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use sid_client::key::SoftwareKey;
use sid_client::native::{
    self, Family, FamilyStore, GrpcRefresh, MemoryFamilyStore, NativeSession, PROOF_METADATA,
    REFRESH_METADATA, Refresh, RefreshTransport, Renewed, TransportError,
};
use sid_client::proof::{Exchange, ProofBinding, ProofTarget, native_proof};
use sid_client::proto::sid::v1::authn::RefreshNativeSessionRequest;
use sid_client::proto::sid::v1::authn::auth_service_client::AuthServiceClient;
use sid_test_issuer::{INSTALLATION, Installation, Setup, TestIssuer};
use tonic::transport::Channel;

const USER: &str = "native-e2e@sid.example.com";
const PASSWORD: &[u8] = b"native-e2e-password-2026";

fn channel(issuer: &TestIssuer) -> Channel {
    Channel::from_shared(issuer.upstream())
        .unwrap()
        .connect_lazy()
}

fn transport(issuer: &TestIssuer) -> GrpcRefresh<Channel> {
    GrpcRefresh::new(AuthServiceClient::new(channel(issuer)), INSTALLATION)
}

/// A password sign-in at `issuer` whose finish proves `key` over its
/// `login_id`, as a native application signs in; returns the generation it
/// delivered.
async fn sign_in(issuer: &TestIssuer, key: &SoftwareKey) -> Family {
    let finish = issuer.start_password_login(USER, PASSWORD).await;
    let reference = finish.login_id.as_ref().expect("a login id").value.clone();
    let proof = native_proof(
        key,
        &ProofTarget::grpc(INSTALLATION, "OpaqueLoginFinish"),
        ProofBinding::Ceremony {
            reference: &reference,
        },
    )
    .await
    .unwrap();
    let mut request = tonic::Request::new(finish);
    request
        .metadata_mut()
        .insert(PROOF_METADATA, proof.parse().unwrap());
    let response = sid_proto::sid::v1::auth_service_client::AuthServiceClient::new(channel(issuer))
        .opaque_login_finish(request)
        .await
        .expect("signed in");
    native::generation(response.metadata())
        .expect("a readable generation")
        .expect("a sign-in that proved the key gets a generation")
}

/// A signed-in session of `issuer`, renewed with a key of its own.
async fn session(issuer: &TestIssuer) -> (Arc<SoftwareKey>, Arc<MemoryFamilyStore>, NativeSession) {
    let key = Arc::new(SoftwareKey::generate());
    let store = Arc::new(MemoryFamilyStore::default());
    let session = NativeSession::new(key.clone(), store.clone());
    session.adopt(&sign_in(issuer, &key).await).await.unwrap();
    (key, store, session)
}

fn refreshed(outcome: Refresh) -> String {
    match outcome {
        Refresh::Refreshed { session_id, .. } => session_id.to_string(),
        other => panic!("not renewed: {other:?}"),
    }
}

/// A transport that delivers each call to the issuer and then loses the
/// answer, as a dropped connection does after the issuer committed.
struct LosesAnswers<T>(T);

#[async_trait]
impl<T: RefreshTransport> RefreshTransport for LosesAnswers<T> {
    fn target(&self) -> ProofTarget {
        self.0.target()
    }
    async fn refresh(
        &self,
        credential: &str,
        proof: &str,
        exchange: &Exchange,
    ) -> Result<Renewed, TransportError> {
        self.0.refresh(credential, proof, exchange).await?;
        Err(TransportError::Unresolved("the answer was lost".into()))
    }
}

/// A transport recording what it sends, so a test can present it again.
struct Records<T> {
    inner: T,
    sent: Mutex<Vec<(String, String, Exchange)>>,
}

#[async_trait]
impl<T: RefreshTransport> RefreshTransport for Records<T> {
    fn target(&self) -> ProofTarget {
        self.inner.target()
    }
    async fn refresh(
        &self,
        credential: &str,
        proof: &str,
        exchange: &Exchange,
    ) -> Result<Renewed, TransportError> {
        self.sent
            .lock()
            .unwrap()
            .push((credential.to_owned(), proof.to_owned(), *exchange));
        self.inner.refresh(credential, proof, exchange).await
    }
}

/// A transport whose proofs name another request than the one it sends.
struct NamesAnother<T>(T, ProofTarget);

#[async_trait]
impl<T: RefreshTransport> RefreshTransport for NamesAnother<T> {
    fn target(&self) -> ProofTarget {
        self.1.clone()
    }
    async fn refresh(
        &self,
        credential: &str,
        proof: &str,
        exchange: &Exchange,
    ) -> Result<Renewed, TransportError> {
        self.0.refresh(credential, proof, exchange).await
    }
}

/// The sign-in's generation renews the same session, and every renewal
/// hands over the next generation, which renews again.
#[tokio::test]
async fn a_proved_sign_in_renews_its_session() {
    let issuer = TestIssuer::start(Setup::default()).await;
    issuer.password_account(USER, PASSWORD).await;
    let (_key, _store, session) = session(&issuer).await;
    let first = refreshed(session.refresh(&transport(&issuer)).await.unwrap());
    let second = refreshed(session.refresh(&transport(&issuer)).await.unwrap());
    assert_eq!(first, second, "one logical session");
}

/// An answer lost after the issuer committed: the retry presents the next
/// spare credential with a new proof under the same exchange and receives
/// the generation the first attempt committed. Without that redelivery the
/// retired generation would end the session.
#[tokio::test]
async fn a_lost_answer_is_redelivered() {
    let issuer = TestIssuer::start(Setup::default()).await;
    issuer.password_account(USER, PASSWORD).await;
    let (_key, store, session) = session(&issuer).await;
    let lost = session
        .refresh(&LosesAnswers(transport(&issuer)))
        .await
        .unwrap();
    assert!(matches!(lost, Refresh::Unavailable(_)), "{lost:?}");
    assert!(store.load().await.unwrap().unwrap().refresh_pending());

    refreshed(session.refresh(&transport(&issuer)).await.unwrap());
    assert!(!store.load().await.unwrap().unwrap().refresh_pending());
    // The redelivered generation is the session's live successor.
    refreshed(session.refresh(&transport(&issuer)).await.unwrap());
}

/// A proof is good for one request: presented again at another replica of
/// the installation it renews nothing, and the session it was taken from
/// still renews.
#[tokio::test]
async fn a_replayed_proof_renews_nothing_at_another_replica() {
    let dir = tempfile::tempdir().unwrap();
    let installation = Installation::at(&dir.path().join("sid.db"));
    let first = TestIssuer::replica(Setup::default(), &installation).await;
    let second = TestIssuer::replica(Setup::default(), &installation).await;
    first.password_account(USER, PASSWORD).await;
    let (_key, _store, session) = session(&first).await;

    let recording = Records {
        inner: transport(&first),
        sent: Mutex::new(Vec::new()),
    };
    refreshed(session.refresh(&recording).await.unwrap());
    let (credential, proof, exchange) = recording.sent.lock().unwrap()[0].clone();
    let mut replay = tonic::Request::new(RefreshNativeSessionRequest {
        exchange: exchange.as_bytes().to_vec(),
    });
    replay
        .metadata_mut()
        .insert(REFRESH_METADATA, credential.parse().unwrap());
    replay
        .metadata_mut()
        .insert(PROOF_METADATA, proof.parse().unwrap());
    let refused = AuthServiceClient::new(channel(&second))
        .refresh_native_session(replay)
        .await
        .expect_err("a replayed proof renews nothing");
    // Refused as a bad proof, not as an ended session: a replay must not let
    // anyone end the victim's session.
    assert_eq!(refused.code(), tonic::Code::InvalidArgument, "{refused:?}");
    assert!(refused.message().contains("replay"), "{refused:?}");

    refreshed(session.refresh(&transport(&second)).await.unwrap());
}

/// Neither side's restart ends the session: the issuer started again on its
/// store, and the client started again with its stored family and key.
#[tokio::test]
async fn a_restart_of_either_side_keeps_the_session() {
    let dir = tempfile::tempdir().unwrap();
    let installation = Installation::at(&dir.path().join("sid.db"));
    let mut issuer = TestIssuer::replica(Setup::default(), &installation).await;
    issuer.password_account(USER, PASSWORD).await;
    let (key, store, session) = session(&issuer).await;
    refreshed(session.refresh(&transport(&issuer)).await.unwrap());

    issuer.stop().await;
    drop(issuer);
    let issuer = TestIssuer::replica(Setup::default(), &installation).await;
    drop(session);
    let restarted = NativeSession::new(key, store);
    refreshed(restarted.refresh(&transport(&issuer)).await.unwrap());
}

/// Stolen credentials without the key renew nothing, and the theft ends
/// nothing: an invalid proof is not a way to end someone's session.
#[tokio::test]
async fn stolen_credentials_without_the_key_renew_and_end_nothing() {
    let issuer = TestIssuer::start(Setup::default()).await;
    issuer.password_account(USER, PASSWORD).await;
    let (_key, store, session) = session(&issuer).await;

    let copied = Arc::new(MemoryFamilyStore::default());
    copied
        .save(&store.load().await.unwrap().unwrap())
        .await
        .unwrap();
    let thief = NativeSession::new(Arc::new(SoftwareKey::generate()), copied);
    let attempt = thief.refresh(&transport(&issuer)).await;
    assert!(
        !matches!(attempt, Ok(Refresh::Refreshed { .. })),
        "another key renewed: {attempt:?}"
    );

    refreshed(session.refresh(&transport(&issuer)).await.unwrap());
}

/// A proof naming another endpoint than the one it is sent to renews
/// nothing and ends nothing.
#[tokio::test]
async fn a_proof_for_another_endpoint_renews_and_ends_nothing() {
    let issuer = TestIssuer::start(Setup::default()).await;
    issuer.password_account(USER, PASSWORD).await;
    let (_key, _store, session) = session(&issuer).await;
    let elsewhere = NamesAnother(
        transport(&issuer),
        ProofTarget::grpc("https://other.example.com", "RefreshNativeSession"),
    );
    let attempt = session.refresh(&elsewhere).await;
    assert!(
        !matches!(attempt, Ok(Refresh::Refreshed { .. })),
        "a proof for another endpoint renewed: {attempt:?}"
    );
    refreshed(session.refresh(&transport(&issuer)).await.unwrap());
}

/// A refresh racing the session's end: whichever commits first, the session
/// renews no more once it ended.
#[tokio::test]
async fn a_refresh_racing_the_end_leaves_the_session_ended() {
    let issuer = TestIssuer::start(Setup::default()).await;
    issuer.password_account(USER, PASSWORD).await;
    let (_key, _store, session) = session(&issuer).await;
    let id = refreshed(session.refresh(&transport(&issuer)).await.unwrap());
    let stored = issuer
        .storage
        .get_session(sid_core::models::SessionId::parse(&id).unwrap())
        .await
        .unwrap()
        .expect("the session");
    let transport = transport(&issuer);
    let (raced, ()) = tokio::join!(session.refresh(&transport), issuer.end(&stored));
    let after = session.refresh(&transport).await;
    // A raced refresh that already learned of the end has dropped the family,
    // so the client holds no session; otherwise the issuer answers the end.
    match raced.unwrap() {
        Refresh::Ended => assert!(
            matches!(after, Err(native::NativeError::NoSession)),
            "{after:?}"
        ),
        _ => assert!(matches!(after, Ok(Refresh::Ended)), "{after:?}"),
    }
}

/// An ended session renews no more, also with its live generation.
#[tokio::test]
async fn an_ended_session_renews_no_more() {
    let issuer = TestIssuer::start(Setup::default()).await;
    issuer.password_account(USER, PASSWORD).await;
    let (_key, _store, session) = session(&issuer).await;
    let id = refreshed(session.refresh(&transport(&issuer)).await.unwrap());
    let stored = issuer
        .storage
        .get_session(sid_core::models::SessionId::parse(&id).unwrap())
        .await
        .unwrap()
        .expect("the session");
    issuer.end(&stored).await;
    let ended = session.refresh(&transport(&issuer)).await.unwrap();
    assert!(matches!(ended, Refresh::Ended), "{ended:?}");
}

/// Refresh latency over the loopback network and the SQLite store, printed
/// as measured (no bound is claimed from one machine).
#[tokio::test]
async fn refresh_latency() {
    let issuer = TestIssuer::start(Setup::default()).await;
    issuer.password_account(USER, PASSWORD).await;
    let (_key, _store, session) = session(&issuer).await;
    let transport = transport(&issuer);
    let mut samples: Vec<Duration> = Vec::with_capacity(100);
    for _ in 0..100 {
        let started = Instant::now();
        refreshed(session.refresh(&transport).await.unwrap());
        samples.push(started.elapsed());
    }
    samples.sort_unstable();
    println!(
        "native refresh over loopback: P50 {:?}, P99 {:?} (100 refreshes)",
        samples[49], samples[98]
    );
}
