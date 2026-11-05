/**
 * StructuredID identifiers for TypeScript.
 *
 * Each identifier kind is its own class (`BindingId`, `MachineUserId`, ...),
 * built only through validation: exactly 16 bytes of an RFC 9562 UUIDv7, not
 * nil or max; the system project and the built-in roles keep their fixed
 * values. `wire` holds the generated `sid.v1.ids` messages with their
 * binary and standard ProtoJSON codecs; decoding one proves nothing, and the
 * checked conversion (`fromWire`, `required`, `optional`) validates it.
 *
 * `Identifier`, `IdError`, `MissingIdError`, `validate` and `parseText` are
 * the common mechanism for identifier kinds other packages own: they name
 * their kinds themselves, and this package carries none of them.
 */
export { IdError, MissingIdError, type IdErrorReason, type IdKind } from "./errors";
export {
  AccessRequestId,
  ApplicationId,
  BindingId,
  CedarPolicyId,
  CredentialId,
  DeviceId,
  GroupId,
  Identifier,
  ImportedPasswordUpgradeId,
  IssuerId,
  MachineUserId,
  MagicLinkId,
  OpaqueLoginId,
  OrgId,
  OtpSessionId,
  PasswordOperationId,
  PrincipalId,
  ProfileEmailId,
  ProfileId,
  ProfilePhoneId,
  ProjectId,
  ProvisioningConnectorId,
  ProvisioningCredentialId,
  ResetSessionId,
  ResourceId,
  RoleAssignmentId,
  RoleId,
  SessionId,
  StepUpChallengeId,
  optional,
  required,
  type IdType,
} from "./ids";
export {
  checkProject,
  checkRole,
  checkV7,
  formatUuid,
  parseText,
  parseUuidText,
  validate,
} from "./validate";
export * as wire from "./generated/sid/v1/ids/ids";

/** The include-relative path of the identifier schema this package carries. */
export const PROTO_PATH = "sid/v1/ids/ids.proto";
