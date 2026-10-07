/**
 * StructuredID identifiers for TypeScript.
 *
 * Each identifier kind is its own class (`BindingId`, `MachineUserId`, ...),
 * built only through validation: exactly 16 bytes of an RFC 9562 UUIDv7, not
 * nil or max. `wire` holds the generated `sid.v1.ids` messages with their
 * binary and standard ProtoJSON codecs; decoding one proves nothing, and the
 * checked conversion (`fromWire`, `required`, `optional`) validates it.
 */
export { IdError, MissingIdError, type IdErrorReason, type IdKind } from "./errors";
export {
  BindingId,
  MachineUserId,
  PasswordOperationId,
  ProvisioningConnectorId,
  ProvisioningCredentialId,
  ResourceId,
  optional,
  required,
  type IdType,
} from "./ids";
export * as wire from "./generated/sid/v1/ids/ids";

/** The include-relative path of the identifier schema this package carries. */
export const PROTO_PATH = "sid/v1/ids/ids.proto";
