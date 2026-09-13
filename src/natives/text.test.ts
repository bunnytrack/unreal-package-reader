import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { BinaryCursor } from "../io/cursor.ts";
import type { NativeContext } from "./context.ts";
import { readUTextBuffer } from "./text.ts";

/** A compact index for the small values these tests need (< 64). */
const compact = (n: number) => [n];

function context(bytes: number[], version: number): NativeContext {
  return {
    cursor: new BinaryCursor(new Uint8Array(bytes).buffer),
    version,
    licenseeVersion: 0,
    name: () => "",
    object: () => null,
  };
}

const TEXT = "class Fire expands Object;";

describe("readUTextBuffer", () => {
  it("reads plain sized text", () => {
    const body = [...Buffer.from(TEXT, "latin1"), 0];
    const buffer = readUTextBuffer(
      context([0, 0, 0, 0, 0, 0, 0, 0, ...compact(body.length), ...body], 69),
    );

    expect(buffer).toEqual({
      pos: 0,
      top: 0,
      size: body.length,
      contents: TEXT,
    });
  });

  it("hands back Undying's zlib stream without inflating", () => {
    const stream = deflateSync(Buffer.from(TEXT, "latin1"));
    const bytes = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...compact(TEXT.length),
      ...compact(stream.length),
      ...stream,
    ];
    const buffer = readUTextBuffer(context(bytes, 85));

    expect(buffer.contents).toBeUndefined();
    expect(buffer.size).toBe(TEXT.length);
    expect(buffer.compressed_size).toBe(stream.length);
    expect(Buffer.from(buffer.compressed_data!)).toEqual(stream);
  });

  it("still reads plain text at version 85 when no zlib header follows", () => {
    const body = [...Buffer.from(TEXT, "latin1"), 0];
    const buffer = readUTextBuffer(
      context([0, 0, 0, 0, 0, 0, 0, 0, ...compact(body.length), ...body], 85),
    );

    expect(buffer.contents).toBe(TEXT);
  });
});
