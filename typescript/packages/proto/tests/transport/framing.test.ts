// Length-prefixed framing of the WebTransport streams: byte order, limits and
// reassembly of frames that arrive split or coalesced.
import { describe, it, expect } from "vitest";
import { readFrame, writeFrame, FrameReader } from "../../src/transport/framing.js";

// ---------------------------------------------------------------------------
// Helpers — mock ReadableStream / WritableStream
// ---------------------------------------------------------------------------

/**
 * Create a ReadableStreamDefaultReader that yields chunks sequentially.
 */
function makeReader(chunks: Uint8Array[]): ReadableStreamDefaultReader<Uint8Array> {
  let i = 0;
  return {
    read: async () => {
      if (i < chunks.length) {
        return { value: chunks[i++], done: false };
      }
      return { value: undefined, done: true };
    },
    releaseLock: () => {},
    cancel: async () => {},
    closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

/**
 * Create a WritableStreamDefaultWriter that collects all written bytes.
 * The `chunks` array is populated on each write() call.
 */
function makeWriter(chunks: Uint8Array[]): WritableStreamDefaultWriter<Uint8Array> {
  return {
    write: async (chunk: Uint8Array) => {
      chunks.push(chunk);
    },
    releaseLock: () => {},
    close: async () => {},
    abort: async () => {},
    closed: Promise.resolve(undefined),
    desiredSize: 1,
    ready: Promise.resolve(undefined),
  } as unknown as WritableStreamDefaultWriter<Uint8Array>;
}

/**
 * Concatenate all chunks into a single Uint8Array.
 */
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

/** The chunk at `i`, which the test has just written. */
function at(chunks: Uint8Array[], i: number): Uint8Array {
  const chunk = chunks[i];
  if (!chunk) throw new Error(`no chunk ${i}`);
  return chunk;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("writeFrame", () => {
  it("writes 4-byte big-endian length prefix followed by payload", async () => {
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const chunks: Uint8Array[] = [];
    const writer = makeWriter(chunks);

    await writeFrame(writer, payload);

    // Should write exactly 2 chunks: length prefix + payload
    expect(chunks).toHaveLength(2);

    const lenBytes = at(chunks, 0);
    expect(lenBytes).toHaveLength(4);
    const view = new DataView(lenBytes.buffer);
    expect(view.getUint32(0, false)).toBe(4); // big-endian length = 4

    expect(chunks[1]).toEqual(payload);
  });

  it("writes zero-length frame for empty payload", async () => {
    const payload = new Uint8Array(0);
    const chunks: Uint8Array[] = [];
    await writeFrame(makeWriter(chunks), payload);

    const view = new DataView(at(chunks, 0).buffer);
    expect(view.getUint32(0, false)).toBe(0);
    expect(chunks[1]).toHaveLength(0);
  });

  it("encodes length in big-endian (MSB first)", async () => {
    // 0x0102_0304 = 16909060 bytes would OOM — use a smaller payload and verify byte order
    const smallPayload = new Uint8Array(258); // 0x0000_0102
    const chunks: Uint8Array[] = [];
    await writeFrame(makeWriter(chunks), smallPayload);

    const lenBytes = at(chunks, 0);
    expect(lenBytes[0]).toBe(0x00);
    expect(lenBytes[1]).toBe(0x00);
    expect(lenBytes[2]).toBe(0x01);
    expect(lenBytes[3]).toBe(0x02);
  });
});

describe("readFrame", () => {
  it("reads a frame written by writeFrame (roundtrip)", async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);

    // Write a frame to get the raw bytes
    const chunks: Uint8Array[] = [];
    await writeFrame(makeWriter(chunks), payload);
    const raw = concat(chunks);

    // Split into multiple chunks to test buffering (reader delivers byte-by-byte)
    const byteChunks = Array.from(raw).map((b) => new Uint8Array([b]));
    const reader = makeReader(byteChunks);

    const result = await readFrame(reader);
    expect(result).toEqual(payload);
  });

  it("reads frame when header and payload each arrive in one read", async () => {
    // WebTransport delivers frame-aligned chunks: writeFrame writes 2 chunks
    // (4-byte length prefix, then payload). readFrame receives them as 2 reads.
    const payload = new Uint8Array([0xca, 0xfe]);
    const chunks: Uint8Array[] = [];
    await writeFrame(makeWriter(chunks), payload);
    // chunks[0] = 4-byte length prefix, chunks[1] = payload
    const reader = makeReader([at(chunks, 0), at(chunks, 1)]);
    const result = await readFrame(reader);
    expect(result).toEqual(payload);
  });

  it("reads frame when bytes arrive in two chunks (header separate from body)", async () => {
    const payload = new Uint8Array([10, 20, 30]);
    const chunks: Uint8Array[] = [];
    await writeFrame(makeWriter(chunks), payload);
    // chunks[0] = 4-byte header, chunks[1] = payload
    const reader = makeReader([at(chunks, 0), at(chunks, 1)]);

    const result = await readFrame(reader);
    expect(result).toEqual(payload);
  });

  it("reads zero-length frame", async () => {
    const payload = new Uint8Array(0);
    const chunks: Uint8Array[] = [];
    await writeFrame(makeWriter(chunks), payload);
    const raw = concat(chunks);

    const reader = makeReader([raw]);
    const result = await readFrame(reader);
    expect(result).toHaveLength(0);
  });

  it("throws when stream closes before frame complete", async () => {
    // Only deliver the length prefix, no payload
    const lenBuf = new Uint8Array(4);
    new DataView(lenBuf.buffer).setUint32(0, 10, false); // says 10 bytes
    const reader = makeReader([lenBuf]); // but no payload follows

    await expect(readFrame(reader)).rejects.toThrow("Stream closed before frame complete");
  });

  it("throws when frame exceeds 4 MiB limit", async () => {
    const lenBuf = new Uint8Array(4);
    new DataView(lenBuf.buffer).setUint32(0, 4 * 1024 * 1024 + 1, false); // 4 MiB + 1
    const reader = makeReader([lenBuf]);

    await expect(readFrame(reader)).rejects.toThrow("Frame too large");
  });
});

describe("FrameReader", () => {
  it("reads two consecutive frames when each arrives in separate reads", async () => {
    const p1 = new Uint8Array([1, 2, 3]);
    const p2 = new Uint8Array([4, 5, 6, 7]);
    const w1: Uint8Array[] = [];
    const w2: Uint8Array[] = [];
    await writeFrame(makeWriter(w1), p1);
    await writeFrame(makeWriter(w2), p2);
    // Deliver as separate chunks: [len1, p1, len2, p2]
    const reader = makeReader([at(w1, 0), at(w1, 1), at(w2, 0), at(w2, 1)]);
    const fr = new FrameReader(reader);

    expect(await fr.readFrame()).toEqual(p1);
    expect(await fr.readFrame()).toEqual(p2);
  });

  it("reads two consecutive frames when both arrive in a single chunk (QUIC coalescing)", async () => {
    const p1 = new Uint8Array([0xaa, 0xbb]);
    const p2 = new Uint8Array([0xcc, 0xdd, 0xee]);
    const w1: Uint8Array[] = [];
    const w2: Uint8Array[] = [];
    await writeFrame(makeWriter(w1), p1);
    await writeFrame(makeWriter(w2), p2);
    // Deliver all bytes as a single chunk — simulates QUIC frame coalescing
    const combined = concat([at(w1, 0), at(w1, 1), at(w2, 0), at(w2, 1)]);
    const reader = makeReader([combined]);
    const fr = new FrameReader(reader);

    expect(await fr.readFrame()).toEqual(p1);
    expect(await fr.readFrame()).toEqual(p2);
  });

  it("reads frames when first frame is split mid-payload across two chunks", async () => {
    const p1 = new Uint8Array([10, 20, 30, 40]);
    const p2 = new Uint8Array([50, 60]);
    const w1: Uint8Array[] = [];
    const w2: Uint8Array[] = [];
    await writeFrame(makeWriter(w1), p1);
    await writeFrame(makeWriter(w2), p2);
    const full = concat([at(w1, 0), at(w1, 1), at(w2, 0), at(w2, 1)]);
    // Split at mid-point of first frame
    const reader = makeReader([full.slice(0, 5), full.slice(5)]);
    const fr = new FrameReader(reader);

    expect(await fr.readFrame()).toEqual(p1);
    expect(await fr.readFrame()).toEqual(p2);
  });
});
