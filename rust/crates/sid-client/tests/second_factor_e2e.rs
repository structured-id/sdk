// SPDX-License-Identifier: Apache-2.0
//! A native sign-in owing its second factor, end to end against a SID issuer
//! over the network (the issuer's test build, `sid-test-issuer`): the
//! password sign-in of an account with an enrolled authenticator answers its
//! pending context, the client completes it with a code and a key-bound
//! proof, and the session it receives renews. A completion whose answer was
//! lost is sent again and receives the sign-in the first attempt committed.

use std::sync::Arc;

use async_trait::async_trait;
use sid_client::key::SoftwareKey;
use sid_client::native::{
    self, GrpcRefresh, MemoryFamilyStore, NativeSession, PROOF_METADATA, Refresh, TransportError,
};
use sid_client::proof::{ProofBinding, ProofTarget, native_proof};
use sid_client::proto::sid::v1::authn::auth_service_client::AuthServiceClient;
use sid_client::second_factor::{
    self, Completed, Completion, CompletionTransport, Factor, GrpcCompletion, PendingSignIn,
};
use sid_test_issuer::{INSTALLATION, Setup, TestIssuer, totp_code};
use tonic::transport::Channel;

const USER: &str = "native-mfa@sid.example.com";
const PASSWORD: &[u8] = b"native-mfa-password-2026";

fn channel(issuer: &TestIssuer) -> Channel {
    Channel::from_shared(issuer.upstream())
        .unwrap()
        .connect_lazy()
}

fn completion(issuer: &TestIssuer) -> GrpcCompletion<Channel> {
    GrpcCompletion::new(AuthServiceClient::new(channel(issuer)), INSTALLATION)
}

/// An account with an enrolled authenticator; returns its seed.
async fn protected_account(issuer: &TestIssuer) -> Vec<u8> {
    let profile = issuer.password_account(USER, PASSWORD).await;
    issuer.enroll_totp(&profile).await
}

/// A password sign-in proving `key` over its `login_id`, as a native
/// application signs in; returns the pending context it answered.
async fn pending_sign_in(issuer: &TestIssuer, key: &SoftwareKey) -> PendingSignIn {
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
        .expect("the pending context");
    // A pending context renews nothing: no generation before the factor.
    assert!(native::generation(response.metadata()).unwrap().is_none());
    let second_factors = response.get_ref().second_factors.clone();
    PendingSignIn::of(response.metadata(), &second_factors)
        .unwrap()
        .expect("the sign-in owes its second factor")
}

fn completed(outcome: Completion) -> Completed {
    match outcome {
        Completion::Completed(completed) => completed,
        other => panic!("not completed: {other:?}"),
    }
}

/// A transport that delivers each completion and then loses the answer, as a
/// dropped connection does after the issuer committed.
struct LosesAnswers<T>(T);

#[async_trait]
impl<T: CompletionTransport> CompletionTransport for LosesAnswers<T> {
    fn target(&self, factor: Factor<'_>) -> ProofTarget {
        self.0.target(factor)
    }
    async fn complete(
        &self,
        pending: &str,
        proof: &str,
        factor: Factor<'_>,
    ) -> Result<Completed, TransportError> {
        self.0.complete(pending, proof, factor).await?;
        Err(TransportError::Unresolved("the answer was lost".into()))
    }
}

/// The completed sign-in's generation renews the session it opened.
#[tokio::test]
async fn a_protected_native_sign_in_completes_and_renews() {
    let issuer = TestIssuer::start(Setup::default()).await;
    let seed = protected_account(&issuer).await;
    let key = Arc::new(SoftwareKey::generate());
    let pending = pending_sign_in(&issuer, &key).await;
    assert_eq!(
        pending.factors(),
        [sid_client::proto::sid::v1::authn::StepUpMethod::Totp]
    );

    let code = totp_code(&seed);
    let done = completed(
        second_factor::complete(
            key.as_ref(),
            &completion(&issuer),
            &pending,
            Factor::Totp(&code),
        )
        .await
        .unwrap(),
    );
    let generation = done
        .generation
        .expect("a proved sign-in receives its first generation");

    let session = NativeSession::new(key.clone(), Arc::new(MemoryFamilyStore::default()));
    session.adopt(&generation).await.unwrap();
    let transport = GrpcRefresh::new(AuthServiceClient::new(channel(&issuer)), INSTALLATION);
    match session.refresh(&transport).await.unwrap() {
        Refresh::Refreshed { session_id, .. } => assert_eq!(session_id, done.session_id),
        other => panic!("not renewed: {other:?}"),
    }
}

/// The completion's answer is lost after the issuer committed: the same
/// completion, sent again with a new proof, receives the session the first
/// attempt opened. The spent code is not judged a second time.
#[tokio::test]
async fn a_lost_completion_is_redelivered() {
    let issuer = TestIssuer::start(Setup::default()).await;
    let seed = protected_account(&issuer).await;
    let key = SoftwareKey::generate();
    let pending = pending_sign_in(&issuer, &key).await;
    let code = totp_code(&seed);

    let lost = second_factor::complete(
        &key,
        &LosesAnswers(completion(&issuer)),
        &pending,
        Factor::Totp(&code),
    )
    .await
    .unwrap();
    assert!(matches!(lost, Completion::Unavailable(_)), "{lost:?}");

    let again = completed(
        second_factor::complete(&key, &completion(&issuer), &pending, Factor::Totp(&code))
            .await
            .unwrap(),
    );
    assert!(again.generation.is_some());
}

/// A wrong code completes nothing and is reported as refused.
#[tokio::test]
async fn a_wrong_code_completes_nothing() {
    let issuer = TestIssuer::start(Setup::default()).await;
    protected_account(&issuer).await;
    let key = SoftwareKey::generate();
    let pending = pending_sign_in(&issuer, &key).await;
    let refused =
        second_factor::complete(&key, &completion(&issuer), &pending, Factor::Totp("000000")).await;
    assert!(
        matches!(refused, Err(second_factor::CompletionError::Refused(_))),
        "{refused:?}"
    );
}
