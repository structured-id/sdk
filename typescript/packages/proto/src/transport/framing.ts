/**
 * Length-prefixed frame helpers for WebTransport streams.
 *
 * Wire format (per frame): [4 bytes big-endian length][payload]
 */

import { RpcError } from "@protobuf-ts/runtime-rpc";

const MAX_FRAME_SIZE = 4 * 1024 * 1024; // 4 MiB

/**
 * Stateful frame reader that correctly buffers excess bytes between reads.
 *
 * WebTransport delivers QUIC stream data in arbitrary chunk boundaries — a
 * single reader.read() may contain parts of multiple frames, or a frame may
 * span multiple reads. FrameReader handles both cases correctly.
 *
 * Use FrameReader when reading multiple frames from the same stream.
 */
export class FrameReader {
  private leftover = new Uint8Array(0);
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.reader = reader;
  }

  async readFrame(): Promise<Uint8Array> {
    const lenBuf = await this.readExact(4);
    const view = new DataView(lenBuf.buffer, lenBuf.byteOffset, 4);
    const len = view.getUint32(0, false); // big-endian

    if (len > MAX_FRAME_SIZE) {
      throw new RpcError(`Frame too large: ${len} bytes (max ${MAX_FRAME_SIZE})`, "DATA_LOSS");
    }

    return this.readExact(len);
  }

  private async readExact(n: number): Promise<Uint8Array> {
    const result = new Uint8Array(n);
    let offset = 0;

    // First drain leftover from previous read
    if (this.leftover.length > 0) {
      const take = Math.min(this.leftover.length, n);
      result.set(this.leftover.subarray(0, take), offset);
      offset += take;
      this.leftover = this.leftover.length > take ? this.leftover.slice(take) : new Uint8Array(0);
    }

    while (offset < n) {
      const { value, done } = await this.reader.read();
      if (done || !value) {
        throw new Error("Stream closed before frame complete");
      }

      const remaining = n - offset;
      if (value.length <= remaining) {
        result.set(value, offset);
        offset += value.length;
      } else {
        // Chunk contains more bytes than needed — save the tail for next call
        result.set(value.subarray(0, remaining), offset);
        offset += remaining;
        this.leftover = value.slice(remaining);
      }
    }

    return result;
  }
}

/**
 * Read one length-prefixed frame from a ReadableStreamDefaultReader.
 *
 * Convenience wrapper for reading a single frame from a fresh stream.
 * When reading multiple consecutive frames from the same stream, use
 * FrameReader directly so excess bytes are not lost between reads.
 */
export async function readFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Uint8Array> {
  return new FrameReader(reader).readFrame();
}

/**
 * Write one length-prefixed frame to a WritableStreamDefaultWriter.
 */
export async function writeFrame(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  payload: Uint8Array,
): Promise<void> {
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, payload.length, false);
  await writer.write(lenBuf);
  await writer.write(payload);
}
