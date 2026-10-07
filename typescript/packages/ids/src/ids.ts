import type { IdKind } from "./errors";
import { MissingIdError } from "./errors";
import type * as wire from "./generated/sid/v1/ids/ids";
import { formatText, parseText, validate } from "./validate";

/**
 * The common behaviour of every identifier. A value is always a valid UUIDv7:
 * it is built only through validation and its bytes are private. Each kind is
 * its own class with a literal `kind`, so values of different kinds are
 * different types even when their bytes are equal.
 *
 * A valid identifier proves only its shape. It does not prove that the entity
 * exists, whom it belongs to, or that the caller may act on it.
 */
abstract class Identifier {
  abstract readonly kind: IdKind;
  readonly #bytes: Uint8Array;

  protected constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  /** A copy of the 16 bytes in network order: the wire value. */
  toBytes(): Uint8Array {
    return this.#bytes.slice();
  }

  /** Lowercase hyphenated text, for display only; the wire carries bytes. */
  toString(): string {
    return formatText(this.#bytes);
  }

  /** The same text as `toString`, so JSON logs show a readable value. */
  toJSON(): string {
    return this.toString();
  }

  /** True for an identifier of the same kind with the same bytes. */
  equals(other: unknown): boolean {
    if (!(other instanceof Identifier) || other.kind !== this.kind) return false;
    const theirs = other.#bytes;
    return this.#bytes.every((byte, i) => byte === theirs[i]);
  }
}

/**
 * A Profile's identity at one organization: the pairwise subject that
 * organization's services see. Opaque and unlinkable across organizations.
 */
export class BindingId extends Identifier {
  static readonly kind = "BindingId";
  readonly kind = "BindingId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): BindingId {
    return new BindingId(validate(bytes, BindingId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): BindingId {
    return BindingId.fromBytes(parseText(text, BindingId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.BindingId): BindingId {
    return BindingId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.BindingId {
    return { value: this.toBytes() };
  }
}

/**
 * A non-human actor (a service, bot or agent) with its own credentials. Not a
 * Binding, a Profile or a device, whatever its bytes.
 */
export class MachineUserId extends Identifier {
  static readonly kind = "MachineUserId";
  readonly kind = "MachineUserId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): MachineUserId {
    return new MachineUserId(validate(bytes, MachineUserId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): MachineUserId {
    return MachineUserId.fromBytes(parseText(text, MachineUserId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.MachineUserId): MachineUserId {
    return MachineUserId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.MachineUserId {
    return { value: this.toBytes() };
  }
}

/**
 * One password-installing operation (a registration, change or authorized
 * reset) from its preparation to its commit. Every retry carries it, so a lost
 * response resolves to the operation's one outcome.
 */
export class PasswordOperationId extends Identifier {
  static readonly kind = "PasswordOperationId";
  readonly kind = "PasswordOperationId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): PasswordOperationId {
    return new PasswordOperationId(validate(bytes, PasswordOperationId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): PasswordOperationId {
    return PasswordOperationId.fromBytes(parseText(text, PasswordOperationId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.PasswordOperationId): PasswordOperationId {
    return PasswordOperationId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.PasswordOperationId {
    return { value: this.toBytes() };
  }
}

/**
 * A provisioning connector: one directory source or target acting as its own
 * actor with its own credentials and grants. Not a machine user or a Profile.
 */
export class ProvisioningConnectorId extends Identifier {
  static readonly kind = "ProvisioningConnectorId";
  readonly kind = "ProvisioningConnectorId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): ProvisioningConnectorId {
    return new ProvisioningConnectorId(validate(bytes, ProvisioningConnectorId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): ProvisioningConnectorId {
    return ProvisioningConnectorId.fromBytes(parseText(text, ProvisioningConnectorId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.ProvisioningConnectorId): ProvisioningConnectorId {
    return ProvisioningConnectorId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.ProvisioningConnectorId {
    return { value: this.toBytes() };
  }
}

/**
 * One credential of a provisioning connector: the reference listings,
 * rotations, revocations and audit records name. Never the secret itself.
 */
export class ProvisioningCredentialId extends Identifier {
  static readonly kind = "ProvisioningCredentialId";
  readonly kind = "ProvisioningCredentialId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): ProvisioningCredentialId {
    return new ProvisioningCredentialId(validate(bytes, ProvisioningCredentialId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): ProvisioningCredentialId {
    return ProvisioningCredentialId.fromBytes(parseText(text, ProvisioningCredentialId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.ProvisioningCredentialId): ProvisioningCredentialId {
    return ProvisioningCredentialId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.ProvisioningCredentialId {
    return { value: this.toBytes() };
  }
}

/**
 * A registered protected resource: the application or API at which access is
 * enforced, in its issuer's context. Not an OAuth client or an audience string.
 */
export class ResourceId extends Identifier {
  static readonly kind = "ResourceId";
  readonly kind = "ResourceId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): ResourceId {
    return new ResourceId(validate(bytes, ResourceId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): ResourceId {
    return ResourceId.fromBytes(parseText(text, ResourceId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.ResourceId): ResourceId {
    return ResourceId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.ResourceId {
    return { value: this.toBytes() };
  }
}

/** An identifier class: its kind and its checked wire conversion. */
export interface IdType<T, W> {
  readonly kind: IdKind;
  fromWire(message: W): T;
}

/**
 * The identifier in a required message field: absence throws
 * `MissingIdError`, an invalid value throws `IdError`.
 */
export function required<T, W>(type: IdType<T, W>, message: W | undefined): T {
  if (message === undefined) throw new MissingIdError(type.kind);
  return type.fromWire(message);
}

/**
 * The identifier in an optional message field: absence stays `undefined`, a
 * present but invalid value throws `IdError` (an empty message is invalid,
 * not absent).
 */
export function optional<T, W>(type: IdType<T, W>, message: W | undefined): T | undefined {
  return message === undefined ? undefined : type.fromWire(message);
}
