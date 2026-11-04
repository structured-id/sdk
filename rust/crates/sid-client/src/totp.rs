// SPDX-License-Identifier: Apache-2.0
//! Presentation of a TOTP enrollment. The server sends the raw shared secret
//! and its parameters; an authenticator app takes the Base32 secret typed in,
//! or the `otpauth://totp` URI behind a QR code.

use crate::proto::sid::v1::authn::{TotpAlgorithm, TotpEnrollmentChallenge};

const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// A challenge an authenticator app cannot be given faithfully.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TotpUriError {
    /// It lacks the secret, the algorithm, the digits or the period.
    #[error("the TOTP enrollment names no secret, algorithm, digits or period")]
    Incomplete,
    /// Its issuer or account holds the colon the label separates them with
    /// (Key URI Format, Label: neither may contain one, literal or `%3A`).
    #[error("a TOTP issuer or account cannot contain a colon")]
    ColonInLabel,
}

/// `bytes` in Base32 (RFC 4648 §6), without padding.
pub fn base32(bytes: &[u8]) -> String {
    let mut out = String::with_capacity((bytes.len() * 8).div_ceil(5));
    let (mut buffer, mut bits) = (0u16, 0u32);
    for &byte in bytes {
        // At most 4 bits stay from the previous byte, so 12 fit in u16.
        buffer = (buffer << 8) | u16::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(char::from(ALPHABET[usize::from((buffer >> bits) & 0x1f)]));
        }
        buffer &= (1 << bits) - 1;
    }
    if bits > 0 {
        out.push(char::from(
            ALPHABET[usize::from((buffer << (5 - bits)) & 0x1f)],
        ));
    }
    out
}

/// `text` percent-encoded as a URI component: only RFC 3986 §2.3 unreserved
/// characters stay as they are.
fn component(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// The `otpauth://totp/<issuer>:<account>` URI of `challenge`, with issuer and
/// account percent-encoded so neither can split the label or add a parameter.
pub fn otpauth_uri(challenge: &TotpEnrollmentChallenge) -> Result<String, TotpUriError> {
    let algorithm = match TotpAlgorithm::try_from(challenge.algorithm) {
        Ok(TotpAlgorithm::Sha1) => "SHA1",
        Ok(TotpAlgorithm::Sha256) => "SHA256",
        Ok(TotpAlgorithm::Sha512) => "SHA512",
        Ok(TotpAlgorithm::Unspecified) | Err(_) => return Err(TotpUriError::Incomplete),
    };
    if challenge.digits == 0 || challenge.period_seconds == 0 || challenge.shared_secret.is_empty()
    {
        return Err(TotpUriError::Incomplete);
    }
    if challenge.issuer.contains(':') || challenge.account_name.contains(':') {
        return Err(TotpUriError::ColonInLabel);
    }
    let issuer = component(&challenge.issuer);
    Ok(format!(
        "otpauth://totp/{issuer}:{account}?secret={secret}&issuer={issuer}\
         &algorithm={algorithm}&digits={digits}&period={period}",
        account = component(&challenge.account_name),
        secret = base32(&challenge.shared_secret),
        digits = challenge.digits,
        period = challenge.period_seconds,
    ))
}

#[cfg(test)]
mod tests;
