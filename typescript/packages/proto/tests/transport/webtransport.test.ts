// WebTransport connection lifecycle and the unary call over one bidirectional
// stream: request header, metadata, deadlines, status mapping and failures.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RpcError } from "@protobuf-ts/runtime-rpc";
import type { MethodInfo, RpcOptions } from "@protobuf-ts/runtime-rpc";
import { RequestHeader, ResponseHeader } from "../../src/generated/sid/v1/common/transport.js";
import {
  WebTransportConnection,
  WebTransportRpcTransport,
} from "../../src/transport/webtransport.js";

// ---------------------------------------------------------------------------
// Mock WebTransport browser API
// ---------------------------------------------------------------------------

interface MockBidiStream {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

/** Build a mock bidirectional stream where server sends `responseChunks`. */
function makeMockBidiStream(responseChunks: Uint8Array[]): {
  stream: MockBidiStream;
  writtenChunks: Uint8Array[];
} {
  const writtenChunks: Uint8Array[] = [];

  // Writable side: collects written bytes
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      writtenChunks.push(chunk);
    },
  });

  // Readable side: yields responseChunks one by one
  let i = 0;
  const readable = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = responseChunks[i++];
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
  });

  return { stream: { readable, writable }, writtenChunks };
}

/** Build a ResponseHeader frame (length-prefix + proto bytes). */
function buildResponseFrame(header: ResponseHeader): Uint8Array {
  const payload = ResponseHeader.toBinary(header);
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, payload.length, false);
  const frame = new Uint8Array(4 + payload.length);
  frame.set(lenBuf);
  frame.set(payload, 4);
  return frame;
}

/** Build a body frame (length-prefix + raw bytes). */
function buildBodyFrame(body: Uint8Array): Uint8Array {
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, body.length, false);
  const frame = new Uint8Array(4 + body.length);
  frame.set(lenBuf);
  frame.set(body, 4);
  return frame;
}

/** Parse a length-prefix frame from a flat byte array (for assertion helpers). */
function parseFrame(bytes: Uint8Array, offset: number): { payload: Uint8Array; next: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = view.getUint32(offset, false);
  const payload = bytes.slice(offset + 4, offset + 4 + len);
  return { payload, next: offset + 4 + len };
}

/** Concatenate all chunks into a single Uint8Array. */
function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** The init options the mocked WebTransport constructor was first called with. */
function initOptions(): Record<string, unknown> {
  const ctor = (globalThis as Record<string, unknown>).WebTransport as ReturnType<typeof vi.fn>;
  return ctor.mock.calls[0]?.[1] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Test fixture: minimal MethodInfo
// ---------------------------------------------------------------------------

interface Msg {
  value: string;
}

function makeMethod(): MethodInfo<Msg, Msg> {
  return {
    service: { typeName: "sid.v1.TestService", methods: [], options: {} },
    name: "TestRpc",
    localName: "testRpc",
    idempotency: undefined,
    serverStreaming: false,
    clientStreaming: false,
    I: {
      typeName: "TestInput",
      toBinary: (msg: Msg) => new TextEncoder().encode(JSON.stringify(msg)),
      fromBinary: (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes)) as Msg,
    },
    O: {
      typeName: "TestOutput",
      toBinary: (msg: Msg) => new TextEncoder().encode(JSON.stringify(msg)),
      fromBinary: (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes)) as Msg,
    },
    options: {},
  } as unknown as MethodInfo<Msg, Msg>;
}

// ---------------------------------------------------------------------------
// WebTransportConnection tests
// ---------------------------------------------------------------------------

