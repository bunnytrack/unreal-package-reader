/**
 * `UTextBuffer` - source text: UnrealScript, or a map's level-info text.
 */

import { decodeText } from "../io/text.ts";
import type { BinaryCursor } from "../io/cursor.ts";
import type { NativeContext } from "./context.ts";

/**
 * Source text: UnrealScript, or a map's level-info text.
 */
export interface UTextBuffer {
  pos: number;
  top: number;
  size: number;
  contents?: string;
  compressed_size?: number;
  /** A zlib stream (RFC 1950) inflating to `size` bytes of text. */
  compressed_data?: Uint8Array;
}

function isZlibHeader(cursor: BinaryCursor): boolean {
  const start = cursor.offset;

  try {
    const cmf = cursor.uint8();
    const flg = cursor.uint8();

    return cmf === 0x78 && ((cmf << 8) | flg) % 31 === 0;
  } catch {
    return false;
  } finally {
    cursor.seek(start);
  }
}

export function readUTextBuffer(ctx: NativeContext): UTextBuffer {
  const { cursor, version, licenseeVersion } = ctx;

  const pos = cursor.uint32();
  const top = cursor.uint32();

  // Observed in Clive Barker's Undying
  if (version >= 85 && licenseeVersion === 0) {
    const start = cursor.offset;
    const uncompressedSize = cursor.compactIndex();
    const compressedSize = cursor.compactIndex();

    if (isZlibHeader(cursor)) {
      return {
        pos,
        top,
        size: uncompressedSize,
        compressed_size: compressedSize,
        compressed_data: cursor.bytes(compressedSize),
      };
    }

    cursor.seek(start);
  }

  const size = cursor.compactIndex();

  if (size <= 0) {
    return { pos, top, size };
  }

  const contents = decodeText(cursor.bytes(size - 1));
  cursor.skip(1);

  return { pos, top, size, contents };
}
