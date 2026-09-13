import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { PACKAGE_FLAGS } from "../constants/flags.ts";
import { UnrealPackageReader } from "../reader.ts";
import {
  inflatePackage,
  isCompressedPackage,
  readCompressedChunks,
} from "./compressed.ts";
import { UnrealPackage } from "./package.ts";
import { BinaryCursor } from "../io/cursor.ts";
import { readPackageHeader } from "./header.ts";

const SIGNATURE = 0x9e2a83c1;
const HEADER_SIZE = 56; // version 68 layout: fixed fields, GUID, generation count

/**
 * The smallest parseable package: one name ("None") and one classless export.
 * Same shape as the bundle test's fixture. `body` is the part after the
 * header, which is what the compressed form wraps in chunks.
 */
function minimalPackage(flags = 0): { file: Uint8Array; body: Uint8Array } {
  const bytes: number[] = [];
  const u8 = (v: number) => bytes.push(v & 0xff);
  const u16 = (v: number) => (u8(v), u8(v >> 8));
  const u32 = (v: number) => (u16(v), u16(v >>> 16));

  u32(SIGNATURE);
  u16(68);
  u16(0);
  u32(flags);
  u32(1); // name count
  u32(HEADER_SIZE); // name offset
  u32(1); // export count
  u32(HEADER_SIZE + 10); // export offset
  u32(0); // import count
  u32(0); // import offset
  for (let i = 0; i < 4; i++) u32(0); // guid
  u32(0); // generation count

  // Name table: "None\0" length-prefixed, then flags.
  u8(5);
  for (const c of "None") u8(c.charCodeAt(0));
  u8(0);
  u32(0);

  // Export: class, super, package, name, flags, serial size.
  u8(0);
  u8(0);
  u32(0);
  u8(0);
  u32(0);
  u8(0);

  const file = new Uint8Array(bytes);

  return { file, body: file.subarray(HEADER_SIZE) };
}

/** Wrap `body` as Undying-style chunks after the header, splitting at `split`. */
function compressedPackage(split?: number): Uint8Array {
  const { file, body } = minimalPackage(PACKAGE_FLAGS.PKG_Compressed);
  const pieces =
    split === undefined
      ? [body]
      : [body.subarray(0, split), body.subarray(split)];
  const parts: Uint8Array[] = [file.subarray(0, HEADER_SIZE)];

  for (const piece of pieces) {
    const stream = new Uint8Array(deflateSync(piece));
    const chunkHeader = new Uint8Array(12);
    const view = new DataView(chunkHeader.buffer);

    view.setUint32(0, 0x01234567, true);
    view.setUint32(4, stream.length, true);
    view.setUint32(8, piece.length, true);
    parts.push(chunkHeader, stream);
  }

  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;

  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }

  return out;
}

const toBuffer = (u8: Uint8Array): ArrayBuffer =>
  (u8.buffer as ArrayBuffer).slice(
    u8.byteOffset,
    u8.byteOffset + u8.byteLength,
  );

describe("compressed packages", () => {
  it("detects the flag only together with the chunk magic", () => {
    const plain = toBuffer(minimalPackage().file);
    const flaggedButPlain = toBuffer(
      minimalPackage(PACKAGE_FLAGS.PKG_Compressed).file,
    );
    const compressed = toBuffer(compressedPackage());
    const header = (b: ArrayBuffer) => readPackageHeader(new BinaryCursor(b));

    expect(isCompressedPackage(plain, header(plain))).toBe(false);
    expect(isCompressedPackage(flaggedButPlain, header(flaggedButPlain))).toBe(
      false,
    );
    expect(isCompressedPackage(compressed, header(compressed))).toBe(true);
  });

  it("walks the chunk list", () => {
    const compressed = toBuffer(compressedPackage(7));
    const chunks = readCompressedChunks(
      compressed,
      readPackageHeader(new BinaryCursor(compressed)),
    );

    // The body is 22 bytes: a 10-byte name table and a 12-byte export.
    expect(chunks.map((c) => c.uncompressed_size)).toEqual([7, 15]);
  });

  it("makes the synchronous constructor fail legibly", () => {
    expect(() => new UnrealPackage(toBuffer(compressedPackage()))).toThrow(
      /compressed/,
    );
  });

  it("inflates to the plain layout and leaves a plain package untouched", async () => {
    const plain = toBuffer(minimalPackage().file);
    const inflated = await inflatePackage(toBuffer(compressedPackage(7)));

    // The header keeps its flag, so compare from the body onward.
    expect(new Uint8Array(inflated, HEADER_SIZE)).toEqual(
      new Uint8Array(plain, HEADER_SIZE),
    );
    expect(await inflatePackage(plain)).toBe(plain);
  });

  it("load() parses either kind", async () => {
    for (const buffer of [
      toBuffer(minimalPackage().file),
      toBuffer(compressedPackage(7)),
    ]) {
      const reader = await UnrealPackageReader.load(buffer);

      expect(reader.version).toBe(68);
      expect(reader.exportTable).toHaveLength(1);
      expect(reader.exportTable[0].objectName).toBe("None");
    }
  });
});