describe("WebTransportConnection", () => {
  let mockWt: {
    ready: Promise<void>;
    closed: Promise<void>;
    close: ReturnType<typeof vi.fn>;
    createBidirectionalStream: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockWt = {
      ready: Promise.resolve(),
      closed: new Promise(() => {}), // never resolves during test
      close: vi.fn(),
      createBidirectionalStream: vi.fn(),
    };
    // `new WebTransport(...)`: a constructor mock must be a `function`.
    (globalThis as Record<string, unknown>).WebTransport = vi.fn().mockImplementation(function () {
      return mockWt;
    });
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).WebTransport;
  });

  it("connects successfully and marks connected", async () => {
    const conn = new WebTransportConnection({
      url: "https://wt.sid.example.com",
    });
    expect(conn.connected).toBe(false);

    await conn.connect();
    expect(conn.connected).toBe(true);
  });

  it("connect() is idempotent — does not open second connection", async () => {
    const conn = new WebTransportConnection({
      url: "https://wt.sid.example.com",
    });
    await conn.connect();
    await conn.connect();
    await conn.connect();

    expect((globalThis as Record<string, unknown>).WebTransport).toHaveBeenCalledTimes(1);
  });

  it("close() disconnects and allows reconnect", async () => {
    const conn = new WebTransportConnection({
      url: "https://wt.sid.example.com",
    });
    await conn.connect();

    conn.close();
    expect(conn.connected).toBe(false);
    expect(mockWt.close).toHaveBeenCalled();

    // Can reconnect after close
    await conn.connect();
    expect(conn.connected).toBe(true);
    expect((globalThis as Record<string, unknown>).WebTransport).toHaveBeenCalledTimes(2);
  });

  it("detects remote disconnection via wt.closed", async () => {
    let resolveClosedPromise: () => void = () => {};
    mockWt.closed = new Promise<void>((resolve) => {
      resolveClosedPromise = resolve;
    });

    const conn = new WebTransportConnection({
      url: "https://wt.sid.example.com",
    });
    await conn.connect();
    expect(conn.connected).toBe(true);

    // Simulate server closing the connection
    resolveClosedPromise();
    await Promise.resolve(); // let microtasks run

    expect(conn.connected).toBe(false);
  });

  it("passes cert hash as serverCertificateHashes when provided", async () => {
    const certHash = "deadbeef1234567890abcdef";
    const conn = new WebTransportConnection({
      url: "https://wt.sid.example.com",
      certHash,
    });
    await conn.connect();

    const hashes = initOptions().serverCertificateHashes as
      Array<{ algorithm: string }> | undefined;
    expect(hashes).toBeDefined();
    expect(hashes?.[0]?.algorithm).toBe("sha-256");
  });

  it("does not pass serverCertificateHashes when no cert hash", async () => {
    const conn = new WebTransportConnection({
      url: "https://wt.sid.example.com",
    });
    await conn.connect();

    expect(initOptions().serverCertificateHashes).toBeUndefined();
  });

  it("connect() throws when wt.ready rejects", async () => {
    mockWt.ready = Promise.reject(new Error("TLS handshake failed"));

    const conn = new WebTransportConnection({
      url: "https://wt.sid.example.com",
    });
    await expect(conn.connect()).rejects.toThrow("TLS handshake failed");
    expect(conn.connected).toBe(false);
  });

  it("concurrent connect() calls share the same promise (no duplicate connections)", async () => {
    // Delay wt.ready so the connection is in-progress when second connect() is called
    let resolveReady: () => void = () => {};
    mockWt.ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    const conn = new WebTransportConnection({
      url: "https://wt.sid.example.com",
    });

    // Start two connects concurrently — neither has resolved yet
    const p1 = conn.connect();
    const p2 = conn.connect();

    // Both should be the same promise (or at least both resolve to same transport)
    resolveReady();
    const [wt1, wt2] = await Promise.all([p1, p2]);

    expect(wt1).toBe(wt2);
    expect((globalThis as Record<string, unknown>).WebTransport).toHaveBeenCalledTimes(1);
  });

  it("close() is safe when not connected (no-op)", () => {
    const conn = new WebTransportConnection({
      url: "https://wt.sid.example.com",
    });
    // Never connected — close() should not throw
    expect(() => conn.close()).not.toThrow();
    expect(conn.connected).toBe(false);
  });

  it("wt.closed after close() does not set connected=false again (already null)", async () => {
    let resolveClosedPromise: () => void = () => {};
    mockWt.closed = new Promise<void>((resolve) => {
      resolveClosedPromise = resolve;
    });

    const conn = new WebTransportConnection({
      url: "https://wt.sid.example.com",
    });
    await conn.connect();

    // Manually close before server closes the connection
    conn.close();
    expect(conn.connected).toBe(false);

    // Now the server closes — wt.closed resolves, but this.transport !== wt (it's null)
    // The handler should be a no-op (not throw, not change state)
    resolveClosedPromise();
    await Promise.resolve();

    // Still disconnected, no error
    expect(conn.connected).toBe(false);
  });

  it("connect() can be retried after failure (connecting state is reset)", async () => {
    // First attempt fails
    mockWt.ready = Promise.reject(new Error("connect failed"));
    const conn = new WebTransportConnection({
      url: "https://wt.sid.example.com",
    });
    await expect(conn.connect()).rejects.toThrow("connect failed");

    // Second attempt succeeds (new mockWt with resolved ready)
    const mockWt2 = {
      ready: Promise.resolve(),
      closed: new Promise<void>(() => {}),
      close: vi.fn(),
      createBidirectionalStream: vi.fn(),
    };
    (globalThis as Record<string, unknown>).WebTransport = vi.fn().mockImplementation(function () {
      return mockWt2;
    });

    await conn.connect();
    expect(conn.connected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WebTransportRpcTransport tests
// ---------------------------------------------------------------------------

describe("WebTransportRpcTransport", () => {
  const method = makeMethod();
  const input: Msg = { value: "hello" };
  const options: RpcOptions = { meta: {} };

  let mockWt: {
    ready: Promise<void>;
    closed: Promise<void>;
    close: ReturnType<typeof vi.fn>;
    createBidirectionalStream: ReturnType<typeof vi.fn>;
  };
  let conn: WebTransportConnection;

  beforeEach(() => {
    mockWt = {
      ready: Promise.resolve(),
      closed: new Promise(() => {}),
      close: vi.fn(),
      createBidirectionalStream: vi.fn(),
    };
    (globalThis as Record<string, unknown>).WebTransport = vi.fn().mockImplementation(function () {
      return mockWt;
    });
    conn = new WebTransportConnection({ url: "https://wt.sid.example.com" });
  });

  afterEach(() => {
    conn.close();
    delete (globalThis as Record<string, unknown>).WebTransport;
  });

  it("sends RequestHeader with correct method path and gets response", async () => {
    await conn.connect();

    const responseBody = new TextEncoder().encode(JSON.stringify({ value: "world" }));

    const respHeader: ResponseHeader = {
      statusCode: 0,
      statusMessage: "",
      metadata: {},
    };
    const { stream, writtenChunks } = makeMockBidiStream([
      buildResponseFrame(respHeader),
      buildBodyFrame(responseBody),
    ]);
    mockWt.createBidirectionalStream.mockResolvedValue(stream);

    const transport = new WebTransportRpcTransport(conn);
    const call = transport.unary(method, input, options);
    const response = await call.response;

    expect(response).toEqual({ value: "world" });

    // Verify RequestHeader was sent correctly
    const sent = concat(writtenChunks);
    const { payload: reqHeaderBytes } = parseFrame(sent, 0);
    const sentHeader = RequestHeader.fromBinary(reqHeaderBytes);
    expect(sentHeader.method).toBe("sid.v1.TestService/TestRpc");
  });

  it("sends metadata from RpcOptions.meta in RequestHeader", async () => {
    await conn.connect();

    const responseBody = new TextEncoder().encode(JSON.stringify({ value: "ok" }));
    const respHeader: ResponseHeader = {
      statusCode: 0,
      statusMessage: "",
      metadata: {},
    };
    const { stream, writtenChunks } = makeMockBidiStream([
      buildResponseFrame(respHeader),
      buildBodyFrame(responseBody),
    ]);
    mockWt.createBidirectionalStream.mockResolvedValue(stream);

    const transport = new WebTransportRpcTransport(conn);
    const callWithMeta = transport.unary(method, input, {
      meta: { authorization: "Bearer token123", "x-trace-id": "abc" },
    });
    await callWithMeta.response;

    const sent = concat(writtenChunks);
    const { payload: reqHeaderBytes } = parseFrame(sent, 0);
    const sentHeader = RequestHeader.fromBinary(reqHeaderBytes);
    expect(sentHeader.metadata["authorization"]).toBe("Bearer token123");
    expect(sentHeader.metadata["x-trace-id"]).toBe("abc");
  });

  it("resolves headers from ResponseHeader.metadata", async () => {
    await conn.connect();

    const responseBody = new TextEncoder().encode(JSON.stringify({ value: "ok" }));
    const respHeader: ResponseHeader = {
      statusCode: 0,
      statusMessage: "",
      metadata: { "x-request-id": "req-456" },
    };
    const { stream } = makeMockBidiStream([
      buildResponseFrame(respHeader),
      buildBodyFrame(responseBody),
    ]);
    mockWt.createBidirectionalStream.mockResolvedValue(stream);

    const transport = new WebTransportRpcTransport(conn);
    const call = transport.unary(method, input, options);
    const headers = await call.headers;

    expect(headers["x-request-id"]).toBe("req-456");
  });

  it("joins array metadata values with comma in RequestHeader", async () => {
    await conn.connect();

    const responseBody = new TextEncoder().encode(JSON.stringify({ value: "ok" }));
    const respHeader: ResponseHeader = {
      statusCode: 0,
      statusMessage: "",
      metadata: {},
    };
    const { stream, writtenChunks } = makeMockBidiStream([
      buildResponseFrame(respHeader),
      buildBodyFrame(responseBody),
    ]);
    mockWt.createBidirectionalStream.mockResolvedValue(stream);

    const transport = new WebTransportRpcTransport(conn);
    const call = transport.unary(method, input, {
      meta: { accept: ["application/json", "text/plain"] },
    });
    await call.response;

    const sent = concat(writtenChunks);
    const { payload: reqHeaderBytes } = parseFrame(sent, 0);
    const sentHeader = RequestHeader.fromBinary(reqHeaderBytes);
    expect(sentHeader.metadata["accept"]).toBe("application/json,text/plain");
  });

  it("includes Date timeout in RequestHeader.timeoutMs (future date)", async () => {
    await conn.connect();

    const responseBody = new TextEncoder().encode(JSON.stringify({ value: "ok" }));
    const respHeader: ResponseHeader = {
      statusCode: 0,
      statusMessage: "",
      metadata: {},
    };
    const { stream, writtenChunks } = makeMockBidiStream([
      buildResponseFrame(respHeader),
      buildBodyFrame(responseBody),
    ]);
    mockWt.createBidirectionalStream.mockResolvedValue(stream);

    const transport = new WebTransportRpcTransport(conn);
    const deadlineMs = 5000;
    const deadline = new Date(Date.now() + deadlineMs);
    const call = transport.unary(method, input, {
      meta: {},
      timeout: deadline,
    });
    await call.response;

    const sent = concat(writtenChunks);
    const { payload: reqHeaderBytes } = parseFrame(sent, 0);
    const sentHeader = RequestHeader.fromBinary(reqHeaderBytes);
    // timeoutMs should be roughly 5000 (some drift allowed)
    expect(sentHeader.timeoutMs).toBeGreaterThan(0);
    expect(sentHeader.timeoutMs).toBeLessThanOrEqual(deadlineMs);
  });

  it("clamps past Date timeout to 0 in RequestHeader.timeoutMs", async () => {
    await conn.connect();

    const responseBody = new TextEncoder().encode(JSON.stringify({ value: "ok" }));
    const respHeader: ResponseHeader = {
      statusCode: 0,
      statusMessage: "",
      metadata: {},
    };
    const { stream, writtenChunks } = makeMockBidiStream([
      buildResponseFrame(respHeader),
      buildBodyFrame(responseBody),
    ]);
    mockWt.createBidirectionalStream.mockResolvedValue(stream);

    const transport = new WebTransportRpcTransport(conn);
    const pastDate = new Date(Date.now() - 10000); // 10 seconds ago
    const call = transport.unary(method, input, {
      meta: {},
      timeout: pastDate,
    });
    await call.response;

    const sent = concat(writtenChunks);
    const { payload: reqHeaderBytes } = parseFrame(sent, 0);
    const sentHeader = RequestHeader.fromBinary(reqHeaderBytes);
    expect(sentHeader.timeoutMs).toBe(0);
  });

  it("includes numeric timeout in RequestHeader.timeoutMs", async () => {
    await conn.connect();

    const responseBody = new TextEncoder().encode(JSON.stringify({ value: "ok" }));
    const respHeader: ResponseHeader = {
      statusCode: 0,
      statusMessage: "",
      metadata: {},
    };
    const { stream, writtenChunks } = makeMockBidiStream([
      buildResponseFrame(respHeader),
      buildBodyFrame(responseBody),
    ]);
    mockWt.createBidirectionalStream.mockResolvedValue(stream);

    const transport = new WebTransportRpcTransport(conn);
    const call = transport.unary(method, input, { meta: {}, timeout: 3000 });
    await call.response;

    const sent = concat(writtenChunks);
    const { payload: reqHeaderBytes } = parseFrame(sent, 0);
    const sentHeader = RequestHeader.fromBinary(reqHeaderBytes);
    expect(sentHeader.timeoutMs).toBe(3000);
  });

  it("uses 'RPC error' as message when statusMessage is empty", async () => {
    await conn.connect();

    const respHeader: ResponseHeader = {
      statusCode: 5, // NOT_FOUND
      statusMessage: "", // empty — code should fall back to "RPC error"
      metadata: {},
    };
    const { stream } = makeMockBidiStream([buildResponseFrame(respHeader)]);
    mockWt.createBidirectionalStream.mockResolvedValue(stream);

    const transport = new WebTransportRpcTransport(conn);
    const call = transport.unary(method, input, options);

    const err = await call.response.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe("NOT_FOUND");
    expect((err as RpcError).message).toBe("RPC error");
  });

  it("throws RpcError on non-zero gRPC status code", async () => {
    await conn.connect();

    const respHeader: ResponseHeader = {
      statusCode: 5, // NOT_FOUND
      statusMessage: "record not found",
      metadata: {},
    };
    const { stream } = makeMockBidiStream([buildResponseFrame(respHeader)]);
    mockWt.createBidirectionalStream.mockResolvedValue(stream);

    const transport = new WebTransportRpcTransport(conn);
    const call = transport.unary(method, input, options);

    const err = await call.response.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe("NOT_FOUND");
    expect((err as RpcError).message).toBe("record not found");
  });

  it("maps all gRPC status codes correctly", async () => {
    const cases: Array<{ code: number; name: string }> = [
      { code: 1, name: "CANCELLED" },
      { code: 2, name: "UNKNOWN" },
      { code: 3, name: "INVALID_ARGUMENT" },
      { code: 4, name: "DEADLINE_EXCEEDED" },
      { code: 7, name: "PERMISSION_DENIED" },
      { code: 14, name: "UNAVAILABLE" },
      { code: 16, name: "UNAUTHENTICATED" },
    ];

    for (const { code, name } of cases) {
      await conn.connect();
      const respHeader: ResponseHeader = {
        statusCode: code,
        statusMessage: name,
        metadata: {},
      };
      const { stream } = makeMockBidiStream([buildResponseFrame(respHeader)]);
      mockWt.createBidirectionalStream.mockResolvedValue(stream);

      const transport = new WebTransportRpcTransport(conn);
      const call = transport.unary(method, input, options);
      const err = await call.response.catch((e: unknown) => e);

      expect((err as RpcError).code).toBe(name);
      conn.close();
      conn = new WebTransportConnection({ url: "https://wt.sid.example.com" });
    }
  });

  it("falls back to UNKNOWN for unrecognized gRPC status code", async () => {
    await conn.connect();

    const respHeader: ResponseHeader = {
      statusCode: 999, // not in the grpcCodeName table
      statusMessage: "mystery error",
      metadata: {},
    };
    const { stream } = makeMockBidiStream([buildResponseFrame(respHeader)]);
    mockWt.createBidirectionalStream.mockResolvedValue(stream);

    const transport = new WebTransportRpcTransport(conn);
    const call = transport.unary(method, input, options);

    const err = await call.response.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe("UNKNOWN");
  });

  it("throws UNAVAILABLE if connection not yet established", async () => {
    // conn not connected
    const transport = new WebTransportRpcTransport(conn);
    const call = transport.unary(method, input, options);

    const err = await call.response.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe("UNAVAILABLE");
  });

  it("throws INTERNAL on stream error (non-RpcError)", async () => {
    await conn.connect();
    mockWt.createBidirectionalStream.mockRejectedValue(new Error("stream creation failed"));

    const transport = new WebTransportRpcTransport(conn);
    const call = transport.unary(method, input, options);

    const err = await call.response.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe("INTERNAL");
    expect((err as RpcError).message).toBe("stream creation failed");
  });

  it("uses String(err) as message when thrown value is not an Error", async () => {
    await conn.connect();
    // Simulate a non-Error non-RpcError thrown value (rare but possible)
    mockWt.createBidirectionalStream.mockRejectedValue("stream aborted");

    const transport = new WebTransportRpcTransport(conn);
    const call = transport.unary(method, input, options);

    const err = await call.response.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe("INTERNAL");
    expect((err as RpcError).message).toBe("stream aborted");
  });

  it("serverStreaming throws RpcError", () => {
    const transport = new WebTransportRpcTransport(conn);
    expect(() => transport.serverStreaming(method, input, options)).toThrow(RpcError);
  });

  it("clientStreaming throws RpcError", () => {
    const transport = new WebTransportRpcTransport(conn);
    expect(() => transport.clientStreaming(method, options)).toThrow(RpcError);
  });

  it("duplex throws RpcError", () => {
    const transport = new WebTransportRpcTransport(conn);
    expect(() => transport.duplex(method, options)).toThrow(RpcError);
  });
});
