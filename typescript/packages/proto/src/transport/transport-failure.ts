import { RpcError } from "@protobuf-ts/runtime-rpc";

/** A locally observed connection/stream failure, never a received RPC status. */
export class TransportFailure extends RpcError {
  constructor(message: string) {
    super(message, "UNAVAILABLE");
  }
}

/** Classify only the rejection of a transport operation, not its codec work. */
export function transportIO<T>(work: Promise<T>): Promise<T> {
  return work.catch(classifyTransportFailure);
}

function classifyTransportFailure(error: unknown): never {
  if (error instanceof RpcError) throw error;
  throw new TransportFailure(error instanceof Error ? error.message : String(error));
}
