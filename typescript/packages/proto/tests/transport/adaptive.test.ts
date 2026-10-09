// Per-call failover between WebTransport and gRPC-web: which errors fail
// over, background reconnect, transport-change notifications and shutdown.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Deferred, RpcError, UnaryCall } from "@protobuf-ts/runtime-rpc";
import type {
  RpcTransport,
  MethodInfo,
  RpcOptions,
  RpcMetadata,
  RpcStatus,
} from "@protobuf-ts/runtime-rpc";

// ---------------------------------------------------------------------------
// Mock WebTransport global (does not exist in Node.js)
// ---------------------------------------------------------------------------

class MockWebTransport {
  ready = Promise.resolve();
  closed = new Promise<void>(() => {});
  close = vi.fn();
  createBidirectionalStream = vi.fn();
}

// ---------------------------------------------------------------------------
// Mock modules BEFORE importing the module under test
// ---------------------------------------------------------------------------

// Mock GrpcWebFetchTransport. Constructor mocks are `function`s: they are
// called with `new`.
vi.mock("@protobuf-ts/grpcweb-transport", () => ({
  GrpcWebFetchTransport: vi.fn().mockImplementation(function () {
    return createMockTransport();
  }),
}));

// Mock WebTransportConnection and WebTransportRpcTransport
const mockWtConnect = vi.fn<() => Promise<void>>();
const mockWtClose = vi.fn();
let mockWtTransportInstance: RpcTransport;

vi.mock("../../src/transport/webtransport.js", () => ({
  WebTransportConnection: vi.fn().mockImplementation(function () {
    return { connect: mockWtConnect, close: mockWtClose };
  }),
  WebTransportRpcTransport: vi.fn().mockImplementation(function () {
    return mockWtTransportInstance;
  }),
}));

// Now import the module under test (AFTER vi.mock calls)
import { AdaptiveRpcTransport } from "../../src/transport/adaptive.js";
import type { AdaptiveTransportOptions } from "../../src/transport/adaptive.js";
import { TransportFailure } from "../../src/transport/transport-failure.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockMsg {
  value: string;
}

function createMethodInfo(): MethodInfo<MockMsg, MockMsg> {
  return {
    service: { typeName: "test.TestService", methods: [], options: {} },
    name: "TestMethod",
    localName: "testMethod",
    idempotency: undefined,
    serverStreaming: false,
    clientStreaming: false,
    I: {
      typeName: "TestInput",
      toBinary: () => new Uint8Array(),
      fromBinary: () => ({ value: "input" }),
    },
    O: {
      typeName: "TestOutput",
      toBinary: () => new Uint8Array(),
      fromBinary: () => ({ value: "output" }),
    },
    options: {},
  } as unknown as MethodInfo<MockMsg, MockMsg>;
}

function createMockTransport(): RpcTransport {
  return {
    mergeOptions: (opts?: Partial<RpcOptions>) => opts ?? {},
    unary: vi.fn(),
    serverStreaming: vi.fn(),
    clientStreaming: vi.fn(),
    duplex: vi.fn(),
  } as unknown as RpcTransport;
}

/** Create a resolved UnaryCall with the given response. */
function resolvedUnaryCall<I extends object, O extends object>(
  method: MethodInfo<I, O>,
  input: I,
  response: O,
): UnaryCall<I, O> {
  const dH = new Deferred<RpcMetadata>();
  const dM = new Deferred<O>();
  const dS = new Deferred<RpcStatus>();
  const dT = new Deferred<RpcMetadata>();

  dH.resolve({});
  dM.resolve(response);
  dS.resolve({ code: "OK", detail: "" });
  dT.resolve({});

  return new UnaryCall(method, {}, input, dH.promise, dM.promise, dS.promise, dT.promise);
}

/** Create a rejected UnaryCall that fails with the given error. */
function rejectedUnaryCall<I extends object, O extends object>(
  method: MethodInfo<I, O>,
  input: I,
  error: Error,
): UnaryCall<I, O> {
  const dH = new Deferred<RpcMetadata>();
  const dM = new Deferred<O>();
  const dS = new Deferred<RpcStatus>();
  const dT = new Deferred<RpcMetadata>();

  dH.reject(error);
  dM.reject(error);
  dS.reject(error);
  dT.reject(error);

  return new UnaryCall(method, {}, input, dH.promise, dM.promise, dS.promise, dT.promise);
}

