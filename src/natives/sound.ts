/**
 * Audio: `UMusic` (tracker modules, or anything the `format` name says) and
 * `USound`.
 *
 * This reader does not decode audio. `UMusic` copies its payload out;
 * `USound` records where the payload starts and how long it is, and leaves the
 * bytes in the package - sounds are far more numerous than music, and a
 * consumer can slice them out on demand.
 */

import { SOUND_FLAGS } from "../constants/flags.ts";
import type { BinaryCursor } from "../io/cursor.ts";
import type { NativeContext } from "./context.ts";

export interface UMusic {
  /** The tracker format, named by the object (e.g. `it`). */
  format: string;
  data_end_offset: number;
  size: number;
  audio_data: Uint8Array;
}

export function readUMusic(ctx: NativeContext): UMusic {
  const { cursor } = ctx;

  const format = ctx.name();
  const data_end_offset = cursor.uint32();
  const size = cursor.compactIndex();

  return {
    format,
    data_end_offset,
    size,
    audio_data: cursor.bytes(size),
  };
}

/**
 * The three layouts of a sound.
 *
 * The stock layout is the format name, the next-object offset (from version 63),
 * and the sized audio payload.
 *
 * Harry Potter 2 (version 79, licensee 0) extends the header with duration,
 * sample format and optional lip-sync data. This reader does not parse the
 * lip-sync payload itself; its location within the package is indicated by the
 * three `lip_sync_*` fields, and `lip_sync_data` is always null.
 *
 * Clive Barker's Undying (versions 79 to 85, licensee 0) has its own extension:
 * a run of dwords before the offset, whose count grows with the version. Of the
 * dwords only two are understood: `duration` and `data_size`. The rest hold 0
 * or 1 and are kept in `unknown`, in file order, with the version-85 trailing
 * dword appended.
 *
 * Undying and Harry Potter 2 share version 79 and licensee 0 and are told apart
 * by the bytes: Harry Potter has six dwords before the end-of-audio offset and
 * Undying five.
 *
 * `byte_rate` is `size / duration`, or null when `duration` is zero.
 */
export interface USound {
  format: string;
  core_flags?: number;
  duration?: number;
  raw_num_samples?: number | null;
  bit_depth?: number | null;
  channels?: number | null;
  sample_rate?: number | null;
  lip_sync_data?: null;
  data_size?: number;
  unknown?: number[];
  skip_offset?: number;
  next_object_offset?: number;
  size: number;
  audio_offset: number;
  byte_rate?: number | null;
  lip_sync_skip_offset?: number;
  lip_sync_data_count?: number;
  lip_sync_data_offset?: number;
  envelope_rate?: number;
  envelope?: Uint8Array;
}

/**
 * Whether the bytes at the cursor fit a layout with `dwordCount` dwords before
 * the end-of-audio offset: that offset must equal the audio start plus the
 * size.
 */
function fitsSoundLayout(cursor: BinaryCursor, dwordCount: number): boolean {
  const start = cursor.offset;

  try {
    cursor.skip(dwordCount * 4);

    const endOfAudio = cursor.uint32();
    const size = cursor.compactIndex();

    return endOfAudio === cursor.offset + size;
  } catch {
    return false;
  } finally {
    cursor.seek(start);
  }
}

/** Dwords between the format name and the end-of-audio offset, by version. */
function undyingHeaderDwords(version: number): number {
  return version >= 83 ? 7 : version >= 80 ? 6 : 5;
}

function readUndyingSound(ctx: NativeContext, format: string): USound {
  const { cursor, version } = ctx;
  const header = Array.from({ length: undyingHeaderDwords(version) }, (_, i) =>
    i === 2 ? cursor.float32() : cursor.uint32(),
  );
  const [, , duration, , data_size] = header;
  const unknown = header.filter((_, i) => i !== 2 && i !== 4);
  const skip_offset = cursor.uint32();
  const size = cursor.compactIndex();
  const audio_offset = cursor.offset;

  cursor.skip(size);

  const envelope_rate = cursor.uint32();
  const envelope = cursor.bytes(cursor.compactIndex());

  if (version >= 85) unknown.push(cursor.uint32());

  return {
    format,
    duration,
    data_size,
    unknown,
    skip_offset,
    size,
    audio_offset,
    byte_rate: duration === 0 ? null : size / duration,
    envelope_rate,
    envelope,
  };
}

export function readUSound(ctx: NativeContext): USound {
  const { cursor, version, licenseeVersion } = ctx;

  const format = ctx.name();

  const isUndying =
    licenseeVersion === 0 &&
    version >= 79 &&
    version <= 85 &&
    !(version === 79 && fitsSoundLayout(cursor, 6));

  if (isUndying) {
    return readUndyingSound(ctx, format);
  }

  if (version === 79 && licenseeVersion === 0) {
    const core_flags = cursor.uint32();
    const duration = cursor.float32();
    const raw_num_samples = cursor.uint32();
    const bit_depth = cursor.uint32();
    const channels = cursor.uint32();
    const sample_rate = cursor.uint32();
    const skip_offset = cursor.uint32();
    const size = cursor.compactIndex();
    const audio_offset = cursor.offset;

    cursor.skip(size);

    return {
      format,
      core_flags,
      duration,
      raw_num_samples,
      bit_depth,
      channels,
      sample_rate,
      lip_sync_data: null,
      skip_offset,
      size,
      audio_offset,
      byte_rate: duration === 0 ? null : size / duration,
      ...(core_flags & SOUND_FLAGS.SF_HasLipSync
        ? {
            lip_sync_skip_offset: cursor.uint32(),
            lip_sync_data_count: cursor.compactIndex(),
            lip_sync_data_offset: cursor.offset,
          }
        : {}),
    };
  }

  return {
    format,
    ...(version >= 63 ? { next_object_offset: cursor.uint32() } : {}),
    size: cursor.compactIndex(),
    audio_offset: cursor.offset,
  };
}
