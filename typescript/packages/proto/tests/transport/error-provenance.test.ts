// Exercise both real transports and the real protobuf codec together. A server
// refusal or malformed response must not replay the call via gRPC-web.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MethodInfo } from "@protobuf-ts/runtime-rpc";
import { AdaptiveRpcTransport } from "../../src/transport/adaptive.js";
import { ResponseHeader } from "../../src/generated/sid/v1/common/transport.js";

const method: MethodInfo<ResponseHeader, ResponseHeader> = {
  service: { typeName: "test.Service", methods: [], options: {} },
  name: "Mutate",
  localName: "mutate",
  idempotency: undefined,
  serverStreaming: false,
  clientStreaming: false,
  I: ResponseHeader,
  O: ResponseHeader,
  options: {},
};

function frame(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(4 + bytes.length);
  new DataView(result.buffer).setUint32(0, bytes.length, false);
  result.set(bytes, 4);
  return result;
}

afterEach(() => vi.unstubAllGlobals());

describe("real adaptive/WebTransport error boundary", () => {
  it.each([
    [1, "CANCELLED"],
    [2, "UNKNOWN"],
    [14, "UNAVAILABLE"],
    [0, "DATA_LOSS"],
    [-1, "DATA_LOSS"],
    [-3, "DATA_LOSS"],
  ] as const)("preserves status/codec failure %s without replay", async (status, expected) => {
    const meta = { "grpc-status-details-bin": "CAc=" };
    const header =
      status === -1
        ? new Uint8Array([0xff])
        : ResponseHeader.toBinary(
            ResponseHeader.create({
              statusCode: status > 0 ? status : 0,
              statusMessage: "refused",
              metadata: meta,
            }),
          );
    // Oversized frame lengths are protocol failures, checked before allocation.
    const chunks =
      status === -3
        ? [new Uint8Array([0xff, 0xff, 0xff, 0xff])]
        : [frame(header), frame(new Uint8Array([0xff]))];
    const openStream = vi.fn(() =>
      Promise.resolve({
        writable: new WritableStream<Uint8Array>(),
        readable: new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
      }),
    );
    vi.stubGlobal(
      "WebTransport",
      class {
        ready = Promise.resolve();
        closed = new Promise<void>(() => {});
        createBidirectionalStream = openStream;
        close() {}
      },
    );
    const fetch = vi.fn(() => Promise.reject(new Error("Unexpected fallback")));
    vi.stubGlobal("fetch", fetch);
    const transport = new AdaptiveRpcTransport({
      grpcWebUrl: "https://grpc.example.com",
      webTransportUrl: "https://wt.example.com",
    });
    try {
      await transport.init();
      const call = transport.unary(method, ResponseHeader.create(), {});
      await expect(call.response).rejects.toMatchObject({ code: expected });
      if (status > 0) {
        await expect(call.headers).rejects.toMatchObject({ code: expected, meta });
      }
      expect(openStream).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
      expect(transport.activeTransport).toBe("webtransport");
    } finally {
      transport.close();
    }
  });
});
