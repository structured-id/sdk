/**
 * WebTransport RPC transport for StructuredID.
 *
 * Implements the @protobuf-ts/runtime-rpc RpcTransport interface using
 * the browser WebTransport API over HTTP/3 (QUIC).
 *
 * Each unary RPC opens one bidirectional stream:
 *   Client → Server: [4B len][RequestHeader] [4B len][request body]
 *   Server → Client: [4B len][ResponseHeader] [4B len][response body]
 */

import { Deferred, RpcError, mergeRpcOptions, UnaryCall } from "@protobuf-ts/runtime-rpc";
import type {
  RpcTransport,
  MethodInfo,
  RpcOptions,
  RpcMetadata,
  RpcStatus,
  ServerStreamingCall,
  ClientStreamingCall,
  DuplexStreamingCall,
} from "@protobuf-ts/runtime-rpc";
import { RequestHeader, ResponseHeader } from "../generated/sid/v1/common/transport.js";
import { FrameReader, writeFrame } from "./framing.js";
import { TransportFailure, transportIO } from "./transport-failure.js";
import type { IMessageType, BinaryReadOptions } from "@protobuf-ts/runtime";

export interface WebTransportConnectOptions {
  /** WebTransport server URL, e.g. "https://localhost:4433" */
  url: string;
  /**
   * SHA-256 certificate hash (hex string) for dev self-signed certs.
   * Required for connecting to servers with self-signed certificates.
   */
  certHash?: string | undefined;
}

/**
 * Managed WebTransport connection with lazy connect and auto-reconnect detection.
 */
export class WebTransportConnection {
  private transport: WebTransport | null = null;
  private connecting: Promise<WebTransport> | null = null;
  private pending: WebTransport | null = null;
  private generation = 0;
  private readonly opts: WebTransportConnectOptions;

  constructor(opts: WebTransportConnectOptions) {
    this.opts = opts;
  }

  get connected(): boolean {
    return this.transport !== null;
  }

  async connect(): Promise<WebTransport> {
    if (this.transport) return this.transport;
    if (this.connecting) return this.connecting;

    const attempt = this.doConnect(++this.generation);
    this.connecting = attempt;
    try {
      return await attempt;
    } finally {
      if (this.connecting === attempt) this.connecting = null;
    }
  }

  close(): void {
    ++this.generation;
    this.pending?.close();
    this.pending = null;
    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }
    this.connecting = null;
  }

  private async doConnect(generation: number): Promise<WebTransport> {
    const initOpts: WebTransportOptions = {};

    if (this.opts.certHash) {
      const hashBytes = hexToBytes(this.opts.certHash);
      initOpts.serverCertificateHashes = [{ algorithm: "sha-256", value: hashBytes.buffer }];
    }

    try {
      const wt = new WebTransport(this.opts.url, initOpts);
      this.pending = wt;
      // W3C WebTransport §6.6: closed rejects on abnormal termination.
      const disconnected = () => {
        if (this.transport === wt) this.transport = null;
      };
      void wt.closed.then(disconnected, disconnected);
      await wt.ready;
      if (generation !== this.generation) {
        throw new RpcError("Connection attempt was closed", "CANCELLED");
      }
      this.transport = wt;
      return wt;
    } finally {
      if (generation === this.generation) {
        this.pending = null;
      }
    }
  }
}

/**
 * RpcTransport implementation using WebTransport bidirectional streams.
 *
 * Requires an established WebTransportConnection — does NOT manage
 * the connection lifecycle. Use AdaptiveRpcTransport for automatic
 * failover and reconnect.
 */
export class WebTransportRpcTransport implements RpcTransport {
  private readonly defaultOptions: RpcOptions;
  private readonly connection: WebTransportConnection;

  constructor(connection: WebTransportConnection, defaultOptions?: RpcOptions) {
    this.connection = connection;
    this.defaultOptions = defaultOptions ?? {};
  }

  mergeOptions(options?: Partial<RpcOptions>): RpcOptions {
    return mergeRpcOptions(this.defaultOptions, options);
  }

