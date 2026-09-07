/**
 * The browser-only rendering helpers: everything that touches `document`.
 *
 * Kept out of `src/reader.ts` so that importing the reader under Node never
 * evaluates a DOM global - these functions only reach for `document` when
 * called. The reader's `textureToCanvas`, `getPaletteCanvas` and
 * `getLevelScreenshots` methods delegate here.
 */

import { TEXTURE_FORMAT } from "../constants/textures.ts";
import type { ExportTableObject } from "../package/objects.ts";
import type {
  ByteProperty,
  FloatProperty,
  ObjectProperty,
} from "../package/properties.ts";
import type { UPalette, UTexture } from "../natives/texture.ts";
import type { MipMap } from "../structs/texture.ts";
import type { UnrealPackageReader } from "../reader.ts";

export interface CanvasSource {
  width: number;
  height: number;
  palette: UPalette;
  mipMap?: MipMap;
}

/**
 * Render either a paletted mip map, or - with no mip - the palette itself as a
 * swatch grid.
 *
 * The alpha channel is forced opaque, which is close to the engine's own rule:
 * palette alpha is garbage before package version 66 - old writers never read
 * it, so `Faces.utx` has it zeroed throughout - and the engine's palette
 * loader overwrites it with 255 for files that old. From v66 the stored alpha
 * is real, but it feeds masked and translucent rendering, which this flat
 * preview does not attempt.
 */
export function createCanvas({
  width,
  height,
  palette,
  mipMap,
}: CanvasSource): HTMLCanvasElement {
  const rgba = new Uint8ClampedArray(width * height * 4);

  let i = 0;

  if (mipMap) {
    for (const pixel of mipMap.data) {
      const colour = palette.colours[pixel];

      rgba[i++] = colour.r;
      rgba[i++] = colour.g;
      rgba[i++] = colour.b;
      rgba[i++] = 0xff;
    }
  } else {
    for (const pixel of palette.colours) {
      rgba[i++] = pixel.r;
      rgba[i++] = pixel.g;
      rgba[i++] = pixel.b;
      rgba[i++] = 0xff;
    }
  }

  return rgbaToCanvas(width, height, rgba);
}

function rgbaToCanvas(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;

  canvas.width = width;
  canvas.height = height;

  const imageData = context.createImageData(width, height);

  imageData.data.set(rgba);
  context.putImageData(imageData, 0, 0);

  return canvas;
}

