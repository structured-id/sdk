// SPDX-License-Identifier: Apache-2.0

use super::*;

fn challenge() -> TotpEnrollmentChallenge {
    TotpEnrollmentChallenge {
        issuer: "StructuredID".into(),
        account_name: "alice@sid.example.com".into(),
        shared_secret: b"12345678901234567890".to_vec(),
        algorithm: TotpAlgorithm::Sha1.into(),
        digits: 6,
        period_seconds: 30,
    }
}

/// RFC 4648 §10 test vectors, unpadded.
#[test]
fn base32_is_rfc_4648_without_padding() {
    for (input, encoded) in [
        ("", ""),
        ("f", "MY"),
        ("fo", "MZXQ"),
        ("foo", "MZXW6"),
        ("foob", "MZXW6YQ"),
        ("fooba", "MZXW6YTB"),
        ("foobar", "MZXW6YTBOI"),
    ] {
        assert_eq!(base32(input.as_bytes()), encoded);
    }
}

/// The RFC 6238 Appendix B secret, as authenticator apps scan it.
#[test]
fn the_uri_carries_the_secret_and_the_servers_parameters() {
    assert_eq!(
        otpauth_uri(&challenge()).unwrap(),
        "otpauth://totp/StructuredID:alice%40sid.example.com\
         ?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=StructuredID\
         &algorithm=SHA1&digits=6&period=30"
    );
}

/// Regression guard: reserved characters in issuer or account cannot split
/// the label or add a parameter.
#[test]
fn issuer_and_account_are_percent_encoded() {
    let mut odd = challenge();
    odd.issuer = "Acme Ops & Co #1".into();
    odd.account_name = "a+b?d=e&f g(x)!".into();
    let uri = otpauth_uri(&odd).unwrap();
    assert_eq!(
        uri,
        "otpauth://totp/Acme%20Ops%20%26%20Co%20%231:a%2Bb%3Fd%3De%26f%20g%28x%29%21\
         ?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Acme%20Ops%20%26%20Co%20%231\
         &algorithm=SHA1&digits=6&period=30"
    );
}

/// The Key URI Format separates issuer and account with a colon, encoded or
/// not, so neither may hold one: such a label is refused, not encoded.
#[test]
fn a_colon_in_issuer_or_account_is_refused() {
    let mut issuer = challenge();
    issuer.issuer = "Acme: Ops".into();
    let mut account = challenge();
    account.account_name = "a:b@sid.example.com".into();
    for c in [issuer, account] {
        assert_eq!(otpauth_uri(&c), Err(TotpUriError::ColonInLabel));
    }
}

/// A challenge without its secret or a parameter is refused, never guessed.
#[test]
fn an_incomplete_challenge_is_refused() {
    let mut cases = Vec::new();
    let mut c = challenge();
    c.algorithm = TotpAlgorithm::Unspecified.into();
    cases.push(c);
    let mut c = challenge();
    c.algorithm = 99;
    cases.push(c);
    let mut c = challenge();
    c.digits = 0;
    cases.push(c);
    let mut c = challenge();
    c.period_seconds = 0;
    cases.push(c);
    let mut c = challenge();
    c.shared_secret.clear();
    cases.push(c);
    for c in cases {
        assert_eq!(otpauth_uri(&c), Err(TotpUriError::Incomplete), "{c:?}");
    }
}