function getGrpcWebTransport(adaptive: AdaptiveRpcTransport): RpcTransport {
  // Access the private fallback field
  return (adaptive as unknown as { fallback: RpcTransport }).fallback;
}

/** The mocked `unary` of a transport created by the mocks above. */
function unaryOf(transport: RpcTransport): ReturnType<typeof vi.fn> {
  return transport.unary as unknown as ReturnType<typeof vi.fn>;
}

/** An adaptive transport with WebTransport available, already initialised. */
async function adaptiveWithWebTransport(
  extra: Partial<AdaptiveTransportOptions> = {},
): Promise<AdaptiveRpcTransport> {
  (globalThis as Record<string, unknown>).WebTransport = MockWebTransport;
  const adaptive = new AdaptiveRpcTransport({
    grpcWebUrl: "https://grpc.sid.example.com",
    webTransportUrl: "https://wt.sid.example.com",
    ...extra,
  });
  await adaptive.init();
  return adaptive;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AdaptiveRpcTransport", () => {
  const method = createMethodInfo();
  const input: MockMsg = { value: "hello" };
  const options: RpcOptions = { meta: {} };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockWtConnect.mockResolvedValue(undefined);
    mockWtTransportInstance = createMockTransport();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).WebTransport;
  });

  describe("when WebTransport is unavailable (no URL)", () => {
    it("always uses gRPC-web", async () => {
      const adaptive = new AdaptiveRpcTransport({ grpcWebUrl: "https://grpc.sid.example.com" });
      await adaptive.init();

      expect(adaptive.activeTransport).toBe("grpc-web");

      const fallback = getGrpcWebTransport(adaptive);
      unaryOf(fallback).mockReturnValue(resolvedUnaryCall(method, input, { value: "ok" }));

      adaptive.unary(method, input, options);

      expect(fallback.unary).toHaveBeenCalledWith(method, input, options);
    });
  });

  describe("when WebTransport is available", () => {
    let adaptive: AdaptiveRpcTransport;

    beforeEach(async () => {
      adaptive = await adaptiveWithWebTransport({ reconnectDelay: 1000 });
    });

    afterEach(() => {
      adaptive.close();
    });

    it("uses WebTransport as primary transport", () => {
      expect(adaptive.activeTransport).toBe("webtransport");
    });

    it("sends unary calls through WebTransport primary", async () => {
      unaryOf(mockWtTransportInstance).mockReturnValue(
        resolvedUnaryCall(method, input, { value: "wt-ok" }),
      );

      const response = await adaptive.unary(method, input, options).response;

      expect(response).toEqual({ value: "wt-ok" });
      expect(mockWtTransportInstance.unary).toHaveBeenCalledWith(method, input, options);
    });

    it("fails over to gRPC-web on transport error (UNAVAILABLE)", async () => {
      unaryOf(mockWtTransportInstance).mockReturnValue(
        rejectedUnaryCall(method, input, new TransportFailure("connection lost")),
      );
      const fallback = getGrpcWebTransport(adaptive);
      unaryOf(fallback).mockReturnValue(resolvedUnaryCall(method, input, { value: "fallback-ok" }));

      const response = await adaptive.unary(method, input, options).response;

      expect(response).toEqual({ value: "fallback-ok" });
      expect(fallback.unary).toHaveBeenCalledWith(method, input, options);
    });

    it("does NOT failover on application error (NOT_FOUND)", async () => {
      unaryOf(mockWtTransportInstance).mockReturnValue(
        rejectedUnaryCall(method, input, new RpcError("not found", "NOT_FOUND")),
      );
      const fallback = getGrpcWebTransport(adaptive);

      await expect(adaptive.unary(method, input, options).response).rejects.toThrow("not found");
      expect(fallback.unary).not.toHaveBeenCalled();
    });

    it("does NOT failover on PERMISSION_DENIED", async () => {
      unaryOf(mockWtTransportInstance).mockReturnValue(
        rejectedUnaryCall(method, input, new RpcError("forbidden", "PERMISSION_DENIED")),
      );
      const fallback = getGrpcWebTransport(adaptive);

      await expect(adaptive.unary(method, input, options).response).rejects.toThrow("forbidden");
      expect(fallback.unary).not.toHaveBeenCalled();
    });

    it("schedules reconnect after failover", async () => {
      unaryOf(mockWtTransportInstance).mockReturnValue(
        rejectedUnaryCall(method, input, new TransportFailure("connection lost")),
      );
      unaryOf(getGrpcWebTransport(adaptive)).mockReturnValue(
        resolvedUnaryCall(method, input, { value: "ok" }),
      );

      await adaptive.unary(method, input, options).response;

      // After failover, transport should be grpc-web
      expect(adaptive.activeTransport).toBe("grpc-web");

      // Reconnect is scheduled — advance timer
      mockWtConnect.mockResolvedValue(undefined);
      await vi.advanceTimersByTimeAsync(1000);

      // After successful reconnect, primary should be available again
      expect(adaptive.activeTransport).toBe("webtransport");
    });

    it("retries reconnect if reconnect attempt fails", async () => {
      unaryOf(mockWtTransportInstance).mockReturnValue(
        rejectedUnaryCall(method, input, new TransportFailure("connection lost")),
      );
      unaryOf(getGrpcWebTransport(adaptive)).mockReturnValue(
        resolvedUnaryCall(method, input, { value: "ok" }),
      );

      await adaptive.unary(method, input, options).response;

      // First reconnect attempt fails
      mockWtConnect.mockRejectedValueOnce(new Error("still down"));
      await vi.advanceTimersByTimeAsync(1000);

      // Still on gRPC-web
      expect(adaptive.activeTransport).toBe("grpc-web");

      // Second reconnect succeeds
      mockWtConnect.mockResolvedValue(undefined);
      await vi.advanceTimersByTimeAsync(1000);

      expect(adaptive.activeTransport).toBe("webtransport");
    });
  });

  describe("activeTransport getter", () => {
    it("returns grpc-web when WebTransport URL not provided", async () => {
      const adaptive = new AdaptiveRpcTransport({ grpcWebUrl: "https://grpc.sid.example.com" });
      await adaptive.init();

      expect(adaptive.activeTransport).toBe("grpc-web");
    });

    it("returns webtransport after successful init", async () => {
      const adaptive = await adaptiveWithWebTransport();

      expect(adaptive.activeTransport).toBe("webtransport");

      adaptive.close();
    });

    it("returns grpc-web after init failure", async () => {
      mockWtConnect.mockRejectedValueOnce(new Error("connect failed"));
      const adaptive = await adaptiveWithWebTransport();

      expect(adaptive.activeTransport).toBe("grpc-web");

      adaptive.close();
    });

    it("schedules reconnect after init() failure", async () => {
      mockWtConnect.mockRejectedValueOnce(new Error("connect failed"));
      const adaptive = await adaptiveWithWebTransport({ reconnectDelay: 2000 });

      expect(adaptive.activeTransport).toBe("grpc-web");
      mockWtConnect.mockResolvedValue(undefined);

      // Reconnect fires after delay
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockWtConnect).toHaveBeenCalledTimes(2); // init fail + reconnect
      expect(adaptive.activeTransport).toBe("webtransport");

      adaptive.close();
    });
  });

  describe("onTransportChange callback", () => {
    // Observer exceptions must not change connection health or strand calls.
    it("isolates throwing observers during init and failover", async () => {
      const observer = vi.fn(() => {
        throw new Error("observer bug");
      });
      const adaptive = await adaptiveWithWebTransport({ onTransportChange: observer });
      expect(adaptive.activeTransport).toBe("webtransport");
      expect(observer).toHaveBeenCalledTimes(1);
      unaryOf(mockWtTransportInstance).mockReturnValue(
        rejectedUnaryCall(method, input, new TransportFailure("down")),
      );
      unaryOf(getGrpcWebTransport(adaptive)).mockReturnValue(
        resolvedUnaryCall(method, input, { value: "ok" }),
      );
      await expect(adaptive.unary(method, input, options).response).resolves.toEqual({
        value: "ok",
      });
      await vi.advanceTimersByTimeAsync(5000);
      expect(adaptive.activeTransport).toBe("webtransport");
      expect(observer).toHaveBeenCalledTimes(3);
      adaptive.close();
    });

    // Caller cancellation prohibits a fresh HTTP fallback attempt.
    it("does not fail over a caller-aborted call", async () => {
      const adaptive = await adaptiveWithWebTransport();
      const abort = new AbortController();
      abort.abort();
      unaryOf(mockWtTransportInstance).mockReturnValue(
        rejectedUnaryCall(method, input, new RpcError("aborted", "CANCELLED")),
      );
      await expect(
        adaptive.unary(method, input, { abort: abort.signal }).response,
      ).rejects.toMatchObject({ code: "CANCELLED" });
      expect(getGrpcWebTransport(adaptive).unary).not.toHaveBeenCalled();
      adaptive.close();
    });
    it("fires when transport changes during failover", async () => {
      const onChange = vi.fn();
      const adaptive = await adaptiveWithWebTransport({
        reconnectDelay: 1000,
        onTransportChange: onChange,
      });

      // init() calls onTransportChange with "webtransport"
      expect(onChange).toHaveBeenCalledWith("webtransport");

      // Trigger failover
      unaryOf(mockWtTransportInstance).mockReturnValue(
        rejectedUnaryCall(method, input, new TransportFailure("down")),
      );
      unaryOf(getGrpcWebTransport(adaptive)).mockReturnValue(
        resolvedUnaryCall(method, input, { value: "ok" }),
      );

      await adaptive.unary(method, input, options).response;

      expect(onChange).toHaveBeenCalledWith("grpc-web");

      adaptive.close();
    });
  });

  describe("close()", () => {
    // Closing after a reconnect starts prohibits both revival and rescheduling.
    it.each([true, false])("stops an in-flight reconnect (success=%s)", async (success) => {
      const adaptive = await adaptiveWithWebTransport({ reconnectDelay: 1000 });
      unaryOf(mockWtTransportInstance).mockReturnValue(
        rejectedUnaryCall(method, input, new TransportFailure("down")),
      );
      unaryOf(getGrpcWebTransport(adaptive)).mockReturnValue(
        resolvedUnaryCall(method, input, { value: "ok" }),
      );
      await adaptive.unary(method, input, options).response;
      const pending = new Deferred<void>();
      mockWtConnect.mockReturnValueOnce(pending.promise);
      vi.advanceTimersByTime(1000);
      adaptive.close();
      if (success) pending.resolve();
      else pending.reject(new Error("down"));
      await vi.advanceTimersByTimeAsync(0);
      expect(adaptive.activeTransport).toBe("grpc-web");
      expect(vi.getTimerCount()).toBe(0);
    });
    it("cancels pending reconnect timer", async () => {
      const adaptive = await adaptiveWithWebTransport({ reconnectDelay: 5000 });

      // Trigger failover to schedule reconnect
      unaryOf(mockWtTransportInstance).mockReturnValue(
        rejectedUnaryCall(method, input, new TransportFailure("down")),
      );
      unaryOf(getGrpcWebTransport(adaptive)).mockReturnValue(
        resolvedUnaryCall(method, input, { value: "ok" }),
      );

      await adaptive.unary(method, input, options).response;

      // Close before reconnect fires
      adaptive.close();

      // Advance past reconnect delay — should NOT attempt reconnect
      mockWtConnect.mockClear();
      await vi.advanceTimersByTimeAsync(10000);

      expect(mockWtConnect).not.toHaveBeenCalled();
    });
  });

  describe("clientStreaming / duplex", () => {
    it("clientStreaming throws RpcError", () => {
      const adaptive = new AdaptiveRpcTransport({ grpcWebUrl: "https://grpc.sid.example.com" });
      expect(() => adaptive.clientStreaming(method, options)).toThrow(RpcError);
    });

    it("duplex throws RpcError", () => {
      const adaptive = new AdaptiveRpcTransport({ grpcWebUrl: "https://grpc.sid.example.com" });
      expect(() => adaptive.duplex(method, options)).toThrow(RpcError);
    });
  });

  describe("failover preserves error provenance", () => {
    // A server status describes a completed RPC, not a broken connection.
    it.each(["CANCELLED", "UNKNOWN", "UNAVAILABLE"])("preserves server %s", async (code) => {
      const adaptive = await adaptiveWithWebTransport();

      unaryOf(mockWtTransportInstance).mockReturnValue(
        rejectedUnaryCall(method, input, new RpcError(code, code)),
      );
      unaryOf(getGrpcWebTransport(adaptive)).mockReturnValue(
        resolvedUnaryCall(method, input, { value: "ok" }),
      );

      await expect(adaptive.unary(method, input, options).response).rejects.toMatchObject({ code });
      expect(unaryOf(getGrpcWebTransport(adaptive))).not.toHaveBeenCalled();
      expect(adaptive.activeTransport).toBe("webtransport");

      adaptive.close();
    });

    it("does not treat an unclassified implementation error as a broken stream", async () => {
      const adaptive = await adaptiveWithWebTransport();

      // An unclassified error is not evidence of an I/O failure.
      unaryOf(mockWtTransportInstance).mockReturnValue(
        rejectedUnaryCall(method, input, new Error("stream aborted")),
      );
      unaryOf(getGrpcWebTransport(adaptive)).mockReturnValue(
        resolvedUnaryCall(method, input, { value: "fallback-ok" }),
      );

      await expect(adaptive.unary(method, input, options).response).rejects.toMatchObject({
        code: "INTERNAL",
      });
      expect(unaryOf(getGrpcWebTransport(adaptive))).not.toHaveBeenCalled();
      expect(adaptive.activeTransport).toBe("webtransport");

      adaptive.close();
    });

    it("propagates error when fallback also fails", async () => {
      const adaptive = await adaptiveWithWebTransport();

      unaryOf(mockWtTransportInstance).mockReturnValue(
        rejectedUnaryCall(method, input, new TransportFailure("primary down")),
      );
      unaryOf(getGrpcWebTransport(adaptive)).mockReturnValue(
        rejectedUnaryCall(method, input, new RpcError("fallback down", "UNAVAILABLE")),
      );

      const err = await adaptive.unary(method, input, options).response.catch((e: unknown) => e);
      expect((err as RpcError).message).toBe("fallback down");

      adaptive.close();
    });
  });

  describe("scheduleReconnect idempotency", () => {
    it("does not schedule multiple reconnect timers on concurrent failovers", async () => {
      const adaptive = await adaptiveWithWebTransport({ reconnectDelay: 5000 });

      // Two concurrent unary calls both fail with UNAVAILABLE
      unaryOf(mockWtTransportInstance).mockReturnValue(
        rejectedUnaryCall(method, input, new TransportFailure("down")),
      );
      unaryOf(getGrpcWebTransport(adaptive)).mockReturnValue(
        resolvedUnaryCall(method, input, { value: "ok" }),
      );

      await Promise.all([
        adaptive.unary(method, input, options).response,
        adaptive.unary(method, input, options).response,
      ]);

      // Advance past the reconnect delay — connect should fire exactly once
      mockWtConnect.mockResolvedValue(undefined);
      await vi.advanceTimersByTimeAsync(5000);

      // init=1, reconnect=1; the second failover is a no-op
      expect(mockWtConnect).toHaveBeenCalledTimes(2);

      adaptive.close();
    });
  });

  describe("onTransportChange on reconnect", () => {
    it("fires 'webtransport' when reconnect restores primary", async () => {
      const onChange = vi.fn();
      const adaptive = await adaptiveWithWebTransport({
        reconnectDelay: 1000,
        onTransportChange: onChange,
      });

      // Trigger failover
      unaryOf(mockWtTransportInstance).mockReturnValue(
        rejectedUnaryCall(method, input, new TransportFailure("down")),
      );
      unaryOf(getGrpcWebTransport(adaptive)).mockReturnValue(
        resolvedUnaryCall(method, input, { value: "ok" }),
      );

      await adaptive.unary(method, input, options).response;
      expect(onChange).toHaveBeenLastCalledWith("grpc-web");

      // Reconnect
      mockWtConnect.mockResolvedValue(undefined);
      await vi.advanceTimersByTimeAsync(1000);
      expect(onChange).toHaveBeenLastCalledWith("webtransport");

      adaptive.close();
    });
  });

  describe("serverStreaming", () => {
    it("always routes to gRPC-web fallback (WebTransport does not support streaming)", async () => {
      const adaptive = await adaptiveWithWebTransport();

      const fallback = getGrpcWebTransport(adaptive);
      const mockStream = {} as ReturnType<RpcTransport["serverStreaming"]>;
      (fallback.serverStreaming as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);

      const result = adaptive.serverStreaming(method, input, options);

      expect(fallback.serverStreaming).toHaveBeenCalledWith(method, input, options);
      expect(result).toBe(mockStream);

      adaptive.close();
    });
  });
});