/** An RGB565 word widened to 8 bits per channel, high bits replicated. */
function rgb565(word: number): [number, number, number] {
  const r = (word >> 11) & 0x1f;
  const g = (word >> 5) & 0x3f;
  const b = word & 0x1f;

  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

/**
 * Decode a `TEXF_DXT1` mip to packed RGBA.
 *
 * DXT1 is DirectX's name for the first variant of S3 Texture Compression
 * (S3TC), the block format devised by the graphics chip maker S3. The Unreal
 * engine does not decode it, but instead calls S3's library.
 *
 * Implementation ported from Antonio Cordero Balcázar's Unreal Tournament
 * Package Tool, with the RGB565 endpoints widened to 8 bits by bit replication
 * so that full intensity reaches 255.
 */
export function decodeDxt1(
  data: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const blocksAcross = Math.max(1, width >> 2);
  const blocksDown = Math.max(1, height >> 2);
  const colours: [number, number, number][] = [];

  let offset = 0;

  for (let by = 0; by < blocksDown; by++) {
    for (let bx = 0; bx < blocksAcross; bx++) {
      const c0 = data[offset] | (data[offset + 1] << 8);
      const c1 = data[offset + 2] | (data[offset + 3] << 8);
      const [r0, g0, b0] = (colours[0] = rgb565(c0));
      const [r1, g1, b1] = (colours[1] = rgb565(c1));

      if (c0 > c1) {
        colours[2] = [(2 * r0 + r1) / 3, (2 * g0 + g1) / 3, (2 * b0 + b1) / 3];
        colours[3] = [(r0 + 2 * r1) / 3, (g0 + 2 * g1) / 3, (b0 + 2 * b1) / 3];
      } else {
        colours[2] = [(r0 + r1) / 2, (g0 + g1) / 2, (b0 + b1) / 2];
        colours[3] = [0, 0, 0];
      }

      for (let row = 0; row < 4; row++) {
        const y = by * 4 + row;

        if (y >= height) break;

        let indices = data[offset + 4 + row];

        for (let col = 0; col < 4; col++, indices >>= 2) {
          const x = bx * 4 + col;

          if (x >= width) break;

          const [r, g, b] = colours[indices & 3];
          const i = (y * width + x) * 4;

          rgba[i] = r;
          rgba[i + 1] = g;
          rgba[i + 2] = b;
          rgba[i + 3] = 0xff;
        }
      }

      offset += 8;
    }
  }

  return rgba;
}

/**
 * A texture's first mip as a canvas.
 */
export function textureToCanvas(
  reader: UnrealPackageReader,
  textureObject: ExportTableObject,
): HTMLCanvasElement {
  const textureData = textureObject.readData() as UTexture;
  const formatProp = textureObject.getProp("format") as
    ByteProperty | undefined;
  const format = formatProp?.value ?? TEXTURE_FORMAT.P8;
  const [mipMap] = textureData.mip_maps;

  switch (format) {
    case TEXTURE_FORMAT.P8: {
      const paletteProp = textureObject.getProp("palette") as ObjectProperty;
      const paletteObject = reader.getObject(
        paletteProp.value,
      ) as ExportTableObject;
      const palette = paletteObject.readData() as UPalette;

      return createCanvas({
        width: mipMap.width,
        height: mipMap.height,
        palette,
        mipMap,
      });
    }

    case TEXTURE_FORMAT.DXT1:
      return rgbaToCanvas(
        mipMap.width,
        mipMap.height,
        decodeDxt1(mipMap.data, mipMap.width, mipMap.height),
      );

    default:
      throw new Error(`Unsupported texture format ${format}`);
  }
}

/** A palette as a 16×16 swatch grid. */
export function getPaletteCanvas(
  paletteObject: ExportTableObject,
): HTMLCanvasElement {
  return createCanvas({
    width: 16,
    height: 16,
    palette: paletteObject.readData() as UPalette,
  });
}

export interface LevelScreenshots {
  frames: HTMLCanvasElement[];
  /**
   * Seconds per frame: `1 / MaxFrameRate` of the `Screenshot` texture, with
   * the engine's clamp of the rate to 0.01-100. The engine advances the
   * animation by ticking the texture being drawn, so only the first frame's
   * rate matters; the others' are ignored. Zero means that texture sets no
   * rate, which the engine treats as "advance every tick"; slideshow callers
   * should substitute a floor.
   */
  interval: number;
}

/**
 * A map's screenshot frames, in order.
 *
 * The game menus load the texture named `Screenshot` and draw it
 * (`UMenu/UMenuScreenshotCW.uc`, `UBrowser/UBrowserScreenshotCW.uc`). A montage
 * is ordinary texture animation: `UTexture::ConstantTimeTick` walks `AnimNext`
 * from frame to frame, restarting from the first texture at a null link. The
 * walk in this reader stops at: a null link, an import object (this reader only
 * holds one package at a time), and at a frame already collected, since some
 * maps link the last frame back to the head.
 *
 * With no `Screenshot` texture the game shows nothing. As a convenience, this
 * reader falls back to `LevelInfo0.Screenshot`, when that lives in this package.
 */
export function getLevelScreenshots(
  reader: UnrealPackageReader,
): LevelScreenshots {
  const frameObjects: ExportTableObject[] = [];
  let interval = 0;

  const head = reader
    .getTextureObjects()
    .find((item) => item.objectName.toLowerCase() === "screenshot");

  if (head) {
    frameObjects.push(head);

    const maxFrameRate = head.getProp("MaxFrameRate");

    if (maxFrameRate && "value" in maxFrameRate) {
      const rate = (maxFrameRate as FloatProperty).value;

      if (rate !== 0) {
        interval = 1 / Math.min(Math.max(rate, 0.01), 100);
      }
    }

    let current: ExportTableObject = head;

    while (true) {
      const animNext = current.getProp("AnimNext");

      if (!animNext || !("value" in animNext)) break;

      const next = reader.getObject((animNext as ObjectProperty).value);

      if (!next?.isExportTableObject() || frameObjects.includes(next)) break;

      frameObjects.push(next);
      current = next;
    }
  } else {
    const levelInfo = reader.getExportObjectByName("LevelInfo0");
    const screenshotProp = levelInfo?.getProp("Screenshot");

    if (screenshotProp && "value" in screenshotProp) {
      const texture = reader.getObject(
        (screenshotProp as ObjectProperty).value,
      );

      if (texture?.isExportTableObject()) {
        frameObjects.push(texture);
      }
    }
  }

  return {
    frames: frameObjects.map((item) => textureToCanvas(reader, item)),
    interval,
  };
}
