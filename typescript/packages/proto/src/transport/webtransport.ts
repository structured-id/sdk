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

    this.connecting = this.doConnect();
    return this.connecting;
  }

  close(): void {
    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }
    this.connecting = null;
  }

  private async doConnect(): Promise<WebTransport> {
    const initOpts: WebTransportOptions = {};

    if (this.opts.certHash) {
      const hashBytes = hexToBytes(this.opts.certHash);
      initOpts.serverCertificateHashes = [{ algorithm: "sha-256", value: hashBytes.buffer }];
    }

    try {
      const wt = new WebTransport(this.opts.url, initOpts);
      await wt.ready;

      this.transport = wt;
      this.connecting = null;

      void wt.closed.then(() => {
        if (this.transport === wt) {
          this.transport = null;
        }
      });

      return wt;
    } catch (err) {
      // Reset so that subsequent connect() calls retry rather than returning
      // the stale rejected promise.
      this.connecting = null;
      throw err;
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
    try {
      if (!this.connection.connected) {
        throw new RpcError("WebTransport connection not established", "UNAVAILABLE");
      }

      const wt = await this.connection.connect();
      const stream = await wt.createBidirectionalStream();
      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();

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
        await writeFrame(writer, headerBytes);

        const bodyBytes = method.I.toBinary(input, options.binaryOptions);
        await writeFrame(writer, bodyBytes);

        // Read ResponseHeader + response body via FrameReader so that excess
        // bytes from one read() are not lost when reading the next frame.
        const frameReader = new FrameReader(reader);
        const respHeaderBytes = await frameReader.readFrame();
        const respHeader = ResponseHeader.fromBinary(respHeaderBytes);

        const responseHeaders: RpcMetadata = { ...respHeader.metadata };
        defHeader.resolve(responseHeaders);

        if (respHeader.statusCode !== 0) {
          throw new RpcError(
            respHeader.statusMessage || "RPC error",
            grpcCodeName(respHeader.statusCode),
          );
        }

        // Read response body
        const respBodyBytes = await frameReader.readFrame();
        const message = method.O.fromBinary(respBodyBytes, options.binaryOptions);

        defMessage.resolve(message);
        defStatus.resolve({ code: "OK", detail: "" });
        defTrailer.resolve({});
      } finally {
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
    }
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
