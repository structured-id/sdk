// Independently generated ts-proto and protobuf-ts codecs consume the real SID
// schema. Check both directions, rather than mirroring one codec's output.
import { describe, it, expect } from "vitest";
import { CloudEvent } from "../src/generated/sid/v1/events/event_stream.js";
import { CloudEvent as PeerEvent } from "../schema/ts-proto/sid/v1/events/event_stream.js";
import { CaptchaChallenge, CaptchaKind } from "../src/generated/sid/v1/common/errors.js";
import {
  CaptchaChallenge as PeerCaptcha,
  CaptchaKind as PeerKind,
} from "../schema/ts-proto/sid/v1/common/errors.js";
import { UserInfo } from "../src/generated/sid/v1/authn/issuer.js";
import { UserInfo as PeerUserInfo } from "../schema/ts-proto/sid/v1/authn/issuer.js";
import { OAuth2IntrospectResponse } from "../src/generated/sid/v1/authn/auth.js";
import { OAuth2IntrospectResponse as PeerIntrospection } from "../schema/ts-proto/sid/v1/authn/auth.js";

describe("protobuf-ts / ts-proto interoperability", () => {
  // uint64 must never pass through Number; nanos must survive binary exchange.
  it.each([0n, 9007199254740993n, 18446744073709551615n])(
    "preserves uint64 %s and nanoseconds",
    (sequence) => {
      const message = CloudEvent.create({
        specVersion: "1.0",
        sequence,
        time: { seconds: 1728432000n, nanos: 123456789 },
        data: new Uint8Array([0, 255, 128]),
      });
      const peer = PeerEvent.decode(CloudEvent.toBinary(message));
      expect(peer.sequence).toBe(sequence);
      expect(peer.time).toEqual(message.time);
      expect(CloudEvent.fromBinary(PeerEvent.encode(peer).finish())).toEqual(message);
      const json = CloudEvent.toJson(message);
      expect(json).toMatchObject({ specVersion: "1.0", time: "2024-10-09T00:00:00.123456789Z" });
      if (sequence !== 0n) expect(json).toMatchObject({ sequence: sequence.toString() });
      expect(CloudEvent.fromJson(json)).toEqual(message);
      // Check the JSON scalars independently: ts-proto's Timestamp JSON helper
      // uses Date and is not a nanosecond-preserving converter.
      const withoutTime = CloudEvent.create({ sequence, data: message.data, specVersion: "1.0" });
      const peerWithoutTime = PeerEvent.decode(CloudEvent.toBinary(withoutTime));
      expect(PeerEvent.fromJSON(CloudEvent.toJson(withoutTime))).toEqual(peerWithoutTime);
      expect(CloudEvent.fromJsonString(JSON.stringify(PeerEvent.toJSON(peerWithoutTime)))).toEqual(
        withoutTime,
      );
    },
  );

  // Signed 64-bit boundaries and explicit optional zero remain exact/present.
  it.each([-9223372036854775808n, 0n, 9223372036854775807n])("preserves int64 %s", (exp) => {
    const message = OAuth2IntrospectResponse.create({ active: true, exp });
    const peer = PeerIntrospection.decode(OAuth2IntrospectResponse.toBinary(message));
    expect(peer.exp).toBe(exp);
    expect(OAuth2IntrospectResponse.fromBinary(PeerIntrospection.encode(peer).finish())).toEqual(
      message,
    );
    expect(PeerIntrospection.fromJSON(OAuth2IntrospectResponse.toJson(message))).toEqual(peer);
    expect(
      OAuth2IntrospectResponse.fromJsonString(JSON.stringify(PeerIntrospection.toJSON(peer))),
    ).toEqual(message);
  });

  // Local enum names may differ; binary numbers and full ProtoJSON names may not.
  it("preserves enum values and their schema JSON names", () => {
    const message = CaptchaChallenge.create({
      kind: CaptchaKind.HCAPTCHA,
      challengeId: "challenge",
    });
    const peer = PeerCaptcha.decode(CaptchaChallenge.toBinary(message));
    expect(peer.kind).toBe(PeerKind.CAPTCHA_KIND_HCAPTCHA);
    expect(CaptchaChallenge.toJson(message)).toEqual({
      kind: "CAPTCHA_KIND_HCAPTCHA",
      challengeId: "challenge",
    });
    expect(PeerCaptcha.fromJSON(CaptchaChallenge.toJson(message))).toEqual(peer);
    expect(CaptchaChallenge.fromJsonString(JSON.stringify(PeerCaptcha.toJSON(peer)))).toEqual(
      message,
    );
    expect(CaptchaChallenge.fromBinary(PeerCaptcha.encode(peer).finish())).toEqual(message);
  });

  // Future numeric enum values survive the binary protocol in both runtimes.
  it("preserves an unknown enum number over binary protobuf", () => {
    const message = CaptchaChallenge.fromJson({ kind: 12345 });
    const peer = PeerCaptcha.decode(CaptchaChallenge.toBinary(message));
    expect(peer.kind).toBe(12345);
    expect(CaptchaChallenge.fromBinary(PeerCaptcha.encode(peer).finish())).toEqual(message);
    expect(CaptchaChallenge.toJson(message)).toEqual({ kind: 12345 });
  });

  // Calendar bounds, pre-epoch fractions and sub-millisecond values must remain
  // exact; converting through JavaScript Date would discard the final digits.
  it.each([
    [-62135596800n, 0, "0001-01-01T00:00:00Z"],
    [-1n, 123456789, "1969-12-31T23:59:59.123456789Z"],
    [0n, 1, "1970-01-01T00:00:00.000000001Z"],
    [253402300799n, 999999999, "9999-12-31T23:59:59.999999999Z"],
  ] as const)("preserves timestamp %s/%s", (seconds, nanos, jsonTime) => {
    const message = CloudEvent.create({ time: { seconds, nanos } });
    const peer = PeerEvent.decode(CloudEvent.toBinary(message));
    expect(CloudEvent.fromBinary(PeerEvent.encode(peer).finish())).toEqual(message);
    expect(CloudEvent.toJson(message)).toEqual({ time: jsonTime });
    expect(peer.time).toEqual({ seconds, nanos });
    expect(CloudEvent.fromJson(CloudEvent.toJson(message))).toEqual(message);
  });

  // OIDC's explicit json_name is snake_case, while local TS keys stay camelCase.
  it("honors json_name without renaming local message keys", () => {
    const message = UserInfo.create({
      sub: "recipient-subject",
      givenName: "Alice",
      emailVerified: false,
    });
    const json = { sub: "recipient-subject", given_name: "Alice", email_verified: false };
    expect(UserInfo.toJson(message)).toEqual(json);
    const peer = PeerUserInfo.fromJSON(json);
    expect(peer.givenName).toBe("Alice");
    expect(PeerUserInfo.toJSON(peer)).toEqual(json);
    expect(UserInfo.fromBinary(PeerUserInfo.encode(peer).finish())).toEqual(message);
    expect(UserInfo.fromJsonString(JSON.stringify(PeerUserInfo.toJSON(peer)))).toEqual(message);
  });
});
