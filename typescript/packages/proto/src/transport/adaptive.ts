/**
 * AdaptiveRpcTransport — per-call failover between WebTransport and gRPC-web.
 *
 * Strategy:
 * 1. Try primary (WebTransport) for every call
 * 2. On transport-level failure (UNAVAILABLE), immediately retry on fallback (gRPC-web)
 * 3. Background reconnect to primary after failover
 * 4. Once primary is back — switch future calls to primary again
 *
 * This is NOT a one-time negotiation. Each call can roam independently.
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
import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { WebTransportConnection, WebTransportRpcTransport } from "./webtransport.js";

export type TransportType = "webtransport" | "grpc-web";

export interface AdaptiveTransportOptions {
  /** gRPC-web base URL (required, always available as fallback) */
  grpcWebUrl: string;
  /** WebTransport URL (optional — if absent, always uses gRPC-web) */
  webTransportUrl?: string | undefined;
  /** SHA-256 cert hash for dev WebTransport certs */
  webTransportCertHash?: string | undefined;
  /** Delay before attempting to reconnect primary after failover (ms) */
  reconnectDelay?: number | undefined;
  /** Callback when active transport changes */
  onTransportChange?: ((transport: TransportType) => void) | undefined;
  /**
   * Fetch init options for the gRPC-web fallback transport.
   * Use `{ credentials: "include" }` to send BFF session cookies.
   */
  fetchInit?: RequestInit | undefined;
}

/**
 * Adaptive RPC transport with per-call failover and background reconnect.
 */
export class AdaptiveRpcTransport implements RpcTransport {
  private readonly defaultOptions: RpcOptions;
  private readonly fallback: GrpcWebFetchTransport;
  private readonly wtConnection: WebTransportConnection | null;
  private readonly wtTransport: WebTransportRpcTransport | null;
  private readonly reconnectDelay: number;
  private readonly onTransportChange: ((transport: TransportType) => void) | undefined;

