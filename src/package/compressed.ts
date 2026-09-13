/**
 * Whole-body package compression, as used by Clive Barker's Undying.
 *
 * Undying's maps keep the package header uncompressed and store everything
 * after it as a run of zlib chunks, each preceded by a 12-byte header: a
 * magic `0x01234567`, the compressed size, and the uncompressed size. Chunks
 * inflate to 64 KB apart from the last. The header's offsets describe the
 * inflated layout, so a compressed file cannot be read in place.
 */

import { BinaryCursor } from "../io/cursor.ts";
import { PACKAGE_FLAGS } from "../constants/flags.ts";
import { readPackageHeader, type PackageHeader } from "./header.ts";

/** Inflate one zlib stream (RFC 1950) to its uncompressed bytes. */
export type Inflate = (zlibStream: Uint8Array) => Promise<Uint8Array>;

const CHUNK_MAGIC = 0x01234567;
const CHUNK_HEADER_SIZE = 12;

/** One compressed chunk of a package body. */
export interface CompressedChunk {
  /** The zlib stream. */
  data: Uint8Array;
  uncompressed_size: number;
}

export function isCompressedPackage(
  buffer: ArrayBuffer,
  header: PackageHeader,
): boolean {
  const view = new DataView(buffer);
  const at = header.name_offset;

  return (
    (header.package_flags & PACKAGE_FLAGS.PKG_Compressed) !== 0 &&
    at + 4 <= buffer.byteLength &&
    view.getUint32(at, true) === CHUNK_MAGIC
  );
}

/** The chunk list of a compressed package body, in file order. */
export function readCompressedChunks(
  buffer: ArrayBuffer,
  header: PackageHeader,
): CompressedChunk[] {
  const view = new DataView(buffer);
  const chunks: CompressedChunk[] = [];

  for (
    let at = header.name_offset;
    at + CHUNK_HEADER_SIZE <= buffer.byteLength;
  ) {
    const magic = view.getUint32(at, true);

    if (magic !== CHUNK_MAGIC) {
      throw new Error(
        `Expected chunk magic at offset ${at}, found 0x${magic.toString(16)}`,
      );
    }

    const compressedSize = view.getUint32(at + 4, true);
    const uncompressed_size = view.getUint32(at + 8, true);
    const start = at + CHUNK_HEADER_SIZE;

    chunks.push({
      data: new Uint8Array(buffer, start, compressedSize),
      uncompressed_size,
    });

    at = start + compressedSize;
  }

  return chunks;
}

/** `Inflate` via the Compression Streams API; "deflate" there is the zlib format. */
export const inflateWithDecompressionStream: Inflate = async (zlibStream) => {
  const stream = new Blob([zlibStream as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));

  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/**
 * A package buffer with any body compression undone: the header as stored,
 * followed by the inflated chunks. A plain package comes back unchanged (the
 * same buffer, not a copy). Throws if a chunk does not inflate to its
 * declared size.
 */
export async function inflatePackage(
  buffer: ArrayBuffer,
  inflate: Inflate = inflateWithDecompressionStream,
): Promise<ArrayBuffer> {
  const header = readPackageHeader(new BinaryCursor(buffer));

  if (!isCompressedPackage(buffer, header)) return buffer;

  const chunks = readCompressedChunks(buffer, header);
  const inflated = await Promise.all(
    chunks.map((chunk) => inflate(chunk.data)),
  );

  const bodySize = chunks.reduce((sum, c) => sum + c.uncompressed_size, 0);
  const out = new Uint8Array(header.name_offset + bodySize);

  out.set(new Uint8Array(buffer, 0, header.name_offset), 0);

  let at = header.name_offset;

  inflated.forEach((bytes, i) => {
    if (bytes.length !== chunks[i].uncompressed_size) {
      throw new Error(
        `Chunk ${i} inflated to ${bytes.length} bytes, expected ${chunks[i].uncompressed_size}`,
      );
    }

    out.set(bytes, at);
    at += bytes.length;
  });

  return out.buffer;
}
