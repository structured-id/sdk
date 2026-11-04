// SPDX-License-Identifier: Apache-2.0
//! The StructuredID native client: what an application on a device needs to
//! keep its users signed in at a SID issuer, without an identity provider
//! runtime of its own.
//!
//! This release carries native session renewal (`native_session.proto`): a
//! session whose sign-in proved the application's key is renewed with refresh
//! credentials bound to that key. [`native::NativeSession`] serializes the
//! renewals of one session, keeps one exchange across the retries of a lost
//! answer with a fresh proof each time, and stores each generation whole.
//! The key ([`key::ApplicationKey`]) and the store ([`native::FamilyStore`])
//! are the application's, typically a platform key store and secure storage.

pub mod key;
pub mod native;
pub mod proof;
pub mod totp;

/// The generated AuthService client and messages (client only: no server
/// stubs), for the requests a native client sends.
pub mod proto {
    pub mod google {
        pub mod api {
            include!(concat!(env!("OUT_DIR"), "/google.api.rs"));
        }
    }
    pub mod sid {
        pub mod v1 {
            pub mod authn {
                include!(concat!(env!("OUT_DIR"), "/sid.v1.authn.rs"));
            }
            pub mod common {
                include!(concat!(env!("OUT_DIR"), "/sid.v1.common.rs"));
            }
        }
    }
}