  private primaryAvailable = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: AdaptiveTransportOptions, defaultOptions?: RpcOptions) {
    this.defaultOptions = defaultOptions ?? {};
    this.reconnectDelay = opts.reconnectDelay ?? 5000;
    this.onTransportChange = opts.onTransportChange;

    this.fallback = new GrpcWebFetchTransport({
      baseUrl: opts.grpcWebUrl,
      ...(opts.fetchInit ? { fetchInit: opts.fetchInit } : {}),
    });

    if (opts.webTransportUrl && typeof WebTransport !== "undefined") {
      this.wtConnection = new WebTransportConnection({
        url: opts.webTransportUrl,
        certHash: opts.webTransportCertHash,
      });
      this.wtTransport = new WebTransportRpcTransport(this.wtConnection);
    } else {
      this.wtConnection = null;
      this.wtTransport = null;
    }
  }

  /** Current active transport type. */
  get activeTransport(): TransportType {
    return this.primaryAvailable ? "webtransport" : "grpc-web";
  }

  /**
   * Attempt initial WebTransport connection.
   * Call this during app boot — non-blocking, falls back silently.
   */
  async init(): Promise<void> {
    if (!this.wtConnection) {
      this.notifyTransport("grpc-web");
      return;
    }

    try {
      await this.wtConnection.connect();
      this.primaryAvailable = true;
      this.notifyTransport("webtransport");
    } catch {
      this.primaryAvailable = false;
      this.notifyTransport("grpc-web");
      this.scheduleReconnect();
    }
  }

  /** Shut down all connections. */
  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.wtConnection?.close();
  }

  mergeOptions(options?: Partial<RpcOptions>): RpcOptions {
    return mergeRpcOptions(this.defaultOptions, options);
  }

  unary<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions,
  ): UnaryCall<I, O> {
    // If primary available — try it first with fallback on failure
    if (this.primaryAvailable && this.wtTransport) {
      return this.unaryWithFallback(this.wtTransport, method, input, options);
    }

    // Otherwise — go directly to fallback
    return this.fallback.unary(method, input, options);
  }

  serverStreaming<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions,
  ): ServerStreamingCall<I, O> {
    // Streaming only via gRPC-web (WebTransport doesn't support it yet)
    return this.fallback.serverStreaming(method, input, options);
  }

  clientStreaming<I extends object, O extends object>(
    _method: MethodInfo<I, O>,
    _options: RpcOptions,
  ): ClientStreamingCall<I, O> {
    throw new RpcError("Client streaming not supported");
  }

  duplex<I extends object, O extends object>(
    _method: MethodInfo<I, O>,
    _options: RpcOptions,
  ): DuplexStreamingCall<I, O> {
    throw new RpcError("Duplex streaming not supported");
  }

  /**
   * Try primary, on transport-level error retry with fallback.
   *
   * The tricky part: UnaryCall is returned synchronously (with deferred promises).
   * We wrap both attempts and resolve/reject the outer deferreds.
   */
  private unaryWithFallback<I extends object, O extends object>(
    primary: WebTransportRpcTransport,
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions,
  ): UnaryCall<I, O> {
    const defHeader = new Deferred<RpcMetadata>();
    const defMessage = new Deferred<O>();
    const defStatus = new Deferred<RpcStatus>();
    const defTrailer = new Deferred<RpcMetadata>();

    const call = new UnaryCall(
      method,
      options.meta ?? {},
      input,
      defHeader.promise,
      defMessage.promise,
      defStatus.promise,
      defTrailer.promise,
    );

    void this.tryPrimaryThenFallback(
      primary,
      method,
      input,
      options,
      defHeader,
      defMessage,
      defStatus,
      defTrailer,
    );

    return call;
  }

  private async tryPrimaryThenFallback<I extends object, O extends object>(
    primary: WebTransportRpcTransport,
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions,
    defHeader: Deferred<RpcMetadata>,
    defMessage: Deferred<O>,
    defStatus: Deferred<RpcStatus>,
    defTrailer: Deferred<RpcMetadata>,
  ): Promise<void> {
    try {
      // Attempt primary (WebTransport)
      const primaryCall = primary.unary(method, input, options);
      const [header, message, status, trailer] = await Promise.all([
        primaryCall.headers,
        primaryCall.response,
        primaryCall.status,
        primaryCall.trailers,
      ]);

      defHeader.resolve(header);
      defMessage.resolve(message);
      defStatus.resolve(status);
      defTrailer.resolve(trailer);
    } catch (err) {
      // Transport-level failure — failover to gRPC-web
      if (isTransportError(err)) {
        this.primaryAvailable = false;
        this.notifyTransport("grpc-web");
        this.scheduleReconnect();

        try {
          const fallbackCall = this.fallback.unary(method, input, options);
          const [header, message, status, trailer] = await Promise.all([
            fallbackCall.headers,
            fallbackCall.response,
            fallbackCall.status,
            fallbackCall.trailers,
          ]);

          defHeader.resolvePending(header);
          defMessage.resolvePending(message);
          defStatus.resolvePending(status);
          defTrailer.resolvePending(trailer);
        } catch (fallbackErr) {
          rejectAll(fallbackErr, defHeader, defMessage, defStatus, defTrailer);
        }
      } else {
        // Application-level error (e.g. NOT_FOUND, PERMISSION_DENIED)
        // — don't failover, propagate as-is
        rejectAll(err, defHeader, defMessage, defStatus, defTrailer);
      }
    }
  }

  private scheduleReconnect(): void {
    const connection = this.wtConnection;
    if (this.reconnectTimer || !connection) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        connection.close();
        await connection.connect();
        this.primaryAvailable = true;
        this.notifyTransport("webtransport");
      } catch {
        // Still down — try again later
        this.scheduleReconnect();
      }
    }, this.reconnectDelay);
  }

  private notifyTransport(type: TransportType): void {
    this.onTransportChange?.(type);
  }
}

/**
 * Check if the error is a transport-level failure (connection lost,
 * stream reset, etc.) vs an application-level gRPC error.
 *
 * Transport errors trigger failover. Application errors do not.
 */
function isTransportError(err: unknown): boolean {
  if (!(err instanceof RpcError)) return true;

  // gRPC UNAVAILABLE = server unreachable (transport issue)
  // gRPC CANCELLED = connection dropped mid-call
  const transportCodes = ["UNAVAILABLE", "CANCELLED", "UNKNOWN"];
  return transportCodes.includes(err.code);
}

function rejectAll(err: unknown, ...deferreds: Deferred<unknown>[]): void {
  const rpcErr =
    err instanceof RpcError
      ? err
      : new RpcError(err instanceof Error ? err.message : String(err), "INTERNAL");
  for (const d of deferreds) {
    d.rejectPending(rpcErr);
  }
}
