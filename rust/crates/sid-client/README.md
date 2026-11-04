# sid-client

The StructuredID native client: what an application on a device needs to keep
its users signed in at a SID issuer, without an identity provider runtime of
its own. It depends on no SID server, storage or broker crate.

This release carries **native session renewal** (`sid/v1/authn/native_session.proto`):
a session whose sign-in proved the application's key is renewed with refresh
credentials bound to that key.

## Signing in with a renewable session

The native ceremony completions (`OpaqueLoginFinish`,
`WebAuthnAuthenticationFinish`, `VerifyTotp` completing a second factor)
accept a SID native proof of the application key in `sid-native-proof`
request metadata, binding that one ceremony:

```rust,ignore
use sid_client::proof::{native_proof, ProofBinding, ProofTarget};

let proof = native_proof(
    &key,
    &ProofTarget::grpc("https://sid.example.com", "OpaqueLoginFinish"),
    ProofBinding::Ceremony { reference: &login_id.value },
)
.await?;
// send `proof` as `sid-native-proof` with the finish request
```

The response carries the access token in `authorization` and the session's
first generation in `sid-native-credentials-bin`:

```rust,ignore
use sid_client::native::{generation, NativeSession};

if let Some(first) = generation(response.metadata())? {
    session.adopt(&first).await?;
}
```

## Renewing

```rust,ignore
use sid_client::native::{GrpcRefresh, Refresh};

match session.refresh(&GrpcRefresh::new(client, "https://sid.example.com")).await? {
    Refresh::Refreshed { access_token, expires_in, .. } => { /* use the token */ }
    Refresh::Ended => { /* sign in again */ }
    Refresh::Unavailable(_) => { /* retry later: the same exchange is kept */ }
}
```

`NativeSession` serializes the refreshes of one session only. A refresh whose
answer was lost is retried under the same exchange with the next spare
credential and a fresh proof; the exchange is stored before the request is
sent, so a restart retries it too. Each generation replaces the stored one
whole.

## What the application supplies

- **`ApplicationKey`**: the application instance's key, typically a platform
  key store handle. `SoftwareKey` (feature `software-key`, default) keeps a
  P-256 key in memory for platforms without one; its PKCS#8 encoding is the
  application's to keep.
- **`FamilyStore`**: where one session's credentials are kept, replaced whole
  on each write (secure storage scoped to the OS user, issuer, client and
  session). `MemoryFamilyStore` keeps nothing past the process.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
