import { describe, expect, it } from "vitest";

import { decodeDxt1 } from "./canvas.ts";

// One 8-byte block: RGB565 endpoints then four index bytes.
function block(c0: number, c1: number, rows: number[]): Uint8Array {
  return new Uint8Array([c0 & 0xff, c0 >> 8, c1 & 0xff, c1 >> 8, ...rows]);
}

const WHITE = 0xffff;
const BLACK = 0x0000;
const RED = 0xf800;

function pixel(rgba: Uint8ClampedArray, width: number, x: number, y: number) {
  const i = (y * width + x) * 4;
  return Array.from(rgba.subarray(i, i + 4));
}

describe("decodeDxt1", () => {
  it("widens RGB565 endpoints to full 8-bit values", () => {
    // Every texel index 0 -> c0.
    const rgba = decodeDxt1(block(WHITE, BLACK, [0, 0, 0, 0]), 4, 4);
    expect(pixel(rgba, 4, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(rgba).toHaveLength(4 * 4 * 4);
  });

  it("reads 2-bit indices low bits first, one byte per row", () => {
    // Row 0: indices 0,1,2,3 left to right = 0b11_10_01_00 = 0xe4.
    const rgba = decodeDxt1(block(WHITE, BLACK, [0xe4, 0, 0, 0]), 4, 4);
    expect(pixel(rgba, 4, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(rgba, 4, 1, 0)).toEqual([0, 0, 0, 255]);
    // c0 > c1: four-colour mode, thirds.
    expect(pixel(rgba, 4, 2, 0)).toEqual([170, 170, 170, 255]);
    expect(pixel(rgba, 4, 3, 0)).toEqual([85, 85, 85, 255]);
  });

  it("uses midpoint plus opaque black when c0 <= c1", () => {
    // c0 = black, c1 = white: three-colour mode.
    const rgba = decodeDxt1(block(BLACK, WHITE, [0xe4, 0, 0, 0]), 4, 4);
    expect(pixel(rgba, 4, 2, 0)).toEqual([128, 128, 128, 255]);
    expect(pixel(rgba, 4, 3, 0)).toEqual([0, 0, 0, 255]);
  });

  it("lays blocks out row-major and clips texels past the mip edge", () => {
    // 8x4 texture = two blocks side by side; second block is solid red.
    const data = new Uint8Array([
      ...block(WHITE, BLACK, [0, 0, 0, 0]),
      ...block(RED, BLACK, [0, 0, 0, 0]),
    ]);
    const rgba = decodeDxt1(data, 8, 4);
    expect(pixel(rgba, 8, 3, 3)).toEqual([255, 255, 255, 255]);
    expect(pixel(rgba, 8, 4, 0)).toEqual([255, 0, 0, 255]);

    // A 2x2 mip still occupies one whole block; output is just 2x2.
    const small = decodeDxt1(block(RED, BLACK, [0xff, 0xff, 0xff, 0xff]), 2, 2);
    expect(small).toHaveLength(2 * 2 * 4);
    // Index 3 in four-colour mode = one third red.
    expect(pixel(small, 2, 1, 1)).toEqual([85, 0, 0, 255]);
  });
});
