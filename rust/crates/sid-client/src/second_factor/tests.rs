// SPDX-License-Identifier: Apache-2.0

use std::sync::Mutex;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};

use super::*;
use crate::key::SoftwareKey;

/// The response metadata of a sign-in that delivered `token`.
fn delivered(token: &str) -> MetadataMap {
    let mut metadata = MetadataMap::new();
    metadata.insert("authorization", format!("Bearer {token}").parse().unwrap());
    metadata
}

/// One completion the issuer double received.
#[derive(Debug, Clone)]
struct Sent {
    pending: String,
    claims: serde_json::Value,
    rpc: &'static str,
}

/// An issuer double answering each completion with the next scripted answer.
struct Issuer {
    sent: Mutex<Vec<Sent>>,
    answers: Mutex<Vec<Result<(), TransportError>>>,
}

impl Issuer {
    fn answering(answers: Vec<Result<(), TransportError>>) -> Self {
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
impl CompletionTransport for Issuer {
    fn target(&self, factor: Factor<'_>) -> ProofTarget {
        ProofTarget::grpc("https://sid.example.com", factor.rpc())
    }

    async fn complete(
        &self,
        pending: &str,
        proof: &str,
        factor: Factor<'_>,
    ) -> Result<Completed, TransportError> {
        let claims = serde_json::from_slice(
            &URL_SAFE_NO_PAD
                .decode(proof.split('.').nth(1).unwrap())
                .unwrap(),
        )
        .unwrap();
        self.sent.lock().unwrap().push(Sent {
            pending: pending.to_owned(),
            claims,
            rpc: factor.rpc(),
        });
        self.answers.lock().unwrap().remove(0).map(|()| Completed {
            session_id: sid_ids::SessionId::parse("0192f3a4-7c1e-7b2a-9d4e-3f5a6b7c8d9e").unwrap(),
            access_token: SecretString::from("access"),
            expires_in: 900,
            generation: None,
        })
    }
}

/// A sign-in owing its factor answers its pending context; a complete one
/// has none, and one owing a factor without its context is refused.
#[test]
fn a_pending_sign_in_is_read_from_its_answer() {
    let totp = StepUpMethod::Totp as i32;
    let pending = PendingSignIn::of(&delivered("pending-1"), &[totp])
        .unwrap()
        .unwrap();
    assert_eq!(pending.factors(), [StepUpMethod::Totp]);
    assert!(
        PendingSignIn::of(&delivered("session"), &[])
            .unwrap()
            .is_none()
    );
    assert!(PendingSignIn::of(&MetadataMap::new(), &[totp]).is_err());
    assert!(PendingSignIn::of(&delivered("pending-1"), &[99]).is_err());
}

/// The completion presents the pending context with a proof binding it to
/// the method that verifies the factor.
#[tokio::test]
async fn a_completion_proves_the_pending_context() {
    let key = SoftwareKey::generate();
    let pending = PendingSignIn::of(&delivered("pending-1"), &[StepUpMethod::Totp as i32])
        .unwrap()
        .unwrap();
    let issuer = Issuer::answering(vec![Ok(())]);

    let outcome = complete(&key, &issuer, &pending, Factor::Totp("123456"))
        .await
        .unwrap();
    assert!(matches!(outcome, Completion::Completed(_)), "{outcome:?}");

    let sent = issuer.sent();
    assert_eq!(sent[0].pending, "pending-1");
    assert_eq!(sent[0].rpc, "VerifyTotp");
    assert_eq!(
        sent[0].claims["sid_cer"],
        URL_SAFE_NO_PAD.encode(Sha256::digest(b"pending-1"))
    );
    assert_eq!(
        sent[0].claims["htu"],
        "https://sid.example.com/sid.v1.authn.AuthService/VerifyTotp"
    );
}

/// A lost answer leaves the outcome open: the same completion is sent again
/// with the same pending context and a new proof, and receives the sign-in.
#[tokio::test]
async fn a_lost_answer_is_sent_again_with_a_new_proof() {
    let key = SoftwareKey::generate();
    let pending = PendingSignIn::of(
        &delivered("pending-1"),
        &[StepUpMethod::RecoveryCode as i32],
    )
    .unwrap()
    .unwrap();
    let issuer = Issuer::answering(vec![
        Err(TransportError::Unresolved("connection reset".into())),
        Ok(()),
    ]);
    let factor = Factor::RecoveryCode("AAAA-BBBB-CCCC");

    let lost = complete(&key, &issuer, &pending, factor).await.unwrap();
    assert!(matches!(lost, Completion::Unavailable(_)), "{lost:?}");
    let again = complete(&key, &issuer, &pending, factor).await.unwrap();
    assert!(matches!(again, Completion::Completed(_)), "{again:?}");

    let sent = issuer.sent();
    assert_eq!(sent[0].pending, sent[1].pending);
    assert_eq!(sent[0].claims["sid_cer"], sent[1].claims["sid_cer"]);
    assert_ne!(sent[0].claims["jti"], sent[1].claims["jti"]);
}

/// A refusal (a wrong code, an ended context) is reported, not retried.
#[tokio::test]
async fn a_refusal_is_reported() {
    let key = SoftwareKey::generate();
    let pending = PendingSignIn::of(&delivered("pending-1"), &[StepUpMethod::Totp as i32])
        .unwrap()
        .unwrap();
    let issuer = Issuer::answering(vec![Err(TransportError::Refused(
        tonic::Status::unauthenticated("wrong code"),
    ))]);
    assert!(matches!(
        complete(&key, &issuer, &pending, Factor::Totp("000000")).await,
        Err(CompletionError::Refused(_))
    ));
}

/// Neither the pending token nor a code reaches a log.
#[test]
fn secrets_never_reach_a_log() {
    let pending = PendingSignIn::of(&delivered("pending-secret"), &[StepUpMethod::Totp as i32])
        .unwrap()
        .unwrap();
    assert!(!format!("{pending:?}").contains("pending-secret"));
    assert!(!format!("{:?}", Factor::Totp("123456")).contains("123456"));
}