  unary<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions,
  ): UnaryCall<I, O> {
    const defHeader = new Deferred<RpcMetadata>();
    const defMessage = new Deferred<O>();
    const defStatus = new Deferred<RpcStatus>();
    const defTrailer = new Deferred<RpcMetadata>();

    void this.executeUnary(method, input, options, defHeader, defMessage, defStatus, defTrailer);

    return new UnaryCall(
      method,
      options.meta ?? {},
      input,
      defHeader.promise,
      defMessage.promise,
      defStatus.promise,
      defTrailer.promise,
    );
  }

  serverStreaming<I extends object, O extends object>(
    _method: MethodInfo<I, O>,
    _input: I,
    _options: RpcOptions,
  ): ServerStreamingCall<I, O> {
    throw new RpcError("Server streaming not supported over WebTransport transport");
  }

  clientStreaming<I extends object, O extends object>(
    _method: MethodInfo<I, O>,
    _options: RpcOptions,
  ): ClientStreamingCall<I, O> {
    throw new RpcError("Client streaming not supported over WebTransport transport");
  }

  duplex<I extends object, O extends object>(
    _method: MethodInfo<I, O>,
    _options: RpcOptions,
  ): DuplexStreamingCall<I, O> {
    throw new RpcError("Duplex streaming not supported over WebTransport transport");
  }

  private async executeUnary<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions,
    defHeader: Deferred<RpcMetadata>,
    defMessage: Deferred<O>,
    defStatus: Deferred<RpcStatus>,
    defTrailer: Deferred<RpcMetadata>,
  ): Promise<void> {
    let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let wait = transportIO;
    let abort: (() => void) | undefined;
    if (options.abort) {
      const cancelled = new Deferred<never>();
      abort = () => {
        const error = new RpcError("Call cancelled", "CANCELLED");
        // Cancel both halves. Cleanup rejection cannot replace the RPC outcome.
        void writer?.abort(error).catch(() => {});
        void reader?.cancel(error).catch(() => {});
        cancelled.rejectPending(error);
      };
      wait = <T>(work: Promise<T>): Promise<T> =>
        Promise.race([transportIO(work), cancelled.promise]);
      options.abort.addEventListener("abort", abort, { once: true });
    }
    try {
      if (options.abort?.aborted) throw new RpcError("Call cancelled", "CANCELLED");
      if (!this.connection.connected) {
        throw new TransportFailure("WebTransport connection not established");
      }

      const wt = await wait(this.connection.connect());
      const opening = wt.createBidirectionalStream().then((stream) => {
        // A stream can arrive after the call's cancellation has already won.
        if (options.abort?.aborted) {
          void stream.writable.abort().catch(() => {});
          void stream.readable.cancel().catch(() => {});
          throw new RpcError("Call cancelled", "CANCELLED");
        }
        return stream;
      });
      const stream = await wait(opening);
      writer = stream.writable.getWriter();
      reader = stream.readable.getReader();

      try {
        // Build RequestHeader
        const methodPath = `${method.service.typeName}/${method.name}`;
        const metadata: Record<string, string> = {};
        if (options.meta) {
          for (const [key, value] of Object.entries(options.meta)) {
            if (typeof value === "string") {
              metadata[key] = value;
            } else if (Array.isArray(value)) {
              metadata[key] = value.join(",");
            }
          }
        }

        let timeoutMs = 0;
        if (options.timeout) {
          timeoutMs =
            options.timeout instanceof Date
              ? Math.max(0, options.timeout.getTime() - Date.now())
              : options.timeout;
        }

        const reqHeader: RequestHeader = {
          method: methodPath,
          metadata,
          timeoutMs,
        };

        // Send RequestHeader + request body
        const headerBytes = RequestHeader.toBinary(reqHeader);
        await wait(writeFrame(writer, headerBytes));

        const bodyBytes = method.I.toBinary(input, options.binaryOptions);
        await wait(writeFrame(writer, bodyBytes));
        // W3C WebTransport §13: closing sends FIN; releaseLock does not.
        await wait(writer.close());

        // Read ResponseHeader + response body via FrameReader so that excess
        // bytes from one read() are not lost when reading the next frame.
        const frameReader = new FrameReader(reader);
        const respHeaderBytes = await wait(frameReader.readFrame());
        const respHeader = decodeResponse(ResponseHeader, respHeaderBytes);

        const responseHeaders: RpcMetadata = respHeader.metadata;

        if (respHeader.statusCode !== 0) {
          throw new RpcError(
            respHeader.statusMessage || "RPC error",
            grpcCodeName(respHeader.statusCode),
            responseHeaders,
          );
        }
        defHeader.resolve(responseHeaders);

        // Read response body
        const respBodyBytes = await wait(frameReader.readFrame());
        const message = decodeResponse(method.O, respBodyBytes, options.binaryOptions);

        defMessage.resolve(message);
        defStatus.resolve({ code: "OK", detail: "" });
        defTrailer.resolve({});
      } finally {
        // Stop any incomplete half on failure; a completed writable's abort is
        // a no-op. Releasing a lock alone does not close a QUIC stream.
        void writer.abort().catch(() => {});
        void reader.cancel().catch(() => {});
        writer.releaseLock();
        reader.releaseLock();
      }
    } catch (err) {
      const rpcErr =
        err instanceof RpcError
          ? err
          : new RpcError(err instanceof Error ? err.message : String(err), "INTERNAL");
      defHeader.rejectPending(rpcErr);
      defMessage.rejectPending(rpcErr);
      defStatus.rejectPending(rpcErr);
      defTrailer.rejectPending(rpcErr);
    } finally {
      if (abort) options.abort?.removeEventListener("abort", abort);
    }
  }
}

function decodeResponse<T extends object>(
  type: IMessageType<T>,
  bytes: Uint8Array,
  options?: Partial<BinaryReadOptions>,
): T {
  try {
    return type.fromBinary(bytes, options);
  } catch (error) {
    throw new RpcError(error instanceof Error ? error.message : String(error), "DATA_LOSS");
  }
}

/** Convert hex string to Uint8Array. */
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/** Map gRPC numeric status code to string name. */
function grpcCodeName(code: number): string {
  const names: Record<number, string> = {
    0: "OK",
    1: "CANCELLED",
    2: "UNKNOWN",
    3: "INVALID_ARGUMENT",
    4: "DEADLINE_EXCEEDED",
    5: "NOT_FOUND",
    6: "ALREADY_EXISTS",
    7: "PERMISSION_DENIED",
    8: "RESOURCE_EXHAUSTED",
    9: "FAILED_PRECONDITION",
    10: "ABORTED",
    11: "OUT_OF_RANGE",
    12: "UNIMPLEMENTED",
    13: "INTERNAL",
    14: "UNAVAILABLE",
    15: "DATA_LOSS",
    16: "UNAUTHENTICATED",
  };
  return names[code] ?? "UNKNOWN";
}
