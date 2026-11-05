import type { IdKind } from "./errors";
import { MissingIdError } from "./errors";
import type * as wire from "./generated/sid/v1/ids/ids";
import { checkProject, checkRole, formatUuid, parseText, validate } from "./validate";

/**
 * The common behaviour of every identifier. A value always has its kind's
 * shape (a UUIDv7; the system project and the built-in roles keep their fixed
 * values): it is built only through validation and its bytes are private. Each kind is
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
    return formatUuid(this.#bytes);
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
 * One OPAQUE login (RFC 9807 §6) from its start to its finish: the reference
 * to the login state the server keeps between the two steps, never a part of
 * that state.
 */
export class OpaqueLoginId extends Identifier {
  static readonly kind = "OpaqueLoginId";
  readonly kind = "OpaqueLoginId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): OpaqueLoginId {
    return new OpaqueLoginId(validate(bytes, OpaqueLoginId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): OpaqueLoginId {
    return OpaqueLoginId.fromBytes(parseText(text, OpaqueLoginId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.OpaqueLoginId): OpaqueLoginId {
    return OpaqueLoginId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.OpaqueLoginId {
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

/**
 * An authenticated session of a Profile: the reference session management
 * names. Not a credential; holding it authorizes nothing.
 */
export class SessionId extends Identifier {
  static readonly kind = "SessionId";
  readonly kind = "SessionId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): SessionId {
    return new SessionId(validate(bytes, SessionId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): SessionId {
    return SessionId.fromBytes(parseText(text, SessionId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.SessionId): SessionId {
    return SessionId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.SessionId {
    return { value: this.toBytes() };
  }
}

/**
 * One authentication credential of a Profile (a password, passkey, TOTP or
 * recovery code set). Never the secret, nor an authenticator's WebAuthn
 * credential ID.
 */
export class CredentialId extends Identifier {
  static readonly kind = "CredentialId";
  readonly kind = "CredentialId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): CredentialId {
    return new CredentialId(validate(bytes, CredentialId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): CredentialId {
    return CredentialId.fromBytes(parseText(text, CredentialId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.CredentialId): CredentialId {
    return CredentialId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.CredentialId {
    return { value: this.toBytes() };
  }
}

/**
 * One emailed one-time code from its request to its verification: the
 * reference verify and resend carry, never a part of the code.
 */
export class OtpSessionId extends Identifier {
  static readonly kind = "OtpSessionId";
  readonly kind = "OtpSessionId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): OtpSessionId {
    return new OtpSessionId(validate(bytes, OtpSessionId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): OtpSessionId {
    return OtpSessionId.fromBytes(parseText(text, OtpSessionId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.OtpSessionId): OtpSessionId {
    return OtpSessionId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.OtpSessionId {
    return { value: this.toBytes() };
  }
}

/**
 * One magic link from its request to its verification: the reference the
 * link carries beside its secret token, which alone authorizes.
 */
export class MagicLinkId extends Identifier {
  static readonly kind = "MagicLinkId";
  readonly kind = "MagicLinkId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): MagicLinkId {
    return new MagicLinkId(validate(bytes, MagicLinkId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): MagicLinkId {
    return MagicLinkId.fromBytes(parseText(text, MagicLinkId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.MagicLinkId): MagicLinkId {
    return MagicLinkId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.MagicLinkId {
    return { value: this.toBytes() };
  }
}

/**
 * One two-phase step-up of a session from its challenge to its completion:
 * the reference to the challenge kept for that session only.
 */
export class StepUpChallengeId extends Identifier {
  static readonly kind = "StepUpChallengeId";
  readonly kind = "StepUpChallengeId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): StepUpChallengeId {
    return new StepUpChallengeId(validate(bytes, StepUpChallengeId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): StepUpChallengeId {
    return StepUpChallengeId.fromBytes(parseText(text, StepUpChallengeId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.StepUpChallengeId): StepUpChallengeId {
    return StepUpChallengeId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.StepUpChallengeId {
    return { value: this.toBytes() };
  }
}

/**
 * One password reset from its emailed link to its completion: the reference
 * the link carries beside its secret token, which alone authorizes.
 */
export class ResetSessionId extends Identifier {
  static readonly kind = "ResetSessionId";
  readonly kind = "ResetSessionId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): ResetSessionId {
    return new ResetSessionId(validate(bytes, ResetSessionId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): ResetSessionId {
    return ResetSessionId.fromBytes(parseText(text, ResetSessionId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.ResetSessionId): ResetSessionId {
    return ResetSessionId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.ResetSessionId {
    return { value: this.toBytes() };
  }
}

/**
 * One upgrade of an imported password to OPAQUE from its start to its
 * finish: the reference to the upgrade state kept between the two steps.
 */
export class ImportedPasswordUpgradeId extends Identifier {
  static readonly kind = "ImportedPasswordUpgradeId";
  readonly kind = "ImportedPasswordUpgradeId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): ImportedPasswordUpgradeId {
    return new ImportedPasswordUpgradeId(validate(bytes, ImportedPasswordUpgradeId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): ImportedPasswordUpgradeId {
    return ImportedPasswordUpgradeId.fromBytes(parseText(text, ImportedPasswordUpgradeId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.ImportedPasswordUpgradeId): ImportedPasswordUpgradeId {
    return ImportedPasswordUpgradeId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.ImportedPasswordUpgradeId {
    return { value: this.toBytes() };
  }
}

/**
 * A user's Profile within one installation. Internal to that installation:
 * an external service never receives it and sees a pairwise BindingId.
 */
export class ProfileId extends Identifier {
  static readonly kind = "ProfileId";
  readonly kind = "ProfileId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): ProfileId {
    return new ProfileId(validate(bytes, ProfileId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): ProfileId {
    return ProfileId.fromBytes(parseText(text, ProfileId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.ProfileId): ProfileId {
    return ProfileId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.ProfileId {
    return { value: this.toBytes() };
  }
}

/**
 * One login handle of a Profile (an email, phone or username it signs in
 * with): the reference its management names. Not the handle's value.
 */
export class PrincipalId extends Identifier {
  static readonly kind = "PrincipalId";
  readonly kind = "PrincipalId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): PrincipalId {
    return new PrincipalId(validate(bytes, PrincipalId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): PrincipalId {
    return PrincipalId.fromBytes(parseText(text, PrincipalId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.PrincipalId): PrincipalId {
    return PrincipalId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.PrincipalId {
    return { value: this.toBytes() };
  }
}

/**
 * One email address recorded for a Profile, a contact that may or may not be
 * a login handle: the reference its management names.
 */
export class ProfileEmailId extends Identifier {
  static readonly kind = "ProfileEmailId";
  readonly kind = "ProfileEmailId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): ProfileEmailId {
    return new ProfileEmailId(validate(bytes, ProfileEmailId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): ProfileEmailId {
    return ProfileEmailId.fromBytes(parseText(text, ProfileEmailId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.ProfileEmailId): ProfileEmailId {
    return ProfileEmailId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.ProfileEmailId {
    return { value: this.toBytes() };
  }
}

/**
 * One phone number recorded for a Profile, a contact that may or may not be
 * a login handle: the reference its management names.
 */
export class ProfilePhoneId extends Identifier {
  static readonly kind = "ProfilePhoneId";
  readonly kind = "ProfilePhoneId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): ProfilePhoneId {
    return new ProfilePhoneId(validate(bytes, ProfilePhoneId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): ProfilePhoneId {
    return ProfilePhoneId.fromBytes(parseText(text, ProfilePhoneId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.ProfilePhoneId): ProfilePhoneId {
    return ProfilePhoneId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.ProfilePhoneId {
    return { value: this.toBytes() };
  }
}

/**
 * A device registered in a Profile's scope: a descriptive record its
 * management and sessions name. Knowing it grants no authority and proves no
 * possession of a device key.
 */
export class DeviceId extends Identifier {
  static readonly kind = "DeviceId";
  readonly kind = "DeviceId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): DeviceId {
    return new DeviceId(validate(bytes, DeviceId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): DeviceId {
    return DeviceId.fromBytes(parseText(text, DeviceId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.DeviceId): DeviceId {
    return DeviceId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.DeviceId {
    return { value: this.toBytes() };
  }
}

/**
 * An organization, fixed at its creation: the authority its members, roles
 * and applications belong to, and the key of its pairwise subjects.
 */
export class OrgId extends Identifier {
  static readonly kind = "OrgId";
  readonly kind = "OrgId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): OrgId {
    return new OrgId(validate(bytes, OrgId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): OrgId {
    return OrgId.fromBytes(parseText(text, OrgId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.OrgId): OrgId {
    return OrgId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.OrgId {
    return { value: this.toBytes() };
  }
}

/**
 * A logical OIDC issuer: one issuing authority for one recipient
 * organization. Internal; its public URL names it by an opaque handle.
 */
export class IssuerId extends Identifier {
  static readonly kind = "IssuerId";
  readonly kind = "IssuerId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): IssuerId {
    return new IssuerId(validate(bytes, IssuerId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): IssuerId {
    return IssuerId.fromBytes(parseText(text, IssuerId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.IssuerId): IssuerId {
    return IssuerId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.IssuerId {
    return { value: this.toBytes() };
  }
}

/**
 * A managed application: the container of an OAuth client role, a protected
 * resource role, or both. Not the OAuth `client_id`, which is its own text.
 */
export class ApplicationId extends Identifier {
  static readonly kind = "ApplicationId";
  readonly kind = "ApplicationId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): ApplicationId {
    return new ApplicationId(validate(bytes, ApplicationId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): ApplicationId {
    return ApplicationId.fromBytes(parseText(text, ApplicationId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.ApplicationId): ApplicationId {
    return ApplicationId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.ApplicationId {
    return { value: this.toBytes() };
  }
}

/**
 * A project of an installation: the scope its roles, groups and policies
 * belong to. A UUIDv7, or the nil UUID of the system project.
 */
export class ProjectId extends Identifier {
  static readonly kind = "ProjectId";
  readonly kind = "ProjectId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): ProjectId {
    return new ProjectId(validate(bytes, ProjectId.kind, checkProject));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): ProjectId {
    return ProjectId.fromBytes(parseText(text, ProjectId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.ProjectId): ProjectId {
    return ProjectId.fromBytes(message.value);
  }

  /** The installation's system project. */
  static system(): ProjectId {
    return new ProjectId(new Uint8Array(16));
  }

  /** Whether this is the system project. */
  isSystem(): boolean {
    return this.toBytes().every((byte) => byte === 0x00);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.ProjectId {
    return { value: this.toBytes() };
  }
}

/**
 * A role of a project: the named set of permissions an assignment grants.
 * A UUIDv7, or a built-in role every installation has.
 */
export class RoleId extends Identifier {
  static readonly kind = "RoleId";
  readonly kind = "RoleId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): RoleId {
    return new RoleId(validate(bytes, RoleId.kind, checkRole));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): RoleId {
    return RoleId.fromBytes(parseText(text, RoleId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.RoleId): RoleId {
    return RoleId.fromBytes(message.value);
  }

  /** Whether this is a built-in role. */
  isBuiltin(): boolean {
    const bytes = this.toBytes();
    return bytes.subarray(0, 15).every((byte) => byte === 0x00);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.RoleId {
    return { value: this.toBytes() };
  }
}

/** A group of a project whose members hold the roles assigned to it. */
export class GroupId extends Identifier {
  static readonly kind = "GroupId";
  readonly kind = "GroupId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): GroupId {
    return new GroupId(validate(bytes, GroupId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): GroupId {
    return GroupId.fromBytes(parseText(text, GroupId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.GroupId): GroupId {
    return GroupId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.GroupId {
    return { value: this.toBytes() };
  }
}

/**
 * One assignment of a role to a principal: the reference its revocation,
 * administration and audit name.
 */
export class RoleAssignmentId extends Identifier {
  static readonly kind = "RoleAssignmentId";
  readonly kind = "RoleAssignmentId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): RoleAssignmentId {
    return new RoleAssignmentId(validate(bytes, RoleAssignmentId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): RoleAssignmentId {
    return RoleAssignmentId.fromBytes(parseText(text, RoleAssignmentId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.RoleAssignmentId): RoleAssignmentId {
    return RoleAssignmentId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.RoleAssignmentId {
    return { value: this.toBytes() };
  }
}

/**
 * One Cedar policy of a scope: the reference its management names. Not its
 * name, which is unique within the scope only.
 */
export class CedarPolicyId extends Identifier {
  static readonly kind = "CedarPolicyId";
  readonly kind = "CedarPolicyId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): CedarPolicyId {
    return new CedarPolicyId(validate(bytes, CedarPolicyId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): CedarPolicyId {
    return CedarPolicyId.fromBytes(parseText(text, CedarPolicyId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.CedarPolicyId): CedarPolicyId {
    return CedarPolicyId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.CedarPolicyId {
    return { value: this.toBytes() };
  }
}

/** One request for a role from its submission to its decision. */
export class AccessRequestId extends Identifier {
  static readonly kind = "AccessRequestId";
  readonly kind = "AccessRequestId";

  private constructor(bytes: Uint8Array) {
    super(bytes);
  }

  /** Accept 16 bytes as this identifier, or throw `IdError` saying why not. */
  static fromBytes(bytes: Uint8Array): AccessRequestId {
    return new AccessRequestId(validate(bytes, AccessRequestId.kind));
  }

  /** Accept a textual UUID as this identifier, or throw `IdError`. */
  static parse(text: string): AccessRequestId {
    return AccessRequestId.fromBytes(parseText(text, AccessRequestId.kind));
  }

  /** Validate a decoded wire message; throws `IdError`. */
  static fromWire(message: wire.AccessRequestId): AccessRequestId {
    return AccessRequestId.fromBytes(message.value);
  }

  /** The wire message carrying this identifier's bytes. */
  toWire(): wire.AccessRequestId {
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
