//! Uses the identifier crates the way a downstream project does: decode a
//! wire message, validate it into the domain type, encode it back. Builds for
//! a no_std + alloc target; its tests run on the host.

#![cfg_attr(not(test), no_std)]

extern crate alloc;

use alloc::vec::Vec;
use prost::Message;

/// Why the bytes did not round-trip.
#[derive(Debug)]
pub enum RoundTripError {
    /// Not an encoded message.
    Decode(prost::DecodeError),
    /// A message whose identifier is not valid.
    Identifier(sid_ids_proto::WireIdError),
}

/// The validated BindingId behind encoded `sid.v1.ids.BindingId` bytes,
/// encoded again: the bytes survive, an invalid identifier is refused.
pub fn binding_round_trip(encoded: &[u8]) -> Result<Vec<u8>, RoundTripError> {
    let wire = sid_ids_proto::BindingId::decode(encoded).map_err(RoundTripError::Decode)?;
    let id: sid_ids::BindingId =
        sid_ids_proto::required(Some(&wire)).map_err(RoundTripError::Identifier)?;
    Ok(sid_ids_proto::BindingId::from(id).encode_to_vec())
}

#[cfg(test)]
mod tests;
