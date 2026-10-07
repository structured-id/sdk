/** The identifier kinds this package delivers: one per `sid.v1.ids` message. */
export type IdKind =
  | "BindingId"
  | "MachineUserId"
  | "PasswordOperationId"
  | "ProvisioningConnectorId"
  | "ProvisioningCredentialId"
  | "ResourceId";

/** Why a value is not a valid identifier. */
export type IdErrorReason =
  /** The text is not a UUID in any accepted textual form. */
  | { readonly type: "malformed" }
  /** Binary form of a length other than 16 bytes. */
  | { readonly type: "length"; readonly length: number }
  /** The nil UUID (all zero bits). */
  | { readonly type: "nil" }
  /** The max UUID (all one bits). */
  | { readonly type: "max" }
  /** The variant bits are not those of RFC 9562. */
  | { readonly type: "variant" }
  /** An RFC 9562 UUID of a version other than 7. */
  | { readonly type: "version"; readonly version: number };

function describe(reason: IdErrorReason): string {
  switch (reason.type) {
    case "malformed":
      return "not a UUID";
    case "length":
      return `${reason.length} bytes, expected 16`;
    case "nil":
      return "the nil UUID";
    case "max":
      return "the max UUID";
    case "variant":
      return "not an RFC 4122 UUID";
    case "version":
      return `UUID version ${reason.version}, expected version 7`;
  }
}

/**
 * A value that is not a valid identifier of the requested kind. Carries the
 * kind and the reason, never the value, so it can be logged freely.
 */
export class IdError extends Error {
  override readonly name = "IdError";

  constructor(
    readonly kind: IdKind,
    readonly reason: IdErrorReason,
  ) {
    super(`invalid ${kind}: ${describe(reason)}`);
  }
}

/** A required identifier message was absent. Absence is never a default. */
export class MissingIdError extends Error {
  override readonly name = "MissingIdError";

  constructor(readonly kind: IdKind) {
    super(`missing ${kind}`);
  }
}
